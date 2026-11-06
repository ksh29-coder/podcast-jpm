#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const { parseArgs } = require('util');
const plans = require('../src/edit-engine/plan');
const { ffmpegEngine } = require('../src/edit-engine/ffmpeg');
const transcripts = require('../src/edit-engine/transcript');
const { openRouterTranscriber } = require('../src/transcribe');

// wave-edit: edit a recording by changing its edit plan, then render it.
// Made to be used by people and by AI agents alike: every command prints one
// JSON object, and exits 1 with { ok: false, error } when something is wrong.

const USAGE = `wave-edit <command> <plan.json> [options]

Set up and look:
  init <plan> --video <file|url>       Start a plan for a recording
  show <plan>                          The plan, and the edited video's timeline
  validate <plan>                      Problems that stop a render, and warnings
  silences <plan> [--min 1] [--noise -35]
                                       Quiet stretches (seconds, dB) worth cutting

Transcript:
  import-transcript <plan> --file <zoom.vtt|words.json>
                                       Use Zoom's transcript (or any WebVTT/words JSON)
  transcribe <plan>                    Transcribe word by word (needs OPENROUTER_API_KEY)
  speaker <plan> <id> --name <name>    Name a speaker
  transcript <plan> [--from <s>] [--to <s>]
                                       What was said, line by line, and what's cut
  search <plan> --text <words>         Every place those words are said
  fillers <plan> [--also "you know,i mean"] [--apply]
                                       Um, uh… still in the edit; --apply cuts them all

Change (add --dry-run to see the change without saving it):
  cut <plan> --from <s> --to <s> [--reason <why>]
  cut <plan> --text <words> [--reason <why>]
                                       Cut where those words are said (must be once)
  text <plan> --from <s> --to <s> --text <words> [--subtitle <words>]
       [--style lower-third|title|caption|label] [--x 0-1] [--y 0-1]
  chapter <plan> --at <s> --title <words>
  remove <plan> <id>                   Undo any cut, text or chapter

Make:
  frame <plan> --at <s> --out <file.jpg> [--full]
                                       One frame of the edit, texts included
  render <plan> --out <file.mp4> [--low]

All times are seconds of the original recording, so cuts never move them.`;

const OPTIONS = {
  video: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  at: { type: 'string' },
  reason: { type: 'string' },
  text: { type: 'string' },
  subtitle: { type: 'string' },
  style: { type: 'string' },
  x: { type: 'string' },
  y: { type: 'string' },
  title: { type: 'string' },
  min: { type: 'string' },
  noise: { type: 'string' },
  out: { type: 'string' },
  low: { type: 'boolean' },
  full: { type: 'boolean' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  file: { type: 'string' },
  name: { type: 'string' },
  also: { type: 'string' },
  apply: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const isUrl = (s) => /^https?:\/\//.test(s);
const fail = (message) => {
  throw new plans.PlanError(message);
};

async function load(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    fail(e.code === 'ENOENT' ? `No plan at ${file}; start one with: wave-edit init ${file} --video <file>` : `Couldn’t read ${file}: ${e.message}`);
  }
}

async function save(file, plan) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(plan, null, 2)}\n`);
  await fs.rename(tmp, file);
}

// The source video's path (kept relative to the plan file) or URL.
const sourcePath = (file, plan) => (isUrl(plan.source.video) ? plan.source.video : path.resolve(path.dirname(file), plan.source.video));

// The plan's transcript, from its own file next to the plan.
async function loadTranscript(file, plan) {
  if (!plan.source.transcript) fail(`No transcript yet; add one with: wave-edit import-transcript ${file} --file <zoom.vtt>, or wave-edit transcribe ${file}`);
  try {
    return JSON.parse(await fs.readFile(path.resolve(path.dirname(file), plan.source.transcript), 'utf8'));
  } catch (e) {
    fail(`Couldn’t read the transcript ${plan.source.transcript}: ${e.message}`);
  }
}

// Saves a transcript next to the plan, and points the plan at it.
async function saveTranscript(file, plan, transcript) {
  const name = `${path.basename(file).replace(/\.json$/i, '')}.transcript.json`;
  await save(path.join(path.dirname(file), name), transcript);
  await save(file, { ...plan, source: { ...plan.source, transcript: name } });
  return {
    saved: true,
    transcript: name,
    words: transcript.words.length,
    speakers: transcript.speakers,
    approx: transcript.approx,
    ...(transcript.approx ? { note: 'Word times are spread over each line, so cuts on single words are rough' } : {}),
  };
}

function summary(plan) {
  const tl = plans.timeline(plan);
  return {
    sourceDurationSec: plan.source.durationSec,
    editedDurationSec: tl.durationSec,
    kept: tl.segments,
    texts: tl.texts.map(({ id, style, text, outFrom, outTo }) => ({ id, style, text, outFrom, outTo })),
    chapters: tl.chapters.map(({ id, title, at, outAt }) => ({ id, title, at, outAt })),
  };
}

async function main(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [command, file, ...rest] = positionals;
  if (o.help || !command) return { usage: USAGE };
  if (!file) fail(`Say which plan file: wave-edit ${command} <plan.json>`);
  const engine = ffmpegEngine();

  // Applies a change, and saves it unless --dry-run. A change that would
  // add a problem (say, a cut past the end) is refused, not saved.
  const change = async (fn) => {
    const plan = await load(file);
    const before = new Set(plans.validate(plan).errors);
    const result = fn(plan);
    const check = plans.validate(result.plan);
    const added = check.errors.filter((e) => !before.has(e));
    if (added.length) fail(added.join('\n'));
    if (!o['dry-run']) await save(file, result.plan);
    return { saved: !o['dry-run'], change: result.change, warnings: check.warnings, errors: check.errors };
  };

  switch (command) {
    case 'init': {
      if (!o.video) fail('Say which recording: --video <file|url>');
      if (!o.force && (await fs.stat(file).catch(() => null))) fail(`${file} already exists; add --force to start it again`);
      const absolute = isUrl(o.video) ? o.video : path.resolve(o.video);
      const info = await engine.probe(absolute);
      const video = isUrl(o.video) ? o.video : path.relative(path.dirname(path.resolve(file)), absolute);
      const plan = plans.emptyPlan({ video, ...info });
      await save(file, plan);
      return { saved: true, source: plan.source };
    }
    case 'show': {
      const plan = await load(file);
      return { plan, timeline: summary(plan) };
    }
    case 'validate':
      return { ...plans.validate(await load(file)) };
    case 'silences': {
      const plan = await load(file);
      const found = await engine.silences(sourcePath(file, plan), { minSec: o.min ? Number(o.min) : undefined, noiseDb: o.noise ? Number(o.noise) : undefined });
      return { silences: found, totalSec: Math.round(found.reduce((s, x) => s + x.durationSec, 0) * 1000) / 1000 };
    }
    case 'cut': {
      if (o.text === undefined) return change((plan) => plans.addCut(plan, o));
      // Cut where some words are said, when they're said just once.
      const plan = await load(file);
      const hits = transcripts.search(plan, await loadTranscript(file, plan), o.text).filter((h) => h.status !== 'cut');
      if (hits.length !== 1) {
        fail(hits.length ? `"${o.text}" is said ${hits.length} times; cut one with --from and --to:\n${hits.map((h) => `- ${h.from}–${h.to}: …${h.context}…`).join('\n')}` : `"${o.text}" isn’t said anywhere that’s still in the edit`);
      }
      return change((p) => plans.addCut(p, { from: hits[0].from, to: hits[0].to, reason: o.reason || `said: "${hits[0].said}"` }));
    }
    case 'import-transcript': {
      if (!o.file) fail('Say which transcript: --file <zoom.vtt|words.json>');
      const plan = await load(file);
      const content = await fs.readFile(o.file, 'utf8').catch((e) => fail(`Couldn’t read ${o.file}: ${e.message}`));
      return saveTranscript(file, plan, transcripts.parseTranscript(o.file, content));
    }
    case 'transcribe': {
      const plan = await load(file);
      const transcriber = openRouterTranscriber();
      if (!transcriber) fail('Transcribing needs OPENROUTER_API_KEY set');
      const { words, cost } = await transcriber.transcribeFile(sourcePath(file, plan));
      const result = await saveTranscript(file, plan, transcripts.parseTranscript('words.json', JSON.stringify({ words })));
      return { ...result, cost };
    }
    case 'speaker': {
      if (rest[0] === undefined || !o.name) fail('Say who: wave-edit speaker <plan> <id> --name <name>');
      const plan = await load(file);
      const transcript = await loadTranscript(file, plan);
      await save(path.resolve(path.dirname(file), plan.source.transcript), { ...transcript, speakers: { ...transcript.speakers, [rest[0]]: o.name } });
      return { saved: true, speakers: { ...transcript.speakers, [rest[0]]: o.name } };
    }
    case 'transcript': {
      const plan = await load(file);
      const range = { from: o.from === undefined ? 0 : Number(o.from), to: o.to === undefined ? Infinity : Number(o.to) };
      return { lines: transcripts.lines(plan, await loadTranscript(file, plan), range) };
    }
    case 'search': {
      if (!o.text) fail('Say what to look for: --text <words>');
      const plan = await load(file);
      return { found: transcripts.search(plan, await loadTranscript(file, plan), o.text) };
    }
    case 'fillers': {
      const plan = await load(file);
      const transcript = await loadTranscript(file, plan);
      const found = transcripts.fillers(plan, transcript, { also: o.also ? o.also.split(',').map((s) => s.trim()).filter(Boolean) : [] });
      if (!o.apply) return { found, totalSec: Math.round(found.reduce((s, f) => s + f.to - f.from, 0) * 1000) / 1000 };
      if (!found.length) return { saved: false, found };
      return change((p) => {
        let next = p;
        const items = found.map((f) => {
          const added = plans.addCut(next, { from: f.from, to: f.to, reason: `filler: "${f.said}"` });
          next = added.plan;
          return added.change.item;
        });
        return { plan: next, change: { op: 'add', kind: 'cut', items, ...(transcript.approx ? { note: 'Rough: this transcript times whole lines, not words' } : {}) } };
      });
    }
    case 'text':
      return change((plan) => plans.addText(plan, o));
    case 'chapter':
      return change((plan) => plans.addChapter(plan, o));
    case 'remove':
      if (!rest[0]) fail('Say which id to remove: wave-edit remove <plan> <id>');
      return change((plan) => plans.removeItem(plan, rest[0]));
    case 'frame': {
      if (o.at === undefined || !o.out) fail('Say when and where: --at <seconds> --out <file.jpg>');
      const plan = await load(file);
      return engine.frame(plan, { sourcePath: sourcePath(file, plan), at: Number(o.at), out: o.out, quality: o.full ? 'full' : 'low' });
    }
    case 'render': {
      if (!o.out) fail('Say where: --out <file.mp4>');
      const plan = await load(file);
      return engine.render(plan, { sourcePath: sourcePath(file, plan), out: o.out, quality: o.low ? 'low' : 'full' });
    }
    default:
      fail(`Unknown command "${command}". Run wave-edit --help.`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (result) => {
      if (result.usage) return console.log(result.usage);
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    },
    (e) => {
      const expected = e instanceof plans.PlanError || e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE';
      console.log(JSON.stringify({ ok: false, error: expected ? e.message : `Unexpected error: ${(e.stderr || e.message || '').trim()}` }, null, 2));
      process.exitCode = 1;
    }
  );
}

module.exports = { main };
