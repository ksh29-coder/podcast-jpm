const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const plans = require('../src/edit-engine/plan');
const { ffmpegEngine, buildAss, buildChapterMetadata, assTime } = require('../src/edit-engine/ffmpeg');
const { main } = require('../bin/wave-edit');

// The edit engine: plans and their timeline, then real renders with ffmpeg
// of a 12-second video that is red, then green, then blue (4 seconds each),
// with a tone that goes quiet from 5s to 7s.

const ffmpeg = require('ffmpeg-static');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-engine-test-'));
const source = path.join(dir, 'src.mp4');
execFileSync(ffmpeg, [
  '-y', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=4:r=25',
  '-f', 'lavfi', '-i', 'color=c=green:s=320x180:d=4:r=25',
  '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=4:r=25',
  '-f', 'lavfi', '-i', 'sine=f=440:d=12',
  '-filter_complex', "[0][1][2]concat=n=3:v=1:a=0[v];[3]volume='if(between(t,5,7),0,1)':eval=frame[a]",
  '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', source,
]);
// The colour (r, g, b) at a point of a frame of a video or picture.
const pixel = (file, sec, x, y) => {
  const raw = execFileSync(ffmpeg, ['-loglevel', 'error', ...(sec === null ? [] : ['-ss', String(sec)]), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [...raw.subarray(0, 3)];
};
const near = (actual, expected) => actual.every((c, i) => Math.abs(c - expected[i]) < 50);
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const durationOf = (file) => Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(ffmpeg, ['-i', file]).stderr.toString()).slice(1).reduce((s, v) => s * 60 + Number(v), 0));

const twelve = () => plans.emptyPlan({ video: 'src.mp4', durationSec: 12, width: 320, height: 180, hasAudio: true });

test('cuts leave the kept parts, joined up where cuts overlap', () => {
  let plan = twelve();
  plan = plans.addCut(plan, { from: 2, to: 4 }).plan;
  plan = plans.addCut(plan, { from: 3, to: 5 }).plan;
  plan = plans.addCut(plan, { from: 11, to: 12 }).plan;
  assert.deepStrictEqual(plans.keptSegments(plan), [{ from: 0, to: 2 }, { from: 5, to: 11 }]);
  const segments = plans.keptSegments(plan);
  assert.deepStrictEqual(plans.toOutputTime(segments, 1), { time: 1, cut: false });
  assert.deepStrictEqual(plans.toOutputTime(segments, 6), { time: 3, cut: false });
  assert.deepStrictEqual(plans.toOutputTime(segments, 3), { time: 2, cut: true });
  assert.strictEqual(plans.toOutputTime(segments, 13), null);
});

test('the timeline moves texts and chapters to the edited times', () => {
  let plan = twelve();
  plan = plans.addCut(plan, { from: 4, to: 8 }).plan;
  plan = plans.addText(plan, { from: 2, to: 10, text: 'Across the cut', style: 'caption' }).plan;
  plan = plans.addText(plan, { from: 5, to: 7, text: 'Cut out', style: 'caption' }).plan;
  plan = plans.addChapter(plan, { at: 9, title: 'Blue' }).plan;
  plan = plans.addChapter(plan, { at: 6, title: 'Moved' }).plan;
  const tl = plans.timeline(plan);
  assert.strictEqual(tl.durationSec, 8);
  assert.deepStrictEqual(tl.texts.map((t) => [t.text, t.outFrom, t.outTo]), [['Across the cut', 2, 6]]);
  assert.deepStrictEqual(tl.chapters.map((c) => [c.title, c.outAt]), [['Moved', 4], ['Blue', 5]]);
});

test('validate finds problems and things worth a look', () => {
  const plan = twelve();
  plan.cuts.push({ id: 'c1', from: 10, to: 20 }, { id: 'c1', from: 3, to: 2 });
  plan.texts.push({ id: 't1', from: 0, to: 1, style: 'banner', text: ' ' }, { id: 't2', from: 0, to: 1, style: 'caption', text: 'x', x: 2 });
  plan.chapters.push({ id: 'h1', at: 30, title: '' });
  const { ok, errors } = plans.validate(plan);
  assert.strictEqual(ok, false);
  for (const e of ['outside the recording', 'same id', 'ends before it starts', 'unknown style', 'text is empty', 'x must be between', 'chapter time', 'no title']) {
    assert.ok(errors.some((x) => x.includes(e)), `expected an error about "${e}" in ${JSON.stringify(errors)}`);
  }

  let fine = plans.addCut(twelve(), { from: 4, to: 8 }).plan;
  fine = plans.addText(fine, { from: 5, to: 6, text: 'Hidden' }).plan;
  fine = plans.addText(fine, { from: 0, to: 2, text: 'A very long line of text that cannot possibly fit across a small video' }).plan;
  const check = plans.validate(fine);
  assert.strictEqual(check.ok, true);
  assert.ok(check.warnings.some((w) => w.includes('wholly inside a cut')));
  assert.ok(check.warnings.some((w) => w.includes('too wide')));

  const all = plans.addCut(twelve(), { from: 0, to: 12 }).plan;
  assert.ok(plans.validate(all).errors.includes('Everything is cut'));
});

test('changes leave the original plan alone, and can be taken away by id', () => {
  const plan = twelve();
  const { plan: next, change } = plans.addText(plan, { from: '1', to: '3', text: 'Alice', subtitle: 'Platform', style: 'lower-third' });
  assert.strictEqual(plan.texts.length, 0);
  assert.deepStrictEqual({ ...change.item, id: undefined }, { id: undefined, from: 1, to: 3, style: 'lower-third', text: 'Alice', subtitle: 'Platform' });
  const removed = plans.removeItem(next, change.item.id);
  assert.strictEqual(removed.plan.texts.length, 0);
  assert.strictEqual(removed.change.op, 'remove');
  assert.throws(() => plans.removeItem(next, 'nope'), /Nothing in the plan/);
  assert.throws(() => plans.addCut(plan, { from: 'soon', to: 3 }), /from must be a number/);
  assert.throws(() => plans.addText(plan, { from: 1, to: 2, text: 'x', style: 'banner' }), /Unknown style/);
});

test('text is written so it can’t turn into style codes', () => {
  const ass = buildAss([{ style: 'caption', text: 'a {\\b1} \\N b\nc', outFrom: 1, outTo: 62.5 }], { width: 320, height: 180 });
  const line = ass.split('\n').find((l) => l.startsWith('Dialogue:'));
  assert.ok(line.startsWith('Dialogue: 0,0:00:01.00,0:01:02.50,caption,'), line);
  assert.ok(line.endsWith('a \\{\\​b1\\} \\​N b\\Nc'), line);
  assert.strictEqual(assTime(3723.456), '1:02:03.46');
  assert.match(buildChapterMetadata([{ title: 'A=b; c', outAt: 0 }], 8), /title=A\\=b\\; c\n$/);
});

test('a render keeps the kept parts, draws the text and keeps the chapters', async () => {
  let plan = twelve();
  plan = plans.addCut(plan, { from: 4, to: 8 }).plan;
  plan = plans.addText(plan, { from: 0, to: 2, text: 'Title', style: 'title' }).plan;
  plan = plans.addChapter(plan, { at: 0, title: 'Red' }).plan;
  plan = plans.addChapter(plan, { at: 8, title: 'Blue' }).plan;
  const out = path.join(dir, 'out.mp4');
  const result = await ffmpegEngine().render(plan, { paths: { speaker: source }, out, quality: 'low' });
  assert.strictEqual(result.durationSec, 8);
  assert.ok(Math.abs(durationOf(out) - 8) < 0.2, `rendered ${durationOf(out)}s`);
  assert.ok(near(pixel(out, 5, 10, 10), BLUE), 'after the cut comes the blue part');
  // The title's box is dark, in the middle, while it's on; the corner stays red.
  assert.ok(!near(pixel(out, 1, 160, 90), RED), 'the title is drawn in the middle');
  assert.ok(near(pixel(out, 1, 4, 4), RED));
  assert.ok(near(pixel(out, 3, 160, 90), RED), 'the title is gone after it ends');
  const meta = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', out, '-f', 'ffmetadata', '-']).toString();
  assert.match(meta, /title=Red/);
  assert.match(meta, /title=Blue/);
});

test('a frame shows the edit at a source time, and refuses a time that is cut', async () => {
  let plan = plans.addCut(twelve(), { from: 4, to: 8 }).plan;
  plan = plans.addText(plan, { from: 8, to: 12, text: 'Blue part', style: 'title' }).plan;
  const engine = ffmpegEngine();
  const out = path.join(dir, 'frame.jpg');
  const result = await engine.frame(plan, { paths: { speaker: source }, at: 9, out });
  assert.strictEqual(result.outputAt, 5);
  assert.ok(near(pixel(out, null, 4, 4), BLUE));
  assert.ok(!near(pixel(out, null, 160, 90), BLUE), 'the text is drawn');
  await assert.rejects(engine.frame(plan, { paths: { speaker: source }, at: 5, out }), /cut out; the video carries on at 8s/);
});

test('the quiet stretch is found', async () => {
  const engine = ffmpegEngine();
  assert.deepStrictEqual(await engine.probe(source), { durationSec: 12, width: 320, height: 180, fps: 25, hasAudio: true });
  const found = await engine.silences(source, { minSec: 1 });
  assert.strictEqual(found.length, 1);
  assert.ok(Math.abs(found[0].from - 5) < 0.1 && Math.abs(found[0].to - 7) < 0.1, JSON.stringify(found));
});

test('the command line edits a plan file, and refuses changes that break it', async () => {
  const file = path.join(dir, 'ep.json');
  const init = await main(['init', file, '--video', source]);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).source.video, 'src.mp4');
  assert.strictEqual(init.source.durationSec, 12);
  await assert.rejects(main(['init', file, '--video', source]), /already exists/);

  const dry = await main(['cut', file, '--from', '0', '--to', '1', '--dry-run']);
  assert.strictEqual(dry.saved, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).cuts.length, 0);

  const cut = await main(['cut', file, '--from', '4', '--to', '8', '--reason', 'green']);
  await assert.rejects(main(['cut', file, '--from', '10', '--to', '30']), /outside the recording/);
  const shown = await main(['show', file]);
  assert.strictEqual(shown.timeline.editedDurationSec, 8);
  await main(['remove', file, cut.change.item.id]);
  assert.strictEqual((await main(['show', file])).timeline.editedDurationSec, 12);

  // As a program: JSON out, and exit code 1 when something is wrong.
  const bad = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wave-edit.js'), 'frame', file, '--at', '1']);
  assert.strictEqual(bad.status, 1);
  assert.match(JSON.parse(bad.stdout.toString()).error, /frame needs --out/);
});
