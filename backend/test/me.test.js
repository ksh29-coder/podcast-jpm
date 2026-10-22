const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { fakeVideo } = require('./fake-video');

// Posting Shorts from the app: anyone can, a host approves.

const PASSCODE = 'test-passcode';
const ALICE = 'aaaaaaaa-1111-2222-3333-555555555555';
const BOB = 'bbbbbbbb-1111-2222-3333-555555555555';
const aiCalls = [];
// Stands in for OpenRouter, replying like a slightly sloppy model.
const fakeAi = {
  model: 'test/fake',
  async episodeInsights() {
    return {};
  },
  async shortSuggestions(input) {
    aiCalls.push(input);
    return {
      title: '  Kubernetes   operators in a minute ',
      description: 'Why operators beat scripts.',
      tags: ['#Kubernetes', 'kubernetes', 'Ops', 'cloud native'],
      coverSec: 9999,
      concerns: ['0:04 names a client', ''],
    };
  },
};
let server;
let base;
let video;
let db;

before(async () => {
  video = fakeVideo();
  db = new PGlite();
  server = createApp({ db, video, ai: fakeAi, cleanUpEveryMs: 0, tint: async () => '#334455', hostPasscode: PASSCODE }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const call = (headers) => async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const alice = call({ 'X-Device-Id': ALICE });
const bob = call({ 'X-Device-Id': BOB });
const host = (method, path, body) => call({ 'X-Host-Passcode': PASSCODE })(method, `/api/host${path}`, body);

test('posting needs a name and the guidelines first', async () => {
  assert.deepStrictEqual((await alice('GET', '/api/me')).body, { name: null, acceptedGuidelines: false, maxShortSec: 90 });
  assert.strictEqual((await alice('POST', '/api/me/uploads', {})).status, 403);
  assert.strictEqual((await alice('PUT', '/api/me', { name: '' })).status, 400);
  // A name alone isn't enough.
  assert.strictEqual((await alice('PUT', '/api/me', { name: 'Alice' })).body.acceptedGuidelines, false);
  assert.strictEqual((await alice('POST', '/api/me/uploads', {})).status, 403);
  const me = (await alice('PUT', '/api/me', { name: 'Alice', acceptGuidelines: true })).body;
  assert.deepStrictEqual([me.name, me.acceptedGuidelines], ['Alice', true]);
  // Renaming keeps the agreement.
  assert.strictEqual((await alice('PUT', '/api/me', { name: 'Alice K' })).body.acceptedGuidelines, true);
  // Without a device id there's no "me".
  assert.strictEqual((await call({})('GET', '/api/me')).status, 400);
});

test('an upload gets suggestions from what is said, then waits for review', async () => {
  video.state.durationSec = 40;
  const up = await alice('POST', '/api/me/uploads', {});
  assert.strictEqual(up.status, 201);
  const state = (await alice('GET', `/api/me/uploads/${up.body.videoId}`)).body;
  assert.strictEqual(state.status, 'ready');
  assert.strictEqual(state.suggestions.status, 'ready');
  assert.strictEqual(state.suggestions.title, 'Kubernetes operators in a minute');
  assert.deepStrictEqual(state.suggestions.tags, ['kubernetes', 'ops', 'cloud-native']);
  // A cover time outside the video falls back to the middle.
  assert.strictEqual(state.suggestions.coverSec, 20);
  assert.ok(state.frames.length >= 6 && state.frames.every((f) => f.url.startsWith('https://image.test/')));
  assert.match(aiCalls.at(-1).cues[0].text, /Welcome/);
  // Asking again doesn't ask the AI again.
  await alice('GET', `/api/me/uploads/${up.body.videoId}`);
  assert.strictEqual(aiCalls.length, 1);

  // Someone else's upload isn't visible, or postable.
  assert.strictEqual((await bob('GET', `/api/me/uploads/${up.body.videoId}`)).status, 404);
  await bob('PUT', '/api/me', { name: 'Bob', acceptGuidelines: true });
  assert.strictEqual((await bob('POST', '/api/me/shorts', { videoId: up.body.videoId, title: 'Mine now' })).status, 404);

  assert.strictEqual((await alice('POST', '/api/me/shorts', { videoId: up.body.videoId })).status, 400);
  const posted = await alice('POST', '/api/me/shorts', { videoId: up.body.videoId, title: 'Operators', description: 'A tip', tags: ['k8s'], coverSec: 12 });
  assert.strictEqual(posted.status, 201);
  assert.strictEqual(posted.body.status, 'in_review');
  assert.match(posted.body.artworkUrl, /time=12/);
  assert.strictEqual(posted.body.aiCheck, undefined);
  // Sending it again (a lost reply) gives back the same Short.
  const again = await alice('POST', '/api/me/shorts', { videoId: up.body.videoId, title: 'Again' });
  assert.deepStrictEqual([again.status, again.body.id, again.body.title], [201, posted.body.id, 'Operators']);

  // Not in the feed yet.
  assert.ok(!(await alice('GET', '/api/shorts')).body.some((s) => s.id === posted.body.id));

  // Editable while in review.
  const edited = await alice('PATCH', `/api/me/shorts/${posted.body.id}`, { title: 'Kubernetes operators' });
  assert.strictEqual(edited.body.title, 'Kubernetes operators');
  assert.strictEqual((await bob('PATCH', `/api/me/shorts/${posted.body.id}`, { title: 'x' })).status, 404);

  // The host sees it with the uploader and the AI's check, and approves it with a fix.
  const queued = (await host('GET', '/shorts')).body.find((s) => s.id === posted.body.id);
  assert.strictEqual(queued.status, 'in_review');
  assert.strictEqual(queued.author.name, 'Alice K');
  assert.deepStrictEqual(queued.aiCheck, { status: 'ready', concerns: ['0:04 names a client'] });
  const approved = await host('PATCH', `/shorts/${posted.body.id}`, { title: 'Kubernetes operators, quickly', status: 'published' });
  assert.strictEqual(approved.status, 200);

  const live = (await bob('GET', '/api/shorts')).body.find((s) => s.id === posted.body.id);
  assert.strictEqual(live.author.name, 'Alice K');
  // A key to hide Alice's posts with, which doesn't reveal her device.
  assert.match(live.author.key, /^[0-9a-f]{16}$/);
  assert.ok(!live.author.key.includes(ALICE.slice(0, 8)));
  assert.strictEqual(live.title, 'Kubernetes operators, quickly');
  assert.strictEqual(live.description, 'A tip');

  // Live Shorts can't be edited, but stats show in "me".
  assert.strictEqual((await alice('PATCH', `/api/me/shorts/${posted.body.id}`, { title: 'x' })).status, 409);
  await bob('PUT', `/api/items/short/${posted.body.id}/like`);
  const mine = (await alice('GET', '/api/me/shorts')).body;
  assert.deepStrictEqual(mine.map((s) => [s.id, s.status, s.likes]), [[posted.body.id, 'published', 1]]);

  // Deleting removes it for everyone, and its video.
  assert.strictEqual((await bob('DELETE', `/api/me/shorts/${posted.body.id}`)).status, 404);
  assert.strictEqual((await alice('DELETE', `/api/me/shorts/${posted.body.id}`)).status, 204);
  assert.ok(!(await bob('GET', '/api/shorts')).body.some((s) => s.id === posted.body.id));
  assert.strictEqual(video.state.calls.at(-1)[0], 'deleteAsset');
  assert.deepStrictEqual((await alice('GET', '/api/me/shorts')).body, []);
});

test('a rejected Short shows the host’s note to its uploader', async () => {
  video.state.durationSec = 30;
  const up = await alice('POST', '/api/me/uploads', {});
  const posted = await alice('POST', '/api/me/shorts', { videoId: up.body.videoId, title: 'Off topic' });
  await host('PATCH', `/shorts/${posted.body.id}`, { status: 'rejected', reviewNote: 'Please keep it to AI tips.' });
  const mine = (await alice('GET', '/api/me/shorts')).body.find((s) => s.id === posted.body.id);
  assert.deepStrictEqual([mine.status, mine.reviewNote], ['rejected', 'Please keep it to AI tips.']);
  // Approving later clears the note.
  await host('PATCH', `/shorts/${posted.body.id}`, { status: 'published' });
  assert.strictEqual((await alice('GET', '/api/me/shorts')).body.find((s) => s.id === posted.body.id).reviewNote, null);
});

test('keeping part of a video cuts it into a new one and deletes the original', async () => {
  video.state.durationSec = 300;
  assert.strictEqual((await alice('POST', '/api/me/uploads', { startSec: 10, endSec: 200 })).status, 400);
  assert.strictEqual((await alice('POST', '/api/me/uploads', { startSec: 10 })).status, 400);
  const up = await alice('POST', '/api/me/uploads', { startSec: 60, endSec: 120 });
  assert.strictEqual(up.status, 201);
  // No captions on the uncut original: the cut gets its own.
  assert.deepStrictEqual(video.state.calls.at(-1), ['createUpload', { audio: false, captions: false }]);
  video.state.calls.length = 0;
  const first = (await alice('GET', `/api/me/uploads/${up.body.videoId}`)).body;
  const clip = video.state.calls.find((c) => c[0] === 'createClip');
  assert.deepStrictEqual([clip[1].startSec, clip[1].endSec, clip[1].captions], [60, 120, true]);
  // The original stays until the cut is made from it.
  assert.ok(!video.state.calls.some((c) => c[0] === 'deleteAsset'));
  assert.strictEqual(first.status, 'processing');
  // Then the cut video is the one that's ready, 60 seconds long, cut only once,
  // and the original is gone.
  const next = (await alice('GET', `/api/me/uploads/${up.body.videoId}`)).body;
  assert.deepStrictEqual([next.status, next.durationSec], ['ready', 60]);
  assert.strictEqual(video.state.calls.filter((c) => c[0] === 'createClip').length, 1);
  assert.ok(video.state.calls.some((c) => c[0] === 'deleteAsset' && c[1] === clip[1].assetId));
});

test('a silent video gets no text suggestions, just a cover frame', async () => {
  video.state.durationSec = 20;
  video.state.silent = true;
  try {
    const before = aiCalls.length;
    const up = await alice('POST', '/api/me/uploads', {});
    const state = (await alice('GET', `/api/me/uploads/${up.body.videoId}`)).body;
    assert.deepStrictEqual(state.suggestions, { status: 'unavailable', title: null, description: null, tags: [], coverSec: 10 });
    assert.strictEqual(aiCalls.length, before);
  } finally {
    video.state.silent = false;
  }
});

test('an upload that is never posted can be thrown away', async () => {
  video.state.durationSec = 30;
  const up = await alice('POST', '/api/me/uploads', {});
  await alice('GET', `/api/me/uploads/${up.body.videoId}`);
  assert.strictEqual((await bob('DELETE', `/api/me/uploads/${up.body.videoId}`)).status, 404);
  assert.strictEqual((await alice('DELETE', `/api/me/uploads/${up.body.videoId}`)).status, 204);
  assert.strictEqual(video.state.calls.at(-1)[0], 'deleteAsset');
  assert.strictEqual((await alice('GET', `/api/me/uploads/${up.body.videoId}`)).status, 404);
});

test('a full video service gives a readable reason', async () => {
  const real = video.createUpload;
  video.createUpload = async () => {
    throw Object.assign(new Error('Video service: Free plan is limited to 10 assets'), { status: 502 });
  };
  try {
    const res = await alice('POST', '/api/me/uploads', {});
    assert.strictEqual(res.status, 503);
    assert.match(res.body.error, /storage is full/);
  } finally {
    video.createUpload = real;
  }
});

test('rejected Shorts and never-posted uploads are deleted after a week', async () => {
  video.state.durationSec = 30;
  const rejectedUp = await alice('POST', '/api/me/uploads', {});
  const rejected = await alice('POST', '/api/me/shorts', { videoId: rejectedUp.body.videoId, title: 'Old reject' });
  await host('PATCH', `/shorts/${rejected.body.id}`, { status: 'rejected' });
  const recentUp = await alice('POST', '/api/me/uploads', {});
  const recent = await alice('POST', '/api/me/shorts', { videoId: recentUp.body.videoId, title: 'Recent reject' });
  await host('PATCH', `/shorts/${recent.body.id}`, { status: 'rejected' });
  const abandoned = await alice('POST', '/api/me/uploads', {});
  await alice('GET', `/api/me/uploads/${abandoned.body.videoId}`);
  // Pretend a week has passed for the first reject and the abandoned upload.
  await db.query("update shorts set updated_at = now() - interval '8 days' where id = $1", [rejected.body.id]);
  await db.query("update videos set created_at = now() - interval '8 days' where id = $1", [abandoned.body.videoId]);

  video.state.calls.length = 0;
  const ids = (await host('GET', '/shorts')).body.map((s) => s.id);
  assert.ok(!ids.includes(rejected.body.id));
  assert.ok(ids.includes(recent.body.id));
  assert.strictEqual(video.state.calls.filter((c) => c[0] === 'deleteAsset').length, 2);
  assert.strictEqual((await alice('GET', `/api/me/uploads/${abandoned.body.videoId}`)).status, 404);
  assert.strictEqual((await alice('GET', `/api/me/uploads/${recentUp.body.videoId}`)).status, 200);
});

test('anyone can post an episode too; it waits for review', async () => {
  video.state.durationSec = 900;
  assert.strictEqual((await alice('POST', '/api/me/uploads', { kind: 'episode', startSec: 0, endSec: 60 })).status, 400);
  const up = await alice('POST', '/api/me/uploads', { kind: 'episode' });
  assert.strictEqual(up.status, 201);
  // Episodes get an audio-only file for listening, and captions.
  assert.deepStrictEqual(video.state.calls.at(-1), ['createUpload', { audio: true, captions: true }]);
  const state = (await alice('GET', `/api/me/uploads/${up.body.videoId}`)).body;
  assert.deepStrictEqual([state.status, state.suggestions.status], ['ready', 'ready']);
  // It can't be posted as a Short.
  assert.strictEqual((await alice('POST', '/api/me/shorts', { videoId: up.body.videoId, title: 'x' })).status, 404);

  const posted = await alice('POST', '/api/me/episodes', { videoId: up.body.videoId, title: 'Agents in practice', description: 'Long form', tags: ['agents'], coverSec: 30 });
  assert.strictEqual(posted.status, 201);
  assert.deepStrictEqual([posted.body.status, posted.body.author.name], ['in_review', 'Alice K']);
  assert.match(posted.body.artworkUrl, /time=30/);
  assert.ok(!(await bob('GET', '/api/episodes')).body.some((e) => e.id === posted.body.id));

  assert.strictEqual((await alice('PATCH', `/api/me/episodes/${posted.body.id}`, { title: 'Agents, in practice' })).body.title, 'Agents, in practice');
  assert.strictEqual((await bob('PATCH', `/api/me/episodes/${posted.body.id}`, { title: 'x' })).status, 404);

  const queued = (await host('GET', '/episodes')).body.find((e) => e.id === posted.body.id);
  assert.deepStrictEqual([queued.status, queued.author.name, queued.aiCheck.concerns], ['in_review', 'Alice K', ['0:04 names a client']]);
  await host('PATCH', `/episodes/${posted.body.id}`, { status: 'rejected', reviewNote: 'Trim the intro' });
  assert.strictEqual((await alice('GET', '/api/me/episodes')).body[0].reviewNote, 'Trim the intro');
  await host('PATCH', `/episodes/${posted.body.id}`, { status: 'published' });
  const live = (await bob('GET', `/api/episodes/${posted.body.id}`)).body;
  assert.deepStrictEqual([live.author.name, live.title], ['Alice K', 'Agents, in practice']);
  assert.strictEqual((await alice('GET', '/api/me/episodes')).body[0].reviewNote, null);

  assert.strictEqual((await alice('DELETE', `/api/me/episodes/${posted.body.id}`)).status, 204);
  assert.strictEqual((await bob('GET', `/api/episodes/${posted.body.id}`)).status, 404);
});

test('reporting a posted Short hides it for review; a host’s own stays up, flagged', async () => {
  video.state.durationSec = 30;
  const up = await alice('POST', '/api/me/uploads', {});
  const posted = await alice('POST', '/api/me/shorts', { videoId: up.body.videoId, title: 'Reported one' });
  await host('PATCH', `/shorts/${posted.body.id}`, { status: 'published' });
  assert.strictEqual((await bob('POST', `/api/items/short/${posted.body.id}/report`, { reason: 'Shows a client name' })).status, 204);
  assert.ok(!(await bob('GET', '/api/shorts')).body.some((s) => s.id === posted.body.id));
  const queued = (await host('GET', '/shorts')).body.find((s) => s.id === posted.body.id);
  assert.deepStrictEqual([queued.status, queued.reports], ['in_review', ['Shows a client name']]);
  // Approving it again answers the report.
  await host('PATCH', `/shorts/${posted.body.id}`, { status: 'published' });
  assert.deepStrictEqual((await host('GET', '/shorts')).body.find((s) => s.id === posted.body.id).reports, []);

  const hostUp = await host('POST', '/uploads', { kind: 'short' });
  const hostShort = await host('POST', '/shorts', { title: 'Host clip 2', videoId: hostUp.body.videoId });
  await host('PATCH', `/shorts/${hostShort.body.id}`, { status: 'published' });
  await bob('POST', `/api/items/short/${hostShort.body.id}/report`, {});
  assert.ok((await bob('GET', '/api/shorts')).body.some((s) => s.id === hostShort.body.id));
  assert.deepStrictEqual((await host('GET', '/shorts')).body.find((s) => s.id === hostShort.body.id).reports, ['']);
  // Only live things can be reported.
  assert.strictEqual((await bob('POST', '/api/items/short/sh_nope/report', {})).status, 404);
});

test('the host’s own Shorts have no author', async () => {
  video.state.durationSec = 30;
  const up = await host('POST', '/uploads', { kind: 'short' });
  const res = await host('POST', '/shorts', { title: 'Host clip', videoId: up.body.videoId });
  assert.strictEqual(res.body.author, null);
  assert.strictEqual(res.body.aiCheck, null);
  assert.strictEqual(res.body.status, 'draft');
});
