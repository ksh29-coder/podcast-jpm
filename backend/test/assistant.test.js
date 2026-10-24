const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { fakeVideo } = require('./fake-video');

// The voice assistant: sessions within the daily limit, and its tools.

const ALICE = 'aaaaaaaa-1111-2222-3333-666666666666';
const sessions = [];
const fakeVoice = {
  async createSession(opts) {
    sessions.push(opts);
    return { token: 'ek_test', connectUrl: 'https://voice.test/calls', expiresAt: null };
  },
};
let server;
let base;
let db;

before(async () => {
  db = new PGlite();
  server = createApp({ db, video: fakeVideo(), voice: fakeVoice, tint: async () => '#334455', hostPasscode: 'x' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const call = (device) => async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(device && { 'X-Device-Id': device }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const alice = call(ALICE);

test('a session gets a short-lived key, the instructions and the tools', async () => {
  const res = await alice('POST', '/api/assistant/session');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual([res.body.token, res.body.connectUrl, res.body.maxSec, res.body.leftTodaySec], ['ek_test', 'https://voice.test/calls', 180, 600]);
  assert.match(sessions[0].instructions, /AI Wave/);
  assert.deepStrictEqual(sessions[0].tools.map((t) => t.name), ['search_content', 'episode_details', 'latest', 'show_cards']);
  assert.strictEqual((await call(null)('POST', '/api/assistant/session')).status, 400);
});

test('a conversation can use a chosen voice, but only a real one', async () => {
  assert.strictEqual((await alice('POST', '/api/assistant/session', { voice: 'cedar' })).status, 200);
  assert.strictEqual(sessions.at(-1).voice, 'cedar');
  assert.strictEqual((await alice('POST', '/api/assistant/session', { voice: 'robot' })).status, 400);
});

test('each person gets 10 minutes a day, 3 at a time', async () => {
  assert.strictEqual((await alice('POST', '/api/assistant/usage', { seconds: 'x' })).status, 400);
  // A report longer than a session counts as one session.
  assert.strictEqual((await alice('POST', '/api/assistant/usage', { seconds: 999 })).body.leftTodaySec, 410);
  await alice('POST', '/api/assistant/usage', { seconds: 150 });
  assert.strictEqual((await alice('POST', '/api/assistant/session')).body.maxSec, 180);
  await alice('POST', '/api/assistant/usage', { seconds: 150 });
  // Only 110 seconds left today, so this conversation is shorter.
  const last = await alice('POST', '/api/assistant/session');
  assert.deepStrictEqual([last.status, last.body.maxSec], [200, 110]);
  await alice('POST', '/api/assistant/usage', { seconds: 100 });
  const done = await alice('POST', '/api/assistant/session');
  assert.strictEqual(done.status, 429);
  assert.match(done.body.error, /10 minutes/);
  await db.query('delete from voice_usage');
});

test('tools find content, describe episodes, and list the latest', async () => {
  const found = (await alice('POST', '/api/assistant/tools/search_content', { query: 'getting started' })).body;
  assert.ok(Array.isArray(found.episodes) && Array.isArray(found.shorts) && Array.isArray(found.moments));
  const latest = (await alice('POST', '/api/assistant/tools/latest', {})).body;
  assert.ok(latest.episodes.length > 0);
  const ep = latest.episodes[0];
  assert.deepStrictEqual(Object.keys(ep).sort(), ['about', 'artworkUrl', 'by', 'id', 'kind', 'minutes', 'published', 'title']);
  const details = (await alice('POST', '/api/assistant/tools/episode_details', { episode_id: ep.id })).body;
  assert.strictEqual(details.id, ep.id);
  assert.ok(Array.isArray(details.chapters));
  assert.ok((await alice('POST', '/api/assistant/tools/episode_details', { episode_id: 'nope' })).body.error);
  // Searching a word from a seeded episode title finds it.
  const word = ep.title.split(/\s+/).find((w) => w.length > 3) || ep.title;
  assert.ok((await alice('POST', '/api/assistant/tools/search_content', { query: `tell me about ${word}` })).body.episodes.some((e) => e.id === ep.id));
  assert.strictEqual((await alice('POST', '/api/assistant/tools/hack', {})).status, 404);
});

test('without a voice service, sessions say so', async () => {
  const s = createApp({ db: new PGlite(), video: fakeVideo(), voice: null, tint: async () => '#334455' }).listen(0);
  await new Promise((r) => s.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/assistant/session`, { method: 'POST', headers: { 'X-Device-Id': ALICE } });
  assert.strictEqual(res.status, 503);
  s.close();
});
