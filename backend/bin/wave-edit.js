#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const { parseArgs } = require('util');
const plans = require('../src/edit-engine/plan');
const { ffmpegEngine } = require('../src/edit-engine/ffmpeg');
const transcripts = require('../src/edit-engine/transcript');
const { openRouterTranscriber } = require('../src/transcribe');

// wave-edit: edit a podcast recording by changing its edit plan, then render
// it. Made for AI editors first: every command prints one JSON object (and
// exits 1 with { ok: false, error } saying what to fix), every change can be
// a suggestion with a reason for a person to accept or reject, and `tools`
// prints every command as a tool definition for an AI model.
//
// Commands are described once, in COMMANDS; the help text, the option
// parser and the tool definitions all come from there.

const isUrl = (s) => /^https?:\/\//.test(s);
const fail = (message) => {
  throw new plans.PlanError(message);
};

async function load(file) {
  try {
    return plans.withDefaults(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (e) {
    fail(e.code === 'ENOENT' ? `No plan at ${file}; start one with: wave-edit init ${file} --video <file>` : `Couldn’t read ${file}: ${e.message}`);
  }
}

async function save(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(tmp, file);
}

// Where each recording is: paths are kept relative to the plan file.
const where = (file, video) => (isUrl(video) ? video : path.resolve(path.dirname(file), video));
const paths = (file, plan) => ({ [plans.MAIN]: where(file, plan.source.video), ...Object.fromEntries(Object.entries(plan.sources).map(([n, s]) => [n, where(file, s.video)])) });
const relative = (file, video) => (isUrl(video) ? video : path.relative(path.dirname(path.resolve(file)), path.resolve(video)));

// The plan's transcript, from its own file next to the plan.
async function loadTranscript(file, plan, { required = true } = {}) {
  if (!plan.source.transcript) {
    if (!required) return null;
    fail(`No transcript yet; make one with: wave-edit transcribe ${file}`);
  }
  try {
    return JSON.parse(await fs.readFile(where(file, plan.source.transcript), 'utf8'));
  } catch (e) {
    fail(`Couldn’t read the transcript ${plan.source.transcript}: ${e.message}`);
  }
}

// Saves a transcript next to the plan, and points the plan at it.
async function saveTranscript(file, plan, transcript) {
  const name = `${path.basename(file).replace(/\.json$/i, '')}.transcript.json`;
  await save(path.join(path.dirname(file), name), transcript);
  await save(file, { ...plan, source: { ...plan.source, transcript: name } });
  // Every speaker with what they're called for now, so they can be named.
  const ids = [...new Set(transcript.words.map((w) => w.speaker).filter((s) => s !== null))];
  return { saved: true, transcript: name, words: transcript.words.length, speakers: Object.fromEntries(ids.map((id) => [id, transcripts.speakerName(transcript, id)])) };
}

const sec = (n) => `${Math.round(n * 10) / 10}s`;

// One line saying what an item does, for people reviewing suggestions.
function describe(kind, item, transcript) {
  const span = `${sec(item.from)}–${sec(item.to)}`;
  switch (kind) {
    case 'cut': {
      const said = transcript?.words.filter((w) => w.start >= item.from - 0.05 && w.end <= item.to + 0.05).map((w) => w.text).join(' ');
      return `Cut ${span} (${sec(item.to - item.from)})${said ? `: “${said.length > 140 ? `${said.slice(0, 140)}…` : said}”` : ''}`;
    }
    case 'text':
      return `Show “${item.text}${item.subtitle ? ` / ${item.subtitle}` : ''}” as ${item.style}, ${span}`;
    case 'chapter':
      return `Chapter “${item.title}” at ${sec(item.at)}`;
    case 'scene':
      return `Show ${item.layout}${item.source ? ` (${item.source})` : ''}${item.pip ? `, speaker ${item.pip}` : ''}, ${span}`;
    case 'zoom':
      return `Zoom into ${item.source} [${item.rect.join(', ')}], ${span}`;
    default:
      return kind;
  }
}

// The options every change takes.
const CHANGE_ARGS = {
  reason: { type: 'string', desc: 'Why: shown to whoever reviews it' },
  by: { type: 'string', desc: 'Who made it: a person, or an AI editor’s name' },
  suggest: { type: 'boolean', desc: 'Make it a suggestion for a person to accept or reject (AI editors: always)' },
  'dry-run': { type: 'boolean', desc: 'Show the change without saving it' },
};

const COMMANDS = [
  // Set up and look
  {
    name: 'init', group: 'Set up and look', summary: 'Start a plan for a recording (the main one: Zoom’s speaker video)',
    args: { video: { type: 'string', required: true, desc: 'The recording’s file or URL' }, force: { type: 'boolean', desc: 'Start again over an existing plan' } },
    async run({ file, o, engine }) {
      if (!o.force && (await fs.stat(file).catch(() => null))) fail(`${file} already exists; add --force to start it again`);
      const info = await engine.probe(isUrl(o.video) ? o.video : path.resolve(o.video));
      const plan = plans.emptyPlan({ video: relative(file, o.video), ...info });
      await save(file, plan);
      return { saved: true, source: plan.source };
    },
  },
  {
    name: 'add-source', group: 'Set up and look', summary: 'Add another recording of the same meeting, like Zoom’s shared screen',
    args: {
      name: { type: 'string', required: true, desc: 'What to call it, like "screen"' },
      video: { type: 'string', required: true, desc: 'Its file or URL' },
      offset: { type: 'number', desc: 'Seconds into the main recording at which it starts (default 0: Zoom’s files start together)' },
    },
    async run({ file, o, engine, change }) {
      const info = await engine.probe(isUrl(o.video) ? o.video : path.resolve(o.video));
      return change((plan) => plans.addSource(plan, o.name, { video: relative(file, o.video), ...info, offsetSec: o.offset === undefined ? 0 : Number(o.offset) }));
    },
  },
  {
    name: 'show', group: 'Set up and look', summary: 'The plan, and the edited video’s timeline (suggestions included)',
    async run({ load }) {
      const plan = await load();
      const tl = plans.timeline(plan);
      const pick = (items, keys) => items.map((i) => Object.fromEntries(['id', ...keys, 'state'].filter((k) => i[k] !== undefined).map((k) => [k, i[k]])));
      return {
        plan,
        timeline: {
          sourceDurationSec: plan.source.durationSec,
          editedDurationSec: tl.durationSec,
          kept: tl.segments,
          texts: pick(tl.texts, ['style', 'text', 'outFrom', 'outTo']),
          chapters: pick(tl.chapters, ['title', 'at', 'outAt']),
          scenes: pick(tl.scenes, ['layout', 'outFrom', 'outTo']),
          zooms: pick(tl.zooms, ['source', 'rect', 'outFrom', 'outTo']),
        },
        suggestions: plans.suggestions(plan).length,
      };
    },
  },
  {
    name: 'validate', group: 'Set up and look', summary: 'Problems that stop a render, and warnings worth a look',
    async run({ load }) {
      return { ...plans.validate(await load()) };
    },
  },
  {
    name: 'look', group: 'Set up and look', summary: 'A recording’s own picture at a moment (not the edit), with a grid labelled 0.1–0.9 to read positions off, like a zoom’s rect',
    args: {
      at: { type: 'number', required: true, desc: 'Seconds (main recording)' },
      out: { type: 'string', required: true, desc: 'Where to write the JPEG' },
      source: { type: 'string', desc: '"speaker" (default) or a source’s name, like "screen"' },
      plain: { type: 'boolean', desc: 'Without the grid' },
    },
    async run({ o, load, engine, file }) {
      const plan = await load();
      return engine.look(plan, { paths: paths(file, plan), source: o.source || plans.MAIN, at: Number(o.at), out: o.out, grid: !o.plain });
    },
  },
  {
    name: 'silences', group: 'Find', summary: 'Quiet stretches worth cutting',
    args: { min: { type: 'number', desc: 'Shortest, in seconds (default 1)' }, noise: { type: 'number', desc: 'Quieter than this many dB (default -35)' } },
    async run({ o, load, engine, file }) {
      const plan = await load();
      const found = await engine.silences(paths(file, plan)[plans.MAIN], { minSec: o.min ? Number(o.min) : undefined, noiseDb: o.noise ? Number(o.noise) : undefined });
      return { silences: found, totalSec: Math.round(found.reduce((s, x) => s + x.durationSec, 0) * 1000) / 1000 };
    },
  },
  {
    name: 'activity', group: 'Find', summary: 'What happens on a recording’s picture: blank stretches (screen share not on) and moments it changes a lot (new slide or window), on the main clock',
    args: { source: { type: 'string', desc: 'Which recording (default "screen")' }, change: { type: 'number', desc: 'How big a change counts, 0–1 (default 0.3)' } },
    async run({ o, load, engine, file }) {
      const plan = await load();
      const name = o.source || 'screen';
      const info = name === plans.MAIN ? plan.source : plan.sources[name];
      if (!info) fail(`There's no "${name}" recording; add it with add-source`);
      return engine.activity(paths(file, plan)[name], { offsetSec: info.offsetSec || 0, change: o.change ? Number(o.change) : undefined });
    },
  },
  // Transcript
  {
    name: 'transcribe', group: 'Transcript', summary: 'Transcribe word by word with AI, telling speakers apart (needs OPENROUTER_API_KEY; costs money)',
    args: { force: { type: 'boolean', desc: 'Make a new one over the old' } },
    async run({ file, o, load }) {
      const plan = await load();
      // It costs money, so a transcript isn't made twice by accident.
      if (plan.source.transcript && !o.force) fail(`${file} already has a transcript (${plan.source.transcript}); add --force to make a new one`);
      const transcriber = openRouterTranscriber();
      if (!transcriber) fail('Transcribing needs OPENROUTER_API_KEY set');
      const { words, cost } = await transcriber.transcribeFile(paths(file, plan)[plans.MAIN]);
      if (!words.length) fail('The transcriber heard no words');
      return { ...(await saveTranscript(file, plan, transcripts.fromWords(words, { durationSec: plan.source.durationSec }))), cost };
    },
  },
  {
    name: 'import-transcript', group: 'Transcript', summary: 'Use a transcript made earlier',
    args: { file: { type: 'string', required: true, desc: 'A transcript JSON file' } },
    async run({ file, o, load }) {
      const plan = await load();
      const content = await fs.readFile(o.file, 'utf8').catch((e) => fail(`Couldn’t read ${o.file}: ${e.message}`));
      return saveTranscript(file, plan, transcripts.parseTranscript(o.file, content));
    },
  },
  {
    name: 'speaker', group: 'Transcript', summary: 'Name a speaker',
    positional: { name: 'id', desc: 'The speaker id, as transcript shows it (like 0, or 1:0 in long recordings)' },
    args: { name: { type: 'string', required: true, desc: 'Their name' } },
    async run({ file, o, rest, load }) {
      const plan = await load();
      const transcript = await loadTranscript(file, plan);
      const speakers = { ...transcript.speakers, [rest[0]]: o.name };
      await save(where(file, plan.source.transcript), { ...transcript, speakers });
      return { saved: true, speakers };
    },
  },
  {
    name: 'transcript', group: 'Transcript', summary: 'What was said, line by line: times, speaker and whether the edit keeps it',
    args: { from: { type: 'number', desc: 'From this many seconds' }, to: { type: 'number', desc: 'Up to this many seconds' } },
    async run({ file, o, load }) {
      const plan = await load();
      const range = { from: o.from === undefined ? 0 : Number(o.from), to: o.to === undefined ? Infinity : Number(o.to) };
      return { lines: transcripts.lines(plan, await loadTranscript(file, plan), range) };
    },
  },
  {
    name: 'search', group: 'Transcript', summary: 'Every place some words are said, with exact times',
    args: { text: { type: 'string', required: true, desc: 'The words' } },
    async run({ file, o, load }) {
      const plan = await load();
      return { found: transcripts.search(plan, await loadTranscript(file, plan), o.text) };
    },
  },
  {
    name: 'fillers', group: 'Transcript', summary: 'Um, uh, erm… still in the edit; --apply cuts them all',
    args: { also: { type: 'string', desc: 'Phrases that are often meant to look for too, comma-separated, like "you know,i mean"' }, apply: { type: 'boolean', desc: 'Cut every one found' }, ...CHANGE_ARGS },
    async run({ file, o, load, change }) {
      const plan = await load();
      const found = transcripts.fillers(plan, await loadTranscript(file, plan), { also: o.also ? o.also.split(',').map((s) => s.trim()).filter(Boolean) : [] });
      if (!o.apply) return { found, totalSec: Math.round(found.reduce((s, f) => s + f.to - f.from, 0) * 1000) / 1000 };
      if (!found.length) return { saved: false, found };
      return change((p) => {
        let next = p;
        const items = found.map((f) => {
          const added = plans.addCut(next, { ...o, from: f.from, to: f.to, reason: o.reason || `filler: "${f.said}"` });
          next = added.plan;
          return added.change.item;
        });
        return { plan: next, change: { op: 'add', kind: 'cut', items } };
      });
    },
  },
  // Change
  {
    name: 'cut', group: 'Change', summary: 'Cut from–to out, or cut where some words are said (--text; they must be said once)',
    args: { from: { type: 'number', desc: 'Seconds' }, to: { type: 'number', desc: 'Seconds' }, text: { type: 'string', desc: 'Words to cut, instead of from and to' }, ...CHANGE_ARGS },
    async run({ file, o, load, change }) {
      if (o.text === undefined) return change((plan) => plans.addCut(plan, o));
      const plan = await load();
      const hits = transcripts.search(plan, await loadTranscript(file, plan), o.text).filter((h) => h.status !== 'cut');
      if (hits.length !== 1) {
        fail(hits.length ? `"${o.text}" is said ${hits.length} times; cut one with --from and --to:\n${hits.map((h) => `- ${h.from}–${h.to}: …${h.context}…`).join('\n')}` : `"${o.text}" isn’t said anywhere that’s still in the edit`);
      }
      return change((p) => plans.addCut(p, { ...o, from: hits[0].from, to: hits[0].to, reason: o.reason || `said: "${hits[0].said}"` }));
    },
  },
  {
    name: 'text', group: 'Change', summary: 'Show text on screen: lower-third (name / role), title (card in the middle), caption (bottom), label (top-left)',
    args: {
      from: { type: 'number', required: true, desc: 'Seconds' },
      to: { type: 'number', required: true, desc: 'Seconds' },
      text: { type: 'string', required: true, desc: 'The words (a lower third’s name)' },
      subtitle: { type: 'string', desc: 'A smaller second line (a lower third’s role or team)' },
      style: { type: 'string', enum: Object.keys(plans.TEXT_STYLES), desc: 'Default caption' },
      x: { type: 'number', desc: 'Move it: 0–1 across' },
      y: { type: 'number', desc: 'Move it: 0–1 down' },
      ...CHANGE_ARGS,
    },
    run: ({ o, change }) => change((plan) => plans.addText(plan, o)),
  },
  {
    name: 'chapter', group: 'Change', summary: 'Start a chapter',
    args: { at: { type: 'number', required: true, desc: 'Seconds' }, title: { type: 'string', required: true, desc: 'Its title' }, ...CHANGE_ARGS },
    run: ({ o, change }) => change((plan) => plans.addChapter(plan, o)),
  },
  {
    name: 'scene', group: 'Change', summary: 'Choose what fills the picture from–to: screen, screen+speaker (speaker small in a corner), side-by-side, or speaker (the default everywhere else)',
    args: {
      from: { type: 'number', required: true, desc: 'Seconds' },
      to: { type: 'number', required: true, desc: 'Seconds' },
      layout: { type: 'string', required: true, enum: plans.LAYOUTS, desc: 'What to show' },
      source: { type: 'string', desc: 'The screen recording’s name (default "screen")' },
      pip: { type: 'string', enum: plans.PIP_CORNERS, desc: 'For screen+speaker: which corner (default bottom-right)' },
      ...CHANGE_ARGS,
    },
    run: ({ o, change }) => change((plan) => plans.addScene(plan, o)),
  },
  {
    name: 'zoom', group: 'Change', summary: 'Zoom into part of a recording’s picture from–to, easing in and out (use look to find the rect)',
    args: {
      from: { type: 'number', required: true, desc: 'Seconds' },
      to: { type: 'number', required: true, desc: 'Seconds' },
      rect: { type: 'string', required: true, desc: 'x,y,w,h as fractions of the picture, like 0.5,0,0.5,0.5 for the top-right quarter' },
      source: { type: 'string', desc: 'Which recording (default "screen" when there is one)' },
      ...CHANGE_ARGS,
    },
    run: ({ o, change }) => change((plan) => plans.addZoom(plan, o)),
  },
  {
    name: 'remove', group: 'Change', summary: 'Take away any cut, text, chapter, scene or zoom',
    positional: { name: 'ids', desc: 'Their ids', many: true },
    args: { by: CHANGE_ARGS.by, 'dry-run': CHANGE_ARGS['dry-run'] },
    run: ({ rest, change }) =>
      change((plan) => {
        let next = plan;
        const items = rest.map((id) => {
          const r = plans.removeItem(next, id);
          next = r.plan;
          return r.change.item;
        });
        return { plan: next, change: { op: 'remove', items } };
      }),
  },
  // Review
  {
    name: 'suggestions', group: 'Review', summary: 'Every suggestion waiting for a decision, in time order, each said in plain words',
    async run({ file, load }) {
      const plan = await load();
      const transcript = await loadTranscript(file, plan, { required: false });
      const all = plans.suggestions(plan);
      const list = all.map((s) => ({ id: s.id, kind: s.kind, what: describe(s.kind, s, transcript), reason: s.reason ?? null, by: s.by ?? null }));
      const cutSec = all.filter((s) => s.kind === 'cut').reduce((sum, c) => sum + c.to - c.from, 0);
      return { suggestions: list, count: list.length, cutSec: Math.round(cutSec * 10) / 10 };
    },
  },
  {
    name: 'accept', group: 'Review', summary: 'Put suggestions into the edit for good',
    positional: { name: 'ids', desc: 'Their ids', many: true },
    args: { all: { type: 'boolean', desc: 'Every suggestion' }, by: CHANGE_ARGS.by },
    run: ({ o, rest, change }) => change((plan) => plans.accept(plan, o.all ? 'all' : rest)),
  },
  {
    name: 'reject', group: 'Review', summary: 'Throw suggestions away',
    positional: { name: 'ids', desc: 'Their ids', many: true },
    args: { all: { type: 'boolean', desc: 'Every suggestion' }, by: CHANGE_ARGS.by },
    run: ({ o, rest, change }) => change((plan) => plans.reject(plan, o.all ? 'all' : rest)),
  },
  // Make
  {
    name: 'frame', group: 'Make', summary: 'One frame of the edit (suggestions included), texts and all: look at it to check the edit',
    args: {
      at: { type: 'number', required: true, desc: 'Seconds (main recording)' },
      out: { type: 'string', required: true, desc: 'Where to write the JPEG' },
      full: { type: 'boolean', desc: 'Full size, not small' },
      'accepted-only': { type: 'boolean', desc: 'Leave suggestions out' },
    },
    async run({ o, load, engine, file }) {
      const plan = await load();
      return engine.frame(plan, { paths: paths(file, plan), at: Number(o.at), out: o.out, quality: o.full ? 'full' : 'low', suggestions: !o['accepted-only'] });
    },
  },
  {
    name: 'render', group: 'Make', summary: 'Make the edited video (accepted changes only, unless --suggestions)',
    args: {
      out: { type: 'string', required: true, desc: 'Where to write the MP4' },
      low: { type: 'boolean', desc: 'Small and quick, to watch the edit' },
      suggestions: { type: 'boolean', desc: 'Include suggestions, to watch what they’d do' },
    },
    async run({ o, load, engine, file }) {
      const plan = await load();
      return engine.render(plan, { paths: paths(file, plan), out: o.out, quality: o.low ? 'low' : 'full', suggestions: Boolean(o.suggestions) });
    },
  },
];

const BY_NAME = Object.fromEntries(COMMANDS.map((c) => [c.name, c]));

// Every option any command takes, for the option parser (numbers arrive as text).
const OPTIONS = { help: { type: 'boolean', short: 'h' } };
for (const c of COMMANDS) for (const [k, a] of Object.entries(c.args || {})) OPTIONS[k] = { type: a.type === 'boolean' ? 'boolean' : 'string' };

function usage() {
  const lines = ['wave-edit <command> <plan.json> [options]', ''];
  let group = null;
  for (const c of COMMANDS) {
    if (c.group !== group) lines.push(`${(group = c.group)}:`);
    const pos = c.positional ? ` <${c.positional.name}${c.positional.many ? '…' : ''}>` : '';
    const opts = Object.entries(c.args || {})
      .filter(([k]) => !(k in CHANGE_ARGS) || k === 'by')
      .map(([k, a]) => (a.required ? `--${k} <${a.type}>` : a.type === 'boolean' ? `[--${k}]` : `[--${k} <${a.type}>]`));
    lines.push(`  ${c.name} <plan>${pos} ${opts.join(' ')}`.trimEnd(), `      ${c.summary}`);
  }
  lines.push('', 'Changes also take --reason, --by, --suggest and --dry-run.', 'All times are seconds of the main recording, so cuts never move them.', '`wave-edit tools` prints every command as a tool definition for an AI model.');
  return lines.join('\n');
}

// Every command as a tool for an AI model ({ name, description,
// input_schema }), to be run with call(name, input).
function tools() {
  return COMMANDS.map((c) => {
    const properties = { plan: { type: 'string', description: 'The edit plan’s file' } };
    const required = ['plan'];
    if (c.positional) {
      properties[c.positional.name] = c.positional.many ? { type: 'array', items: { type: 'string' }, description: c.positional.desc } : { type: 'string', description: c.positional.desc };
      if (!c.args?.all) required.push(c.positional.name);
    }
    for (const [k, a] of Object.entries(c.args || {})) {
      if (k === 'dry-run') continue;
      properties[k] = { type: a.type, description: a.desc, ...(a.enum ? { enum: a.enum } : {}) };
      if (a.required) required.push(k);
    }
    return { name: c.name.replace(/-/g, '_'), description: c.summary, input_schema: { type: 'object', properties, required } };
  });
}

async function main(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [name, file, ...rest] = positionals;
  if (name === 'tools') return { tools: tools() };
  if (o.help || !name) return { usage: usage() };
  const command = BY_NAME[name];
  if (!command) fail(`Unknown command "${name}". Run wave-edit --help.`);
  if (!file) fail(`Say which plan file: wave-edit ${name} <plan.json>`);
  for (const [k, a] of Object.entries(command.args || {})) {
    if (a.required && o[k] === undefined) fail(`${name} needs --${k} (${a.desc})`);
    if (a.type === 'number' && o[k] !== undefined && !Number.isFinite(Number(o[k]))) fail(`--${k} must be a number`);
    if (a.enum && o[k] !== undefined && !a.enum.includes(o[k])) fail(`--${k} must be one of: ${a.enum.join(', ')}`);
  }
  if (command.positional && !command.positional.many && rest[0] === undefined) fail(`Say which: wave-edit ${name} <plan> <${command.positional.name}>`);
  if (command.positional?.many && !rest.length && !o.all) fail(`Say which: wave-edit ${name} <plan> <${command.positional.name}…>${command.args?.all ? ' (or --all)' : ''}`);

  // Applies a change, and saves it (with a line in the plan's log) unless
  // --dry-run. A change that would add a problem (say, a cut past the end)
  // is refused, not saved.
  const change = async (fn) => {
    const plan = await load(file);
    const before = new Set(plans.validate(plan).errors);
    const result = fn(plan);
    const check = plans.validate(result.plan);
    const added = check.errors.filter((e) => !before.has(e));
    if (added.length) fail(added.join('\n'));
    if (!o['dry-run']) {
      const items = result.change.items || [result.change.item];
      const entry = { at: new Date().toISOString(), by: o.by || null, op: result.change.op, ids: items.map((i) => i.id || result.change.name) };
      await save(file, { ...result.plan, log: [...result.plan.log, entry] });
    }
    return { saved: !o['dry-run'], change: result.change, warnings: check.warnings, errors: check.errors };
  };

  return command.run({ file, o, rest, engine: ffmpegEngine(), load: () => load(file), change });
}

// Runs a command from a tool call: call('cut', { plan, from, to, reason }).
async function call(name, input = {}) {
  const command = BY_NAME[name.replace(/_/g, '-')];
  if (!command) fail(`Unknown tool "${name}"`);
  const { plan, ...rest } = input;
  const argv = [command.name, plan];
  if (command.positional) argv.push(...[].concat(rest[command.positional.name] ?? []).map(String));
  for (const [k, v] of Object.entries(rest)) {
    if (k === command.positional?.name || v === undefined || v === null || v === false) continue;
    argv.push(`--${k}`, ...(v === true ? [] : [String(v)]));
  }
  return { ok: true, ...(await main(argv)) };
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (result) => {
      if (result.usage) return console.log(result.usage);
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    },
    (e) => {
      const expected = e instanceof plans.PlanError || e instanceof transcripts.TranscriptError || String(e.code).startsWith('ERR_PARSE_ARGS');
      console.log(JSON.stringify({ ok: false, error: expected ? e.message : `Unexpected error: ${(e.stderr || e.message || '').trim()}` }, null, 2));
      process.exitCode = 1;
    }
  );
}

module.exports = { main, call, tools, COMMANDS };
