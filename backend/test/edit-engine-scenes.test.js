const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const plans = require('../src/edit-engine/plan');
const { ffmpegEngine, zoomExpressions } = require('../src/edit-engine/ffmpeg');
const { main, call, tools, COMMANDS } = require('../bin/wave-edit');

// Suggestions from AI editors, the screen share as a second recording,
// scenes (layouts) and zooms. The "speaker" recording is red with a tone;
// the "screen" recording starts 2 seconds later and is black for its first
// 2 seconds (no share yet), then its left half is green and right half blue.

const ffmpeg = require('ffmpeg-static');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-scenes-test-'));
const make = (name, args) => {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args, path.join(dir, name)]);
  return path.join(dir, name);
};
const speaker = make('speaker.mp4', ['-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=12:r=25', '-f', 'lavfi', '-i', 'sine=d=12', '-shortest', '-c:v', 'libx264', '-c:a', 'aac']);
const screen = make('screen.mp4', [
  '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=2:r=25',
  '-f', 'lavfi', '-i', 'color=c=green:s=320x360:d=8:r=25',
  '-f', 'lavfi', '-i', 'color=c=blue:s=320x360:d=8:r=25',
  '-filter_complex', '[1][2]hstack[s];[0][s]concat=n=2:v=1:a=0', '-c:v', 'libx264',
]);
const pixel = (file, x, y) => [...execFileSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3)];
const near = (actual, expected) => actual.every((c, i) => Math.abs(c - expected[i]) < 60);
const RED = [255, 0, 0];
const GREEN = [0, 128, 0];
const BLUE = [0, 0, 255];
const BLACK = [0, 0, 0];

const base = () => {
  const p = plans.emptyPlan({ video: 'speaker.mp4', durationSec: 12, width: 320, height: 180, fps: 25, hasAudio: true });
  return plans.addSource(p, 'screen', { video: 'screen.mp4', durationSec: 10, width: 640, height: 360, offsetSec: 2 }).plan;
};
const PATHS = { speaker, screen };

test('suggestions show in previews, and only reach the final edit once accepted', () => {
  let p = base();
  p = plans.addCut(p, { from: 0, to: 2, reason: 'small talk', by: 'rough-cut', suggest: true }).plan;
  p = plans.addCut(p, { from: 10, to: 12 }).plan;
  const [s] = plans.suggestions(p);
  assert.deepStrictEqual({ kind: s.kind, from: s.from, reason: s.reason, by: s.by, state: s.state }, { kind: 'cut', from: 0, reason: 'small talk', by: 'rough-cut', state: 'suggested' });
  assert.strictEqual(plans.timeline(p).durationSec, 8, 'previews include the suggestion');
  assert.strictEqual(plans.timeline(plans.included(p, { suggestions: false })).durationSec, 10, 'the final edit leaves it out');

  const accepted = plans.accept(p, [s.id]).plan;
  assert.strictEqual(accepted.cuts.find((c) => c.id === s.id).state, undefined);
  assert.strictEqual(plans.timeline(plans.included(accepted, { suggestions: false })).durationSec, 8);
  assert.strictEqual(plans.reject(p, 'all').plan.cuts.length, 1);
  assert.throws(() => plans.accept(accepted, [s.id]), /isn’t a suggestion/);
});

test('scenes and zooms are checked: known layouts and recordings, one at a time, inside the picture', () => {
  const p = base();
  p.scenes.push({ id: 's1', from: 1, to: 5, layout: 'screen', source: 'screen' }, { id: 's2', from: 4, to: 6, layout: 'pip-wall', source: 'slides' });
  p.zooms.push({ id: 'z1', from: 2, to: 6, source: 'screen', rect: [0.6, 0, 0.5, 0.5] }, { id: 'z2', from: 5, to: 5.5, source: 'speaker', rect: [0, 0, 0.5, 0.5] });
  const { errors, warnings } = plans.validate(p);
  for (const e of ['unknown layout', 'no "slides" recording', 's2: overlaps scene s1', 'z1: rect must be inside']) {
    assert.ok(errors.some((x) => x.includes(e)), `expected an error about "${e}" in ${JSON.stringify(errors)}`);
  }
  assert.ok(warnings.some((w) => w.includes('z2: a zoom this short')));

  const unseen = base();
  unseen.zooms.push({ id: 'z3', from: 2, to: 6, source: 'screen', rect: [0, 0, 0.5, 0.5] });
  assert.ok(plans.validate(unseen).warnings.some((w) => w.includes('z3: no scene shows "screen"')));
  unseen.zooms.push({ id: 'z4', from: 7, to: 9, source: 'speaker', rect: [0.5, 0, 0.5, 1] });
  assert.ok(plans.validate(unseen).warnings.some((w) => w.includes('z4: this hardly zooms in (1.00x)')));
  assert.throws(() => plans.addZoom(base(), { from: 1, to: 3, rect: '0.5,0.5' }), /rect must be x,y,w,h/);
  assert.throws(() => plans.addSource(base(), 'speaker', {}), /main recording/);
});

test('a zoom eases from the whole picture to its rect and back', () => {
  const e = zoomExpressions([{ outFrom: 2, outTo: 6, rect: [0.5, 0, 0.5, 0.5] }]);
  const at = (expr, it, zoom = 2, iw = 100, ih = 100) =>
    // Enough of ffmpeg's expressions to try these: clip and arithmetic.
    Function('it', 'iw', 'ih', 'zoom', 'clip', `return ${expr}`)(it, iw, ih, zoom, (v, a, b) => Math.min(b, Math.max(a, v)));
  assert.strictEqual(at(e.z, 1), 1);
  assert.strictEqual(at(e.z, 2.25), 1.5);
  assert.strictEqual(at(e.z, 4), 2);
  assert.strictEqual(at(e.x, 4), 50, 'the right half starts halfway across');
  assert.strictEqual(at(e.y, 4), 0);
  assert.strictEqual(at(e.z, 6), 1);
});

test('the screen share lines up with the speaker, in each layout', async () => {
  let p = base();
  p = plans.addScene(p, { from: 1, to: 3, layout: 'screen' }).plan;
  p = plans.addScene(p, { from: 4, to: 6, layout: 'screen+speaker', pip: 'top-left' }).plan;
  p = plans.addScene(p, { from: 6, to: 8, layout: 'side-by-side' }).plan;
  p = plans.addScene(p, { from: 8, to: 12, layout: 'screen', suggest: true }).plan;
  p = plans.addZoom(p, { from: 8, to: 12, rect: '0.5,0.25,0.5,0.5', suggest: true }).plan;
  const engine = ffmpegEngine();
  const frame = async (at, opts = {}) => {
    const out = path.join(dir, `f${at}.jpg`);
    await engine.frame(p, { paths: PATHS, at, out, ...opts });
    return out;
  };

  // Before the share starts (main 2s = screen −0s): black, as the screen recording hasn't begun.
  assert.ok(near(pixel(await frame(1.5), 160, 90), BLACK));
  // Speaker outside scenes.
  assert.ok(near(pixel(await frame(3.5), 160, 90), RED));
  // Screen with the speaker in the top-left corner (the share is on by main 4s).
  const pip = await frame(5);
  assert.ok(near(pixel(pip, 10, 10), RED), 'the speaker is in the corner');
  assert.ok(near(pixel(pip, 60, 150), GREEN) && near(pixel(pip, 260, 150), BLUE), 'the screen fills the rest');
  // Side by side: the screen on the left (both halves, smaller), the speaker on the right.
  const side = await frame(7);
  assert.ok(near(pixel(side, 30, 90), GREEN) && near(pixel(side, 170, 90), BLUE) && near(pixel(side, 290, 90), RED));
  // Zoomed into the screen's right half: all blue, once eased in…
  assert.ok(near(pixel(await frame(10), 20, 90), BLUE));
  // …but not without the suggestions, where it's the speaker again.
  assert.ok(near(pixel(await frame(10, { suggestions: false }), 20, 90), RED));
});

test('a render switches between layouts, and keeps the speaker’s sound', async () => {
  let p = base();
  p = plans.addCut(p, { from: 0, to: 4 }).plan;
  p = plans.addScene(p, { from: 4, to: 8, layout: 'screen' }).plan;
  const out = path.join(dir, 'scenes.mp4');
  const result = await ffmpegEngine().render(p, { paths: PATHS, out, quality: 'low' });
  assert.strictEqual(result.durationSec, 8);
  const at = (sec) => {
    const f = path.join(dir, `r${sec}.jpg`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(sec), '-i', out, '-frames:v', '1', f]);
    return f;
  };
  assert.ok(near(pixel(at(1), 300, 90), BLUE), 'the screen first');
  assert.ok(near(pixel(at(6), 300, 90), RED), 'then the speaker');
  assert.match(spawnSync(ffmpeg, ['-hide_banner', '-i', out]).stderr.toString(), /Audio: aac/);
});

test('activity finds when the screen share is blank and when it changes, on the main clock', async () => {
  const { blank, changes } = await ffmpegEngine().activity(screen, { offsetSec: 2 });
  assert.strictEqual(blank.length, 1);
  assert.ok(Math.abs(blank[0].from - 2) < 0.1 && Math.abs(blank[0].to - 4) < 0.2, JSON.stringify(blank));
  assert.ok(changes.some((t) => Math.abs(t - 4) < 0.2), JSON.stringify(changes));
});

test('look shows a recording’s own picture with a grid to read positions off', async () => {
  const out = path.join(dir, 'look.jpg');
  const result = await ffmpegEngine().look(base(), { paths: PATHS, source: 'screen', at: 6, out });
  assert.deepStrictEqual([result.width, result.height, result.grid], [640, 360, true]);
  assert.ok(near(pixel(out, 100, 200), GREEN));
  assert.ok(!near(pixel(out, 64, 200), GREEN), 'a grid line at 0.1');
  await assert.rejects(ffmpegEngine().look(base(), { paths: PATHS, source: 'screen', at: 1, out }), /doesn’t cover 1s/);
});

test('every command is a tool for an AI model, and tool calls run the command line', async () => {
  const list = tools();
  assert.strictEqual(list.length, COMMANDS.length);
  for (const t of list) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.description.length > 10, t.name);
    assert.strictEqual(t.input_schema.type, 'object');
    assert.ok(t.input_schema.required.includes('plan'));
  }
  const scene = list.find((t) => t.name === 'scene');
  assert.deepStrictEqual(scene.input_schema.properties.layout.enum, plans.LAYOUTS);
  assert.deepStrictEqual(scene.input_schema.required, ['plan', 'from', 'to', 'layout']);
  assert.ok(list.find((t) => t.name === 'cut').input_schema.properties.suggest);

  const file = path.join(dir, 'ep.json');
  await call('init', { plan: file, video: speaker });
  await call('add_source', { plan: file, name: 'screen', video: screen, offset: 2 });
  const made = await call('scene', { plan: file, from: 4, to: 8, layout: 'screen+speaker', suggest: true, by: 'scene-director', reason: 'demo starts' });
  await call('cut', { plan: file, from: 0, to: 1, suggest: true, by: 'rough-cut', reason: 'hello, can you hear me' });
  const listed = (await call('suggestions', { plan: file })).suggestions;
  assert.deepStrictEqual(listed.map((s) => [s.what, s.by]), [
    ['Cut 0s–1s (1s)', 'rough-cut'],
    ['Show screen+speaker (screen), 4s–8s', 'scene-director'],
  ]);
  await call('accept', { plan: file, ids: [made.change.item.id], by: 'host' });
  await call('reject', { plan: file, all: true, by: 'host' });
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual([plan.scenes.length, plan.scenes[0].state, plan.cuts.length], [1, undefined, 0]);
  assert.deepStrictEqual(plan.log.map((l) => [l.op, l.by]), [['add', null], ['add', 'scene-director'], ['add', 'rough-cut'], ['accept', 'host'], ['reject', 'host']]);

  await assert.rejects(call('scene', { plan: file, from: 1, to: 2, layout: 'mosaic' }), /--layout must be one of/);
  await assert.rejects(call('accept', { plan: file }), /Say which.*\(or --all\)/);
  await assert.rejects(main(['zoom', file, '--from', '1', '--to', '3']), /zoom needs --rect/);
});
