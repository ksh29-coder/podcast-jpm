const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { fakeVideo } = require('./fake-video');

const PASSCODE = 'test-passcode';
let server;
let base;
let video;

before(async () => {
  video = fakeVideo();
  server = createApp({ db: new PGlite(), video, hostPasscode: PASSCODE }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const host = async (method, path, body, passcode = PASSCODE) => {
  const res = await fetch(`${base}/api/host${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Host-Passcode': passcode },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const get = async (path) => (await fetch(`${base}${path}`)).json();

test('host routes need the passcode', async () => {
  assert.strictEqual((await host('GET', '/session', undefined, 'wrong')).status, 401);
  assert.strictEqual((await host('GET', '/session', undefined, '')).status, 401);
  assert.strictEqual((await host('GET', '/session')).status, 200);
});

test('uploaded episode stays hidden until published', async () => {
  const up = await host('POST', '/uploads', { kind: 'episode' });
  assert.strictEqual(up.status, 201);
  assert.match(up.body.uploadUrl, /^https:\/\/upload\.test\//);
  assert.deepStrictEqual(video.state.calls.at(-1), ['createUpload', { audio: true }]);

  const created = await host('POST', '/episodes', {
    title: 'Uploaded episode',
    description: 'From the web',
    videoId: up.body.videoId,
    chapters: [{ title: 'Intro', startSec: 0 }],
    thumbnailSec: 12,
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.status, 'draft');
  const id = created.body.id;

  assert.ok(!(await get('/api/episodes')).some((e) => e.id === id));
  assert.strictEqual((await fetch(`${base}/api/episodes/${id}`)).status, 404);

  const published = await host('PATCH', `/episodes/${id}`, { status: 'published' });
  assert.strictEqual(published.status, 200);
  assert.strictEqual(published.body.status, 'published');

  const ep = await get(`/api/episodes/${id}`);
  assert.strictEqual(ep.durationSec, 600);
  assert.match(ep.videoUrl, /\.m3u8$/);
  assert.match(ep.audioUrl, /audio\.m4a$/);
  assert.match(ep.artworkUrl, /time=12/);
  assert.strictEqual((await get('/api/episodes'))[0].id, id);
});

test("can't publish while the video is still uploading", async () => {
  video.state.uploadDone = false;
  try {
    const up = await host('POST', '/uploads', { kind: 'episode' });
    const created = await host('POST', '/episodes', { title: 'Not yet', videoId: up.body.videoId });
    const res = await host('PATCH', `/episodes/${created.body.id}`, { status: 'published' });
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await host('GET', `/videos/${up.body.videoId}`)).body.status, 'uploading');
  } finally {
    video.state.uploadDone = true;
  }
});

test('a Short cut from an episode', async () => {
  const tooLong = await host('POST', '/shorts', { title: 'x', episodeId: 'ep001', startSec: 0, endSec: 120 });
  assert.strictEqual(tooLong.status, 400);
  const outside = await host('POST', '/shorts', { title: 'x', episodeId: 'ep001', startSec: 170, endSec: 200 });
  assert.strictEqual(outside.status, 400);

  const res = await host('POST', '/shorts', { title: 'Best bit', episodeId: 'ep001', startSec: 10, endSec: 40, focusX: 0.3 });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.status, 'draft');
  // Seeded episodes have static MP4s, so the clip is cut from their public URL.
  assert.match(video.state.calls.at(-1)[1].sourceUrl, /\/media\/ep001\.mp4$/);

  await host('PATCH', `/shorts/${res.body.id}`, { status: 'published' });
  const short = (await get('/api/shorts')).find((s) => s.id === res.body.id);
  assert.strictEqual(short.episodeId, 'ep001');
  assert.strictEqual(short.focusX, 0.3);
  assert.match(short.videoUrl, /\.m3u8$/);
  assert.ok((await get('/api/episodes/ep001')).clips.some((c) => c.id === res.body.id));
});

test('an uploaded Short, with and without an episode', async () => {
  video.state.durationSec = 45;
  const up = await host('POST', '/uploads', { kind: 'short' });
  assert.deepStrictEqual(video.state.calls.at(-1), ['createUpload', { audio: false }]);
  const res = await host('POST', '/shorts', { title: 'From my phone', videoId: up.body.videoId });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.episodeId, null);
  assert.strictEqual((await host('PATCH', `/shorts/${res.body.id}`, { status: 'published' })).status, 200);
  const short = (await get('/api/shorts')).find((s) => s.id === res.body.id);
  assert.strictEqual(short.episodeId, null);
  assert.match(short.artworkUrl, /^https:\/\/image\.test\//);
});

test('an uploaded Short over 90 seconds is refused at publish', async () => {
  video.state.durationSec = 120;
  const up = await host('POST', '/uploads', { kind: 'short' });
  const res = await host('POST', '/shorts', { title: 'Too long', videoId: up.body.videoId });
  assert.strictEqual((await host('PATCH', `/shorts/${res.body.id}`, { status: 'published' })).status, 400);
});

test('validates input and status', async () => {
  assert.strictEqual((await host('POST', '/uploads', { kind: 'podcast' })).status, 400);
  assert.strictEqual((await host('POST', '/episodes', { videoId: 'x' })).status, 400);
  assert.strictEqual((await host('PATCH', '/episodes/ep001', { status: 'live' })).status, 400);
  assert.strictEqual((await host('PATCH', '/episodes/nope', { title: 'x' })).status, 404);
});

test('unpublishing hides an episode again', async () => {
  await host('PATCH', '/episodes/ep002', { status: 'draft' });
  assert.ok(!(await get('/api/episodes')).some((e) => e.id === 'ep002'));
  const all = (await host('GET', '/episodes')).body;
  assert.strictEqual(all.find((e) => e.id === 'ep002').status, 'draft');
  await host('PATCH', '/episodes/ep002', { status: 'published' });
});

test('audio that finishes after the video is still picked up', async () => {
  video.state.durationSec = 600;
  video.state.audioLate = true;
  const up = await host('POST', '/uploads', { kind: 'episode' });
  // Checked before any episode exists, as the upload screen does.
  assert.strictEqual((await host('GET', `/videos/${up.body.videoId}`)).body.audioReady, false);
  video.state.audioLate = false;
  assert.strictEqual((await host('GET', `/videos/${up.body.videoId}`)).body.audioReady, true);
});

test('an episode video with no sound becomes a video-only episode', async () => {
  video.state.silent = true;
  try {
    const up = await host('POST', '/uploads', { kind: 'episode' });
    const v = (await host('GET', `/videos/${up.body.videoId}`)).body;
    assert.strictEqual(v.status, 'ready');
    assert.strictEqual(v.hasAudio, false);
    const created = await host('POST', '/episodes', { title: 'Silent', videoId: up.body.videoId });
    assert.strictEqual((await host('PATCH', `/episodes/${created.body.id}`, { status: 'published' })).status, 200);
    const ep = await get(`/api/episodes/${created.body.id}`);
    assert.strictEqual(ep.audioUrl, null);
    assert.match(ep.videoUrl, /\.m3u8$/);
  } finally {
    video.state.silent = false;
  }
});

test('a silent Short is fine, since Shorts have no audio mode', async () => {
  video.state.silent = true;
  video.state.durationSec = 30;
  try {
    const up = await host('POST', '/uploads', { kind: 'short' });
    assert.strictEqual((await host('GET', `/videos/${up.body.videoId}`)).body.status, 'ready');
  } finally {
    video.state.silent = false;
  }
});
