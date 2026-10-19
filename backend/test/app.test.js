const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { fakeVideo } = require('./fake-video');

let server;
let base;

before(async () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  fs.writeFileSync(path.join(mediaDir, 'ep001.mp3'), Buffer.alloc(1000, 1));
  server = createApp({ db: new PGlite(), video: fakeVideo(), tint: async () => '#334455', mediaDir }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('lists episodes newest first with absolute media URLs', async () => {
  const eps = await (await fetch(`${base}/api/episodes`)).json();
  assert.deepStrictEqual(eps.map((e) => e.id), ['ep002', 'ep001']);
  assert.strictEqual(eps[1].audioUrl, `${base}/media/ep001.mp3`);
  assert.strictEqual(eps[1].clips[0].videoUrl, `${base}/media/ep001-c1.mp4`);
});

test('root shows service status', async () => {
  const body = await (await fetch(`${base}/`)).json();
  assert.strictEqual(body.ok, true);
});

test('returns one episode, 404 for unknown', async () => {
  const ep = await (await fetch(`${base}/api/episodes/ep001`)).json();
  assert.strictEqual(ep.chapters.length, 3);
  assert.strictEqual((await fetch(`${base}/api/episodes/nope`)).status, 404);
});

test('shorts feed links each clip to its episode', async () => {
  const shorts = await (await fetch(`${base}/api/shorts`)).json();
  assert.strictEqual(shorts.length, 3);
  assert.strictEqual(shorts[0].episodeId, 'ep002');
  assert.ok(shorts.every((s) => s.startSec < s.endSec && s.episodeTitle));
});

test('stores and returns listening progress', async () => {
  const put = await fetch(`${base}/api/progress/ep001`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positionSec: 42 }),
  });
  assert.strictEqual(put.status, 200);
  const progress = await (await fetch(`${base}/api/progress`)).json();
  assert.strictEqual(progress.ep001.positionSec, 42);
});

test('rejects invalid progress', async () => {
  const res = await fetch(`${base}/api/progress/ep001`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positionSec: 9999 }),
  });
  assert.strictEqual(res.status, 400);
});

test('serves media with range requests', async () => {
  const res = await fetch(`${base}/media/ep001.mp3`, { headers: { Range: 'bytes=0-99' } });
  assert.strictEqual(res.status, 206);
  assert.strictEqual((await res.arrayBuffer()).byteLength, 100);
  assert.strictEqual((await fetch(`${base}/media/missing.mp3`)).status, 404);
});
