const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { ffmpegEditor } = require('../src/edit');
const { fakeVideo } = require('./fake-video');

// Pictures in Shorts: uploaded in pieces, placed by the uploader, drawn into
// the video in the background; changeable in review, fixed once live.

const PASSCODE = 'test-passcode';
const ALICE = 'aaaaaaaa-1111-2222-3333-777777777777';
const BOB = 'bbbbbbbb-1111-2222-3333-777777777777';
let server;
let base;
let video;
let db;
// The real picture checks; rendering is recorded instead (edit.test.js runs ffmpeg).
const renders = [];
let holdRender = null;
const real = ffmpegEditor();
const editor = {
  normalizePicture: real.normalizePicture,
  async render(job, use) {
    renders.push(job);
    if (holdRender) await holdRender;
    return use('/tmp/edited.mp4');
  },
};

let png;
before(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pic-')), 'p.png');
  execFileSync(require('ffmpeg-static'), ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:s=400x200', '-frames:v', '1', file]);
  png = fs.readFileSync(file);
  video = fakeVideo();
  video.state.durationSec = 30;
  db = new PGlite();
  server = createApp({ db, video, editor, cleanUpEveryMs: 0, tint: async () => '#334455', hostPasscode: PASSCODE }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const call = (headers) => async (method, p, body) => {
  const res = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const alice = call({ 'X-Device-Id': ALICE });
const bob = call({ 'X-Device-Id': BOB });
const host = (method, p, body) => call({ 'X-Host-Passcode': PASSCODE })(method, `/api/host${p}`, body);
const piece = (who, id, offset, bytes) =>
  fetch(`${base}/api/me/pictures/${id}?offset=${offset}`, { method: 'PUT', headers: { 'X-Device-Id': who, 'Content-Type': 'application/octet-stream' }, body: bytes }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));

// Checks again until it's true (background work), for up to two seconds.
async function until(check) {
  for (let i = 0; i < 40; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out: ${check}`);
}

async function addPicture(who = ALICE) {
  const { id } = (await call({ 'X-Device-Id': who })('POST', '/api/me/pictures')).body;
  assert.strictEqual((await piece(who, id, 0, png)).status, 200);
  return (await call({ 'X-Device-Id': who })('POST', `/api/me/pictures/${id}/done`)).body;
}

async function postShort(pictures) {
  const up = (await alice('POST', '/api/me/uploads', {})).body;
  await alice('GET', `/api/me/uploads/${up.videoId}`);
  return (await alice('POST', '/api/me/shorts', { videoId: up.videoId, title: 'With pictures', pictures })).body;
}

const mine = async (id) => (await alice('GET', '/api/me/shorts')).body.find((s) => s.id === id);
const videoRow = async (shortId) => (await db.query('select v.* from videos v join shorts s on s.video_id = v.id where s.id = $1', [shortId])).rows[0];

test('a picture goes up in pieces, a repeated piece once, and comes back checked', async () => {
  await alice('PUT', '/api/me', { name: 'Alice', acceptGuidelines: true });
  const { id } = (await alice('POST', '/api/me/pictures')).body;
  assert.match(id, /^pic_[0-9a-f]{24}$/);
  const half = png.length >> 1;
  assert.deepStrictEqual((await piece(ALICE, id, 0, png.subarray(0, half))).body, { received: half });
  // Sent again after a lost reply: not added twice.
  assert.deepStrictEqual((await piece(ALICE, id, 0, png.subarray(0, half))).body, { received: half });
  assert.strictEqual((await piece(ALICE, id, 5, png.subarray(half))).status, 409);
  // Not someone else's to add to.
  assert.strictEqual((await piece(BOB, id, half, png.subarray(half))).status, 404);
  await piece(ALICE, id, half, png.subarray(half));

  const done = (await alice('POST', `/api/me/pictures/${id}/done`)).body;
  assert.deepStrictEqual(done, { id, url: `${base}/api/pictures/${id}`, width: 400, height: 200 });
  const file = await fetch(done.url);
  assert.strictEqual(file.headers.get('content-type'), 'image/png');
  assert.ok((await file.arrayBuffer()).byteLength > 0);

  const { id: bad } = (await alice('POST', '/api/me/pictures')).body;
  await piece(ALICE, bad, 0, Buffer.from('not a picture at all'));
  const refused = await alice('POST', `/api/me/pictures/${bad}/done`);
  assert.strictEqual(refused.status, 400);
  assert.match(refused.body.error, /JPEG, PNG/);
});

test('posting with pictures makes the video again with them, keeping the one without', async () => {
  const pic = await addPicture();
  const pictures = [
    { pictureId: pic.id, kind: 'overlay', startSec: 2, endSec: 6, x: 0.5, y: 0.1, w: 0.4 },
    { pictureId: pic.id, kind: 'full', startSec: 10, endSec: 13 },
  ];
  // Someone else's picture can't be used.
  const theirs = await addPicture(BOB);
  const up = (await alice('POST', '/api/me/uploads', {})).body;
  const refused = await alice('POST', '/api/me/shorts', { videoId: up.videoId, title: 'x', pictures: [{ ...pictures[1], pictureId: theirs.id }] });
  assert.strictEqual(refused.status, 400);
  await alice('DELETE', `/api/me/uploads/${up.videoId}`);

  const short = await postShort(pictures);
  const job = await until(() => renders.at(-1)?.pictures.length === 2 && renders.at(-1));
  assert.deepStrictEqual(
    job.pictures.map(({ data, ...p }) => p),
    [
      { pictureId: pic.id, kind: 'overlay', startSec: 2, endSec: 6, x: 0.5, y: 0.1, w: 0.4, id: pic.id, mime: 'image/png', width: 400, height: 200 },
      { pictureId: pic.id, kind: 'full', startSec: 10, endSec: 13, id: pic.id, mime: 'image/png', width: 400, height: 200 },
    ]
  );

  // Shown as being worked on, then the new video replaces the old one.
  const done = await until(async () => {
    const s = await mine(short.id);
    return s.video.status === 'ready' && s.video.edit.status === 'ready' && s;
  });
  assert.strictEqual(done.pictureCount, 2);
  const after = await videoRow(short.id);
  assert.strictEqual(job.videoUrl, `https://download.test/${after.unedited_asset_id}.mp4`);
  assert.ok(after.asset_id && after.asset_id !== after.unedited_asset_id);
  assert.ok(video.state.calls.some(([name]) => name === 'uploadFile'));

  // The editor places them on the video without pictures.
  const editing = (await alice('GET', `/api/me/shorts/${short.id}/pictures`)).body;
  assert.strictEqual(editing.videoUrl, `https://stream.test/${after.unedited_playback_id}.m3u8`);
  assert.strictEqual(editing.editable, true);
  assert.deepStrictEqual(editing.pictures[0].picture, { id: pic.id, url: `${base}/api/pictures/${pic.id}`, width: 400, height: 200 });
});

test('pictures change in review; taking them all out goes back to the video without them', async () => {
  const pic = await addPicture();
  const short = await postShort([{ pictureId: pic.id, kind: 'full', startSec: 0, endSec: 2 }]);
  await until(async () => {
    const s = await mine(short.id);
    return s.video.status === 'ready' && s.video.edit.status === 'ready';
  });
  const first = await videoRow(short.id);

  const moved = [{ pictureId: pic.id, kind: 'full', startSec: 5, endSec: 8 }];
  assert.strictEqual((await alice('PUT', `/api/me/shorts/${short.id}/pictures`, { pictures: moved })).status, 200);
  await until(async () => {
    const s = await mine(short.id);
    return s.video.status === 'ready' && s.video.edit.status === 'ready' && (await videoRow(short.id)).asset_id !== first.asset_id;
  });
  // Made from the one without pictures again; the earlier edited one is gone.
  assert.strictEqual(renders.at(-1).videoUrl, `https://download.test/${first.unedited_asset_id}.mp4`);
  assert.ok(video.state.calls.some(([name, id]) => name === 'deleteAsset' && id === first.asset_id));

  const second = await videoRow(short.id);
  await alice('PUT', `/api/me/shorts/${short.id}/pictures`, { pictures: [] });
  await until(async () => {
    await mine(short.id);
    const v = await videoRow(short.id);
    return v.status === 'ready' && v.edit_status === 'none' && v;
  });
  const back = await videoRow(short.id);
  assert.strictEqual(back.asset_id, first.unedited_asset_id);
  assert.strictEqual(back.unedited_asset_id, null);
  assert.ok(video.state.calls.some(([name, id]) => name === 'deleteAsset' && id === second.asset_id));

  // Others can't see or change them.
  assert.strictEqual((await bob('GET', `/api/me/shorts/${short.id}/pictures`)).status, 404);
});

test('a host can’t approve while pictures are being added; once live they’re fixed and the extras go', async () => {
  const pic = await addPicture();
  let release;
  holdRender = new Promise((r) => (release = r));
  const short = await postShort([{ pictureId: pic.id, kind: 'overlay', startSec: 1, endSec: 3, x: 0, y: 0, w: 0.3 }]);
  await until(async () => (await videoRow(short.id)).edit_status === 'rendering');

  const early = await host('PATCH', `/shorts/${short.id}`, { status: 'published' });
  assert.strictEqual(early.status, 409);
  assert.match(early.body.error, /still being added/);
  // Nor can the uploader change them mid-way.
  assert.strictEqual((await alice('PUT', `/api/me/shorts/${short.id}/pictures`, { pictures: [] })).status, 409);

  release();
  holdRender = null;
  await until(async () => (await mine(short.id)).video.status === 'ready');
  const edited = await videoRow(short.id);
  assert.strictEqual((await host('PATCH', `/shorts/${short.id}`, { status: 'published' })).status, 200);

  assert.ok(video.state.calls.some(([name, id]) => name === 'deleteAsset' && id === edited.unedited_asset_id));
  assert.strictEqual((await fetch(`${base}/api/pictures/${pic.id}`)).status, 404);
  const editing = (await alice('GET', `/api/me/shorts/${short.id}/pictures`)).body;
  assert.strictEqual(editing.editable, false);
  assert.strictEqual(editing.videoUrl, null);
});

test('bad picture lists are refused', async () => {
  const pic = await addPicture();
  const up = (await alice('POST', '/api/me/uploads', {})).body;
  await alice('GET', `/api/me/uploads/${up.videoId}`);
  for (const pictures of [
    [{ pictureId: pic.id, kind: 'sticker', startSec: 0, endSec: 1 }],
    [{ pictureId: pic.id, kind: 'full', startSec: 3, endSec: 3 }],
    [{ pictureId: pic.id, kind: 'overlay', startSec: 0, endSec: 1, x: 0, y: 0 }],
    Array.from({ length: 6 }, () => ({ pictureId: pic.id, kind: 'full', startSec: 0, endSec: 1 })),
    [{ pictureId: pic.id, kind: 'full', startSec: 40, endSec: 41 }],
  ]) {
    assert.strictEqual((await alice('POST', '/api/me/shorts', { videoId: up.videoId, title: 'x', pictures })).status, 400, JSON.stringify(pictures[0]));
  }
  // Nothing was posted on the way.
  assert.strictEqual((await db.query('select count(*)::int as n from shorts where video_id = $1', [up.videoId])).rows[0].n, 0);
});
