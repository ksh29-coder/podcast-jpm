const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { fakeVideo } = require('./fake-video');

// Phone alerts: who gets which, once, and only the kinds they want.

const PASSCODE = 'test-passcode';
const ALICE = 'aaaaaaaa-1111-2222-3333-888888888888';
const BOB = 'bbbbbbbb-1111-2222-3333-888888888888';
const CAROL = 'cccccccc-1111-2222-3333-888888888888';
const PHONE = { alice: 'ExponentPushToken[alice]', bob: 'ExponentPushToken[bob]', carol: 'ExponentPushToken[carol]' };
let server;
let base;
let db;
const sent = [];
const pending = [];
// Work done after replying, awaited by the tests.
const settle = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

before(async () => {
  const video = fakeVideo();
  video.state.durationSec = 40;
  db = new PGlite();
  server = createApp({
    db,
    video,
    cleanUpEveryMs: 0,
    tint: async () => '#334455',
    hostPasscode: PASSCODE,
    background: (work) => pending.push(Promise.resolve(work).catch((e) => console.warn(e))),
    // Stands in for Expo: records each alert; Carol's phone no longer has the app.
    sendPush: async (messages) => {
      sent.push(...messages);
      return messages.map((m) => (m.to === PHONE.carol ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }));
    },
  }).listen(0);
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
const carol = call({ 'X-Device-Id': CAROL });
const host = (method, path, body) => call({ 'X-Host-Passcode': PASSCODE })(method, `/api/host${path}`, body);
const to = (phone) => sent.filter((m) => m.to === phone).map((m) => m.title);

let short;

test('phones sign up for alerts, with every kind on to start', async () => {
  assert.strictEqual((await alice('PUT', '/api/me/push/token', { token: 'nope' })).status, 400);
  for (const [who, phone] of [[alice, PHONE.alice], [bob, PHONE.bob], [carol, PHONE.carol]]) {
    assert.strictEqual((await who('PUT', '/api/me/push/token', { token: phone })).status, 204);
  }
  assert.deepStrictEqual((await alice('GET', '/api/me/push/settings')).body, { replies: true, comments: true, reviews: true, episodes: true });
  assert.strictEqual((await alice('PUT', '/api/me/push/settings', { replies: 'yes' })).status, 400);
});

test('a host approving or turning down a post tells its author, once', async () => {
  await alice('PUT', '/api/me', { name: 'Alice', acceptGuidelines: true });
  const post = async (title) => {
    const up = await alice('POST', '/api/me/uploads', {});
    return (await alice('POST', '/api/me/shorts', { videoId: up.body.videoId, title })).body;
  };
  short = await post('Operators');
  const other = await post('Too long');
  await host('PATCH', `/shorts/${short.id}`, { status: 'published' });
  await host('PATCH', `/shorts/${other.id}`, { status: 'rejected', reviewNote: 'Please trim it' });
  await settle();
  assert.deepStrictEqual(to(PHONE.alice), ['Your Short is live', 'Your Short wasn’t approved']);
  assert.strictEqual(sent.find((m) => m.title === 'Your Short wasn’t approved').body, 'Please trim it');
  assert.strictEqual(sent.find((m) => m.title === 'Your Short is live').data.url, `/shorts?id=${short.id}`);

  // Changing it later doesn't send it again.
  await host('PATCH', `/shorts/${short.id}`, { status: 'published', title: 'Operators!' });
  await settle();
  assert.strictEqual(to(PHONE.alice).length, 2);
});

test('replies tell the person answered; comments tell the author, not every time', async () => {
  sent.length = 0;
  const path = `/api/items/short/${short.id}/comments`;
  const first = (await bob('POST', path, { name: 'Bob', body: 'Nice' })).body;
  await settle();
  assert.deepStrictEqual(to(PHONE.alice), ['Bob commented on your Short']);
  assert.match(sent[0].body, /^“Operators!”: Nice$/);
  assert.strictEqual(sent[0].data.url, `/comments/short/${short.id}?focus=${first.id}`);

  // A second comment soon after: no new alert for Alice.
  await bob('POST', path, { name: 'Bob', body: 'Really nice' });
  await settle();
  assert.strictEqual(to(PHONE.alice).length, 1);

  // Alice answers Bob: Bob is told. Nobody is told about their own comment.
  await alice('POST', path, { name: 'Alice', body: 'Thanks!', replyTo: first.id });
  await settle();
  assert.deepStrictEqual(to(PHONE.bob), ['Alice replied to your comment']);
  assert.strictEqual(to(PHONE.alice).length, 1);

  // Bob turns reply alerts off.
  await bob('PUT', '/api/me/push/settings', { replies: false });
  await alice('POST', path, { name: 'Alice', body: 'Anytime', replyTo: first.id });
  await settle();
  assert.strictEqual(to(PHONE.bob).length, 1);
});

test('a new episode goes to everyone who wants them; dead phones are dropped', async () => {
  sent.length = 0;
  await host('PATCH', '/episodes/ep002', { status: 'draft' });
  await db.query("update episodes set published_at = now() where id = 'ep002'");
  await host('PATCH', '/episodes/ep002', { status: 'published' });
  await settle();
  assert.deepStrictEqual(
    sent.filter((m) => m.title === 'New episode').map((m) => m.to).sort(),
    [PHONE.alice, PHONE.bob, PHONE.carol]
  );
  // Carol's phone said the app is gone.
  const { rows } = await db.query('select token from push_tokens order by token');
  assert.deepStrictEqual(rows.map((r) => r.token), [PHONE.alice, PHONE.bob]);
});
