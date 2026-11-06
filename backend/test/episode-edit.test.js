const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const episodeEdit = require('../src/episode-edit');
const plans = require('../src/edit-engine/plan');
const { fakeVideo } = require('./fake-video');

// Editing an episode's video on the website: the plan is saved as it's
// edited, made into a new video from the original upload when asked, and the
// episode's chapters, cover frame and transcript move to the new times.
// ffmpeg is stood in for (edit-engine tests run it for real).

const PASSCODE = 'test-passcode';
let server;
let base;
let video;
let db;

const renders = [];
let silencesCalls = 0;
let activityCalls = 0;
const engine = {
  // Recordings stay links here (the real engine downloads them).
  async downloadAll(paths) {
    return paths;
  },
  async probe(url) {
    return { durationSec: 120, width: 1280, height: 720, fps: 25, hasAudio: true, url };
  },
  async render(plan, opts) {
    renders.push({ plan, opts });
    await fs.writeFile(opts.out, 'video');
    return { out: opts.out };
  },
  async activity(url) {
    activityCalls++;
    return { blank: [{ from: 0, to: 2 }], changes: [5, 40], url };
  },
  async silences(url) {
    silencesCalls++;
    return [{ from: 10, to: 12, durationSec: 2, url }];
  },
};

// What the speech-to-text service hears in the 120-second original.
const WORDS = [
  ['Um,', 0.5, 1, 0], ['welcome', 1.5, 2, 0], ['everyone.', 2, 2.6, 0],
  ['Today', 30.5, 31, 1], ['is', 31, 31.2, 1], ['about', 31.2, 31.6, 1], ['tests.', 31.6, 32.2, 1],
  ['Let’s', 60.5, 61, 0], ['start.', 61, 61.6, 0],
].map(([word, start, end, speaker]) => ({ word, start, end, speaker }));
const transcriber = {
  model: 'test-stt',
  async transcribe() {
    const { wordsToCues } = require('../src/transcribe');
    return { cues: wordsToCues(WORDS), words: WORDS, cost: 0 };
  },
};

before(async () => {
  video = fakeVideo();
  video.state.durationSec = 120;
  db = new PGlite();
  server = createApp({ db, video, engine, transcriber, cleanUpEveryMs: 0, tint: async () => '#334455', hostPasscode: PASSCODE }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const host = async (method, p, body) => {
  const res = await fetch(`${base}/api/host${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Host-Passcode': PASSCODE }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

// Checks again until it's true (background work), for up to two seconds.
async function until(check) {
  for (let i = 0; i < 40; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out: ${check}`);
}

async function newEpisode() {
  const { videoId } = (await host('POST', '/uploads', { kind: 'episode' })).body;
  const ep = (
    await host('POST', '/episodes', {
      title: 'Testing with AI',
      videoId,
      chapters: [{ title: 'Intro', startSec: 0 }, { title: 'Topic', startSec: 60 }],
      thumbnailSec: 70,
    })
  ).body;
  assert.strictEqual((await host('POST', `/episodes/${ep.id}/transcribe`)).status, 200);
  return ep;
}

const episode = async (id) => (await host('GET', `/episodes/${id}`)).body;
const cues = async (videoId) => (await db.query('select start_sec, end_sec, text from transcript_cues where video_id = $1 order by idx', [videoId])).rows;
const made = (id) => until(async () => {
  const e = (await host('GET', `/episodes/${id}/edit`)).body;
  return e.edit.status === 'ready' && !e.edit.processing && e;
});

test('the editor gets the original, its transcript word by word, and an empty plan', async () => {
  const ep = await newEpisode();
  const { status, body } = await host('GET', `/episodes/${ep.id}/edit`);
  assert.strictEqual(status, 200);
  assert.strictEqual(body.durationSec, 120);
  assert.match(body.videoUrl, /^https:\/\/stream\.test\/play-asset\d+\.m3u8$/);
  assert.deepStrictEqual([body.plan.cuts, body.plan.texts, body.plan.source.video], [[], [], `video:${ep.video.id}`]);
  assert.strictEqual(body.locked, null);
  assert.deepStrictEqual(body.edit, { status: 'none', error: null, changed: false, processing: false });
  assert.deepStrictEqual(body.transcript.words[0], ['Um,', 0.5, 1]);
  assert.deepStrictEqual(body.transcript.lines.map((l) => l.text), ['Um, welcome everyone.', 'Today is about tests.', 'Let’s start.']);
});

test('a plan is checked and saved; making it cuts the original and moves chapters, cover and transcript', async () => {
  const ep = await newEpisode();
  const bad = await host('PUT', `/episodes/${ep.id}/edit`, { plan: { cuts: [{ from: 50, to: 200 }] } });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.body.error, /outside the recording/);
  assert.strictEqual((await host('PUT', `/episodes/${ep.id}/edit`, { plan: { cuts: 'all' } })).status, 400);

  const saved = await host('PUT', `/episodes/${ep.id}/edit`, {
    plan: {
      cuts: [{ id: 'cut_um', from: 0, to: 1.5, reason: 'filler: "Um,"' }, { from: 30, to: 60 }, { from: 100, to: 110, state: 'suggested' }],
      texts: [{ from: 2, to: 5, style: 'lower-third', text: 'Alice Chen', subtitle: 'Platform', evil: 'ignored' }],
      source: { video: 'https://elsewhere.test/x.mp4' },
    },
  });
  assert.strictEqual(saved.status, 200);
  assert.strictEqual(saved.body.plan.cuts[0].id, 'cut_um');
  assert.match(saved.body.plan.cuts[1].id, /^cut_[0-9a-f]{6}$/);
  assert.strictEqual(saved.body.plan.texts[0].evil, undefined);
  assert.strictEqual(saved.body.plan.source.video, `video:${ep.video.id}`, 'the source is ours, not the website’s');
  assert.strictEqual((await host('GET', `/episodes/${ep.id}/edit`)).body.edit.changed, true);

  assert.strictEqual((await host('POST', `/episodes/${ep.id}/edit/make`)).status, 202);
  const done = await made(ep.id);
  const render = renders.at(-1);
  assert.match(render.opts.paths.speaker, /^https:\/\/download\.test\/asset\d+\.mp4$/);
  assert.deepStrictEqual([render.plan.source.width, render.plan.source.height], [1280, 720]);
  assert.strictEqual(render.opts.quality, 'full');
  assert.ok(!render.opts.suggestions, 'suggestions nobody accepted stay out');
  assert.strictEqual(done.edit.changed, false);
  const original = (await db.query('select unedited_playback_id from videos where id = $1', [ep.video.id])).rows[0].unedited_playback_id;
  assert.strictEqual(done.videoUrl, `https://stream.test/${original}.m3u8`, 'the editor still plays the original');

  // Kept: 1.5–30 and 60–120 (the suggested cut isn't made).
  const after = await episode(ep.id);
  assert.deepStrictEqual(after.chapters, [{ title: 'Intro', startSec: 0 }, { title: 'Topic', startSec: 28.5 }]);
  assert.strictEqual(after.artworkUrl.includes('time=38.5'), true);
  const lines = await cues(ep.video.id);
  assert.deepStrictEqual(lines.map((c) => c.text), ['welcome everyone.', 'Let’s start.']);
  assert.deepStrictEqual([lines[1].start_sec, lines[1].end_sec], [29, 30.1]);
  // The editor's transcript stays in the original's times.
  assert.deepStrictEqual((await host('GET', `/episodes/${ep.id}/edit`)).body.transcript.lines[1].text, 'Today is about tests.');
});

test('editing again starts from the original, so cut parts come back; an empty plan restores it', async () => {
  const ep = await newEpisode();
  await host('PUT', `/episodes/${ep.id}/edit`, { plan: { cuts: [{ from: 30, to: 60 }] } });
  await host('POST', `/episodes/${ep.id}/edit/make`);
  await made(ep.id);
  const first = (await db.query('select asset_id, unedited_asset_id from videos where id = $1', [ep.video.id])).rows[0];
  assert.notStrictEqual(first.asset_id, first.unedited_asset_id);
  assert.strictEqual((await episode(ep.id)).chapters[1].startSec, 30);

  await host('PUT', `/episodes/${ep.id}/edit`, { plan: { cuts: [{ from: 0, to: 10 }] } });
  await host('POST', `/episodes/${ep.id}/edit/make`);
  await made(ep.id);
  assert.strictEqual((await episode(ep.id)).chapters[1].startSec, 50, '60 in the original, 10 seconds cut before it');
  assert.ok(video.state.calls.some(([name, id]) => name === 'deleteAsset' && id === first.asset_id), 'the first edit is deleted');
  assert.deepStrictEqual((await cues(ep.video.id)).map((c) => c.text), ['Today is about tests.', 'Let’s start.']);

  await host('PUT', `/episodes/${ep.id}/edit`, { plan: { cuts: [] } });
  await host('POST', `/episodes/${ep.id}/edit/make`);
  await until(async () => (await db.query('select unedited_asset_id from videos where id = $1', [ep.video.id])).rows[0].unedited_asset_id === null);
  const back = await episode(ep.id);
  assert.deepStrictEqual([back.chapters[1].startSec, back.artworkUrl.includes('time=70')], [60, true]);
  assert.strictEqual((await cues(ep.video.id)).length, 3);
  assert.strictEqual((await host('POST', `/episodes/${ep.id}/edit/make`)).status, 400, 'nothing to change');
});

test('pauses in the original are found once', async () => {
  const ep = await newEpisode();
  const before = silencesCalls;
  const first = await host('GET', `/episodes/${ep.id}/edit/pauses`);
  assert.deepStrictEqual(first.body.map((p) => [p.from, p.to]), [[10, 12]]);
  assert.match(first.body[0].url, /audio\.m4a$/);
  await host('GET', `/episodes/${ep.id}/edit/pauses`);
  assert.strictEqual(silencesCalls, before + 1);
});

test('a live episode can’t have its video edited', async () => {
  const ep = await newEpisode();
  assert.strictEqual((await host('PATCH', `/episodes/${ep.id}`, { status: 'published' })).status, 200);
  const edit = (await host('GET', `/episodes/${ep.id}/edit`)).body;
  assert.match(edit.locked, /live\. Unpublish it/);
  assert.strictEqual((await host('PUT', `/episodes/${ep.id}/edit`, { plan: { cuts: [] } })).status, 409);
  assert.strictEqual((await host('POST', `/episodes/${ep.id}/edit/make`)).status, 409);
  assert.strictEqual((await host('GET', '/episodes/nope/edit')).status, 404);
});

test('with an edit worker, the API only queues the edit and the worker makes it', async () => {
  const ep = await newEpisode();
  const api = createStore({ db, video, engine, transcriber, editWorker: 'external', cleanUpEveryMs: 0 });
  await api.saveEpisodeEdit(ep.id, { cuts: [{ from: 0, to: 5 }] });
  const count = renders.length;
  await api.makeEpisodeEdit(ep.id);
  await new Promise((r) => setTimeout(r, 100));
  await api.episodeEdit(ep.id);
  assert.strictEqual(renders.length, count, 'not made by the API');
  const worker = createStore({ db, video, engine, transcriber, editWorker: 'external', cleanUpEveryMs: 0 });
  assert.ok((await worker.makeQueuedEdits()) >= 1);
  assert.strictEqual(renders.length, count + 1);
  assert.strictEqual((await api.episodeEdit(ep.id)).edit.status, 'ready');
});

test('with the real ffmpeg, the edit is made from the original and sent to the video service', async () => {
  const { execFileSync, spawnSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const { ffmpegEngine } = require('../src/edit-engine/ffmpeg');
  const ffmpeg = require('ffmpeg-static');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'episode-edit-real-'));
  const original = path.join(dir, 'original.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=120:r=10', '-f', 'lavfi', '-i', 'sine=d=120', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', original]);
  const sent = path.join(dir, 'sent.mp4');
  const real = { ...video, downloadUrl: async () => original, uploadFile: async (url, file) => fs.copyFile(file, sent) };
  const store = createStore({ db, video: real, engine: ffmpegEngine(), transcriber, cleanUpEveryMs: 0, background: (p) => p });
  const ep = await newEpisode();
  await store.saveEpisodeEdit(ep.id, { cuts: [{ from: 0, to: 30 }, { from: 60, to: 100 }], texts: [{ from: 31, to: 40, style: 'title', text: 'Part one' }] });
  await store.makeEpisodeEdit(ep.id);
  for (let i = 0; i < 300 && !['ready', 'failed'].includes((await db.query('select edit_status from videos where id = $1', [ep.video.id])).rows[0].edit_status); i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual((await db.query('select edit_status, edit_error from videos where id = $1', [ep.video.id])).rows[0], { edit_status: 'ready', edit_error: null });
  const info = spawnSync(ffmpeg, ['-hide_banner', '-i', sent]).stderr.toString();
  assert.match(info, /Duration: 00:00:50/, '120 seconds less 30 and 40');
  assert.match(info, /Audio: aac/);
});

test('a screen recording joins the edit: lined up, shown in layouts, zoomed, and made with the episode', async () => {
  const ep = await newEpisode();
  const { videoId } = (await host('POST', '/uploads', { kind: 'screen' })).body;
  assert.deepStrictEqual(video.state.calls.filter(([n]) => n === 'createUpload').at(-1)[1], { audio: false, captions: false });

  const bad = await host('PUT', `/episodes/${ep.id}/edit/sources/speaker`, { videoId });
  assert.match(bad.body.error, /main recording/);
  const added = await host('PUT', `/episodes/${ep.id}/edit/sources/screen`, { videoId, offsetSec: 3 });
  assert.strictEqual(added.status, 200);
  assert.deepStrictEqual(added.body.plan.sources.screen, { video: `video:${videoId}`, durationSec: 120, width: 1920, height: 1080, offsetSec: 3 });

  const edit = (await host('GET', `/episodes/${ep.id}/edit`)).body;
  assert.match(edit.sources.screen.url, /^https:\/\/stream\.test\/play-asset\d+\.m3u8$/);
  assert.strictEqual(edit.sources.screen.offsetSec, 3);

  // Blank stretches and picture changes, on the original's clock; found once.
  const before = activityCalls;
  const act = (await host('GET', `/episodes/${ep.id}/edit/sources/screen/activity`)).body;
  assert.deepStrictEqual(act, { blank: [{ from: 3, to: 5 }], changes: [8, 43] });
  await host('GET', `/episodes/${ep.id}/edit/sources/screen/activity`);
  assert.strictEqual(activityCalls, before + 1);

  const saved = await host('PUT', `/episodes/${ep.id}/edit`, {
    plan: { scenes: [{ from: 10, to: 50, layout: 'screen+speaker', pip: 'top-right' }], zooms: [{ from: 20, to: 30, source: 'screen', rect: [0.5, 0, 0.5, 0.5] }] },
  });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.plan.scenes[0].source, undefined, 'the default screen source is fine');
  assert.strictEqual((await host('PUT', `/episodes/${ep.id}/edit`, { plan: { scenes: [{ from: 1, to: 2, layout: 'screen', source: 'camera' }] } })).status, 400);

  await host('POST', `/episodes/${ep.id}/edit/make`);
  await made(ep.id);
  const render = renders.at(-1);
  assert.match(render.opts.paths.screen, /^https:\/\/download\.test\/asset\d+\.mp4$/);
  assert.deepStrictEqual([render.plan.sources.screen.width, render.plan.sources.screen.height, render.plan.sources.screen.offsetSec], [1280, 720, 3], 'its real size, read from the file');
  assert.strictEqual(render.plan.scenes.length, 1);

  // Taking it out takes its layouts and zooms with it, and deletes it.
  const screenAsset = (await db.query('select asset_id from videos where id = $1', [videoId])).rows[0].asset_id;
  const removed = await host('DELETE', `/episodes/${ep.id}/edit/sources/screen`);
  assert.deepStrictEqual([removed.body.plan.sources, removed.body.plan.scenes, removed.body.plan.zooms], [{}, [], []]);
  assert.ok(video.state.calls.some(([n, id]) => n === 'deleteAsset' && id === screenAsset));
  assert.strictEqual((await db.query('select count(*)::int as n from videos where id = $1', [videoId])).rows[0].n, 0);
});

test('times move between versions of an edit, and transcripts are rebuilt by word', () => {
  const first = [{ from: 0, to: 30 }, { from: 60, to: 120 }];
  const second = [{ from: 10, to: 120 }];
  const move = episodeEdit.retimer(first, second);
  assert.strictEqual(move(40), 60, '70 in the original');
  assert.strictEqual(move(30), 50, 'a chapter where two parts join starts the later part: 60 in the original');
  assert.strictEqual(move(5), 0, 'cut now: where the video carries on');
  assert.strictEqual(episodeEdit.retimer(first, null)(40), 70);
  assert.strictEqual(episodeEdit.retimer(null, null)(40), 40);
  assert.strictEqual(plans.toSourceTime(first, 30), 60);
  assert.strictEqual(plans.toSourceTime(first, 30, { end: true }), 30);
  assert.strictEqual(plans.toSourceTime(first, 31), 61);
  assert.strictEqual(plans.toSourceTime(first, 90), 120, 'the very end');

  const cues = episodeEdit.transcriptFor(first, { words: WORDS });
  assert.deepStrictEqual(cues.map((c) => [c.text, c.startSec]), [['Um, welcome everyone.', 0.5], ['Let’s start.', 30.5]]);
  const byLine = episodeEdit.transcriptFor([{ from: 0, to: 31 }], { lines: [{ startSec: 1, endSec: 3, text: 'a' }, { startSec: 30, endSec: 33, text: 'b' }, { startSec: 50, endSec: 52, text: 'c' }] });
  assert.deepStrictEqual(byLine.map((c) => [c.text, c.endSec]), [['a', 3], ['b', 31]]);
  assert.strictEqual(episodeEdit.changesVideo({ cuts: [{ id: 'c', from: 1, to: 2, state: 'suggested' }] }), false);
});
