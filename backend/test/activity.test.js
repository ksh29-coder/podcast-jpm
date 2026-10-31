const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { fakeVideo } = require('./fake-video');

// Replies to comments, and each person's Activity in Me.

const PASSCODE = 'test-passcode';
const ALICE = 'aaaaaaaa-1111-2222-3333-666666666666';
const BOB = 'bbbbbbbb-1111-2222-3333-666666666666';
const CAROL = 'cccccccc-1111-2222-3333-666666666666';
let server;
let base;

before(async () => {
  const video = fakeVideo();
  video.state.durationSec = 40;
  server = createApp({ db: new PGlite(), video, cleanUpEveryMs: 0, tint: async () => '#334455', hostPasscode: PASSCODE }).listen(0);
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

async function postShort(title) {
  await alice('PUT', '/api/me', { name: 'Alice', acceptGuidelines: true });
  const up = await alice('POST', '/api/me/uploads', {});
  return (await alice('POST', '/api/me/shorts', { videoId: up.body.videoId, title })).body;
}
const kinds = (items) => items.map((i) => [i.kind, i.actorName ?? null, i.itemTitle]);

let short;
let firstLook;

test('replies go in the thread of the comment they answer', async () => {
  // Someone new starts with nothing unread.
  firstLook = (await alice('GET', '/api/me/activity')).body;
  assert.ok(firstLook.items.every((i) => i.at <= firstLook.seenAt));
  short = await postShort('Operators');
  assert.strictEqual((await host('PATCH', `/shorts/${short.id}`, { status: 'published' })).status, 200);
  const path = `/api/items/short/${short.id}/comments`;

  const first = (await alice('POST', path, { name: 'Alice', body: 'Any questions?' })).body;
  assert.strictEqual(first.parentId, null);
  const reply = await bob('POST', path, { name: 'Bob', body: 'How do I start?', replyTo: first.id });
  assert.strictEqual(reply.status, 201);
  assert.deepStrictEqual([reply.body.parentId, reply.body.replyToName], [first.id, null]);
  // Answering a reply stays in the same thread and names who it answers.
  const answer = (await carol('POST', path, { name: 'Carol', body: 'Same question', replyTo: reply.body.id })).body;
  assert.deepStrictEqual([answer.parentId, answer.replyToName], [first.id, 'Bob']);

  const all = (await alice('GET', path)).body;
  assert.deepStrictEqual(
    all.map((c) => [c.body, c.parentId, c.replyToName]),
    [
      ['Same question', first.id, 'Bob'],
      ['How do I start?', first.id, null],
      ['Any questions?', null, null],
    ]
  );
  assert.strictEqual((await bob('POST', path, { name: 'Bob', body: 'x', replyTo: 'cm_nope' })).status, 404);
  assert.strictEqual((await bob('POST', path, { name: 'Bob', body: 'x', replyTo: 5 })).status, 400);
});

test('Activity: replies, comments and likes on my posts, and reviews', async () => {
  await bob('POST', `/api/items/short/${short.id}/comments`, { name: 'Bob', body: 'Nice one' });
  await bob('PUT', `/api/items/short/${short.id}/like`);
  await alice('PUT', `/api/items/short/${short.id}/like`);
  const rejected = await postShort('Too long');
  await host('PATCH', `/shorts/${rejected.id}`, { status: 'rejected', reviewNote: 'Please trim it' });

  const { seenAt, items } = (await alice('GET', '/api/me/activity')).body;
  assert.strictEqual(seenAt, firstLook.seenAt);
  const mine = kinds(items).filter(([k]) => k !== 'episode');
  assert.deepStrictEqual(mine, [
    ['rejected', null, 'Too long'],
    ['like', null, 'Operators'],
    ['comment', 'Bob', 'Operators'],
    // Carol answered Bob, not Alice, but it's on Alice's Short.
    ['comment', 'Carol', 'Operators'],
    // Bob's reply to Alice is told once, as a reply.
    ['reply', 'Bob', 'Operators'],
    ['live', null, 'Operators'],
  ]);
  assert.strictEqual(items.find((i) => i.kind === 'rejected').note, 'Please trim it');
  assert.ok(items.find((i) => i.kind === 'reply').actorKey.match(/^[0-9a-f]{16}$/));
  assert.ok(items.filter((i) => i.kind !== 'episode').every((i) => i.at > seenAt), 'all unread');

  // Bob is told about Carol's answer to him, and nothing about Alice's Short.
  assert.deepStrictEqual(kinds((await bob('GET', '/api/me/activity')).body.items).filter(([k]) => k !== 'episode'), [['reply', 'Carol', 'Operators']]);

  // Looking at Activity marks it read.
  assert.strictEqual((await alice('POST', '/api/me/activity/seen')).status, 204);
  const after = (await alice('GET', '/api/me/activity')).body;
  assert.ok(after.items.every((i) => i.at <= after.seenAt));
});

test('a reported comment drops out of Activity', async () => {
  const c = (await carol('POST', `/api/items/short/${short.id}/comments`, { name: 'Carol', body: 'Spam spam' })).body;
  assert.ok((await alice('GET', '/api/me/activity')).body.items.some((i) => i.commentId === c.id));
  await bob('POST', `/api/items/short/${short.id}/comments/${c.id}/report`, { reason: 'Spam' });
  assert.ok(!(await alice('GET', '/api/me/activity')).body.items.some((i) => i.commentId === c.id));
});
