#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const { parseArgs } = require('util');
const plans = require('../src/edit-engine/plan');
const { ffmpegEngine } = require('../src/edit-engine/ffmpeg');

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

Change (add --dry-run to see the change without saving it):
  cut <plan> --from <s> --to <s> [--reason <why>]
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
    case 'cut':
      return change((plan) => plans.addCut(plan, o));
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
