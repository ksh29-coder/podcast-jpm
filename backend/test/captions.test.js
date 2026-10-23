const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { fakeVideo } = require('./fake-video');

// Captions on Shorts: shown to viewers, fixed by the uploader or a host.

const PASSCODE = 'test-passcode';
const ALICE = 'aaaaaaaa-1111-2222-3333-666666666666';
const BOB = 'bbbbbbbb-1111-2222-3333-666666666666';
const fixCalls = [];
// Stands in for OpenRouter.
const fakeAi = {
  model: 'test/fake',
  async episodeInsights() {
    return {};
  },
  async shortSuggestions() {
    return { title: 'Operators', description: '', tags: [], coverSec: 1, concerns: [] };
  },
  async fixCaptions(input) {
    fixCalls.push(input);
    // Fixes the first line, empties the second (which keeps what was said).
    return { lines: input.lines.map((l, i) => (i === 0 ? 'Welcome to the AI Dev Wave' : i === 1 ? '' : l)) };
  },
};
let server;
let base;
let video;

before(async () => {
  video = fakeVideo();
  server = createApp({ db: new PGlite(), video, ai: fakeAi, cleanUpEveryMs: 0, tint: async () => '#334455', hostPasscode: PASSCODE }).listen(0);
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

const WELCOME = { startSec: 1, endSec: 4, text: 'Welcome to the AI Dev Podcast' };
const TODAY = { startSec: 4, endSec: 9.5, text: 'Today we talk about Kubernetes operators' };

test('a posted Short’s captions can be fixed before posting and in review, then everyone sees them', async () => {
  await alice('PUT', '/api/me', { name: 'Alice', acceptGuidelines: true });
  video.state.durationSec = 30;
  const up = (await alice('POST', '/api/me/uploads', {})).body;
  await alice('GET', `/api/me/uploads/${up.videoId}`);

  // The generated lines, only for the uploader.
  const generated = (await alice('GET', `/api/me/uploads/${up.videoId}/captions`)).body;
  assert.deepStrictEqual(generated, { status: 'ready', source: 'mux', cues: [WELCOME, TODAY] });
  assert.strictEqual((await bob('GET', `/api/me/uploads/${up.videoId}/captions`)).status, 404);

  // Fixed before posting; an emptied line is dropped.
  const fixed = await alice('PUT', `/api/me/uploads/${up.videoId}/captions`, {
    cues: [{ ...WELCOME, text: '  Welcome to   AI Dev Wave ' }, { ...TODAY, text: ' ' }],
  });
  assert.deepStrictEqual(fixed.body, { status: 'ready', source: 'edited', cues: [{ ...WELCOME, text: 'Welcome to AI Dev Wave' }] });
  assert.strictEqual((await alice('PUT', `/api/me/uploads/${up.videoId}/captions`, { cues: [{ startSec: 5, endSec: 2, text: 'x' }] })).status, 400);

  const short = (await alice('POST', '/api/me/shorts', { videoId: up.videoId, title: 'Operators' })).body;
  // Not public while in review.
  assert.strictEqual((await bob('GET', `/api/shorts/${short.id}/captions`)).status, 404);
  assert.strictEqual((await alice('GET', `/api/me/shorts/${short.id}/captions`)).body.cues[0].text, 'Welcome to AI Dev Wave');
  assert.strictEqual((await bob('PUT', `/api/me/shorts/${short.id}/captions`, { cues: [WELCOME] })).status, 404);
  assert.strictEqual((await alice('PUT', `/api/me/shorts/${short.id}/captions`, { cues: [WELCOME, TODAY] })).body.cues.length, 2);

  // The host fixes a line and approves it; then viewers get the captions.
  const hosted = await host('PUT', `/shorts/${short.id}/captions`, { cues: [WELCOME, { ...TODAY, text: 'Today: Kubernetes operators' }] });
  assert.strictEqual(hosted.body.cues[1].text, 'Today: Kubernetes operators');
  await host('PATCH', `/shorts/${short.id}`, { status: 'published' });
  assert.deepStrictEqual((await bob('GET', `/api/shorts/${short.id}/captions`)).body.cues.map((c) => c.text), [WELCOME.text, 'Today: Kubernetes operators']);

  // Live: the uploader can't change them any more, a host still can.
  assert.strictEqual((await alice('PUT', `/api/me/shorts/${short.id}/captions`, { cues: [WELCOME] })).status, 409);
  assert.strictEqual((await alice('PUT', `/api/me/uploads/${up.videoId}/captions`, { cues: [WELCOME] })).status, 409);
  assert.strictEqual((await host('PUT', `/shorts/${short.id}/captions`, { cues: [WELCOME] })).status, 200);
});

test('a Short cut from an episode uses the episode’s lines for that part', async () => {
  video.state.durationSec = 600;
  const up = await host('POST', '/uploads', { kind: 'episode' });
  const ep = (await host('POST', '/episodes', { title: 'Operators deep dive', videoId: up.body.videoId })).body;
  await host('PATCH', `/episodes/${ep.id}`, { status: 'published' });
  const clip = (await host('POST', '/shorts', { episodeId: ep.id, title: 'Operators', startSec: 3, endSec: 8 })).body;
  await host('PATCH', `/shorts/${clip.id}`, { status: 'published' });

  const shown = (await bob('GET', `/api/shorts/${clip.id}/captions`)).body;
  // In the clip's own time, inside the clip.
  assert.deepStrictEqual(shown, {
    status: 'ready',
    source: 'episode',
    cues: [
      { ...WELCOME, startSec: 0, endSec: 1 },
      { ...TODAY, startSec: 1, endSec: 5 },
    ],
  });
  // Fixing them gives the clip its own lines.
  await host('PUT', `/shorts/${clip.id}/captions`, { cues: [{ startSec: 1, endSec: 5, text: 'Today, Kubernetes operators' }] });
  assert.deepStrictEqual((await bob('GET', `/api/shorts/${clip.id}/captions`)).body.source, 'edited');
});

test('the AI tidies caption lines without saving them', async () => {
  const res = await alice('POST', '/api/me/captions/tidy', { cues: [WELCOME, TODAY], title: 'AI Dev Wave intro', tags: ['intro'] });
  assert.deepStrictEqual(res.body.cues, [{ ...WELCOME, text: 'Welcome to the AI Dev Wave' }, TODAY]);
  assert.deepStrictEqual(fixCalls.at(-1), { title: 'AI Dev Wave intro', description: undefined, tags: ['intro'], lines: [WELCOME.text, TODAY.text] });
  assert.strictEqual((await alice('POST', '/api/me/captions/tidy', {})).status, 400);
});
