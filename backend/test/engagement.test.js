const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { fakeVideo } = require('./fake-video');

const PASSCODE = 'test-passcode';
const ALICE = 'aaaaaaaa-1111-2222-3333-444444444444';
const BOB = 'bbbbbbbb-1111-2222-3333-444444444444';
let server;
let base;

before(async () => {
  server = createApp({ db: new PGlite(), video: fakeVideo(), tint: async () => '#334455', hostPasscode: PASSCODE }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const as = (device) => async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': device },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const alice = as(ALICE);
const bob = as(BOB);
const host = async (method, path, body) => {
  const res = await fetch(`${base}/api/host${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Host-Passcode': PASSCODE },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test('likes count once per device and can be undone', async () => {
  assert.strictEqual((await alice('PUT', '/api/items/episode/ep001/like')).body.likes, 1);
  assert.strictEqual((await alice('PUT', '/api/items/episode/ep001/like')).body.likes, 1);
  const bobLike = (await bob('PUT', '/api/items/episode/ep001/like')).body;
  assert.deepStrictEqual([bobLike.likes, bobLike.liked], [2, true]);

  const ep = (await alice('GET', '/api/episodes/ep001')).body;
  assert.deepStrictEqual([ep.likes, ep.liked], [2, true]);

  const undone = (await alice('DELETE', '/api/items/episode/ep001/like')).body;
  assert.deepStrictEqual([undone.likes, undone.liked], [1, false]);
});

test('views count each device once', async () => {
  await alice('POST', '/api/items/short/ep001-c1/view');
  await alice('POST', '/api/items/short/ep001-c1/view');
  await bob('POST', '/api/items/short/ep001-c1/view');
  const short = (await alice('GET', '/api/shorts')).body.find((s) => s.id === 'ep001-c1');
  assert.strictEqual(short.views, 2);
});

test("can't like or comment on missing or unpublished items", async () => {
  assert.strictEqual((await alice('PUT', '/api/items/episode/nope/like')).status, 404);
  assert.strictEqual((await alice('PUT', '/api/items/podcast/ep001/like')).status, 404);
  await host('PATCH', '/episodes/ep002', { status: 'draft' });
  assert.strictEqual((await alice('POST', '/api/items/episode/ep002/comments', { name: 'A', body: 'hi' })).status, 404);
  await host('PATCH', '/episodes/ep002', { status: 'published' });
});

test('comments go up straight away, without waiting for a host', async () => {
  const posted = await alice('POST', '/api/items/episode/ep001/comments', { name: 'Alice', body: 'Great episode' });
  assert.strictEqual(posted.status, 201);
  assert.strictEqual(posted.body.status, 'approved');

  const seen = (await bob('GET', '/api/items/episode/ep001/comments')).body;
  assert.deepStrictEqual(
    seen.map((c) => [c.authorName, c.body, c.status]),
    [['Alice', 'Great episode', 'approved']]
  );
  assert.strictEqual((await bob('GET', '/api/episodes/ep001')).body.comments, 1);
  // Nothing for the hosts to review.
  assert.ok(!(await host('GET', '/comments')).body.some((c) => c.id === posted.body.id));
});

test('comment input is checked', async () => {
  assert.strictEqual((await alice('POST', '/api/items/episode/ep001/comments', { name: '', body: 'x' })).status, 400);
  assert.strictEqual((await alice('POST', '/api/items/episode/ep001/comments', { name: 'A', body: '' })).status, 400);
  assert.strictEqual((await alice('POST', '/api/items/episode/ep001/comments', { name: 'A', body: 'x'.repeat(1001) })).status, 400);
  assert.strictEqual((await host('PATCH', '/comments/cm_nope', { status: 'approved' })).status, 404);
  assert.strictEqual((await host('PATCH', '/comments/cm_nope', { status: 'live' })).status, 400);
});

test('hosts tag episodes and Shorts; tags are cleaned up', async () => {
  const res = await host('PATCH', '/episodes/ep001', { tags: ['#AI', ' Testing ', 'ai'] });
  assert.deepStrictEqual(res.body.tags, ['ai', 'testing']);
  assert.deepStrictEqual((await alice('GET', '/api/episodes/ep001')).body.tags, ['ai', 'testing']);

  await host('PATCH', '/shorts/ep001-c1', { tags: ['pairing'] });
  assert.deepStrictEqual((await alice('GET', '/api/shorts')).body.find((s) => s.id === 'ep001-c1').tags, ['pairing']);

  assert.strictEqual((await host('PATCH', '/shorts/ep001-c1', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).status, 400);
  assert.strictEqual((await host('PATCH', '/shorts/ep001-c1', { tags: 'ai' })).status, 400);
});

test('host lists include engagement counts', async () => {
  const ep = (await host('GET', '/episodes')).body.find((e) => e.id === 'ep001');
  assert.strictEqual(typeof ep.likes, 'number');
  assert.strictEqual(typeof ep.views, 'number');
  assert.strictEqual(typeof ep.comments, 'number');
});

test('listening progress is kept per device', async () => {
  await alice('PUT', '/api/progress/ep001', { positionSec: 30 });
  await alice('PUT', '/api/progress/ep001', { positionSec: 20 }); // rewound: position moves, furthest stays 30
  await bob('PUT', '/api/progress/ep001', { positionSec: 175 });
  assert.strictEqual((await alice('GET', '/api/progress')).body.ep001.positionSec, 20);
  assert.strictEqual((await bob('GET', '/api/progress')).body.ep001.positionSec, 175);

});

test('comments can be pinned to a moment, reported (hidden for review), and carry a blockable author key', async () => {
  const c = (await alice('POST', '/api/items/episode/ep001/comments', { name: 'Alice', body: 'This bit is great', atSec: 42.4 })).body;
  assert.strictEqual(c.atSec, 42);
  assert.match(c.authorKey, /^[0-9a-f]{16}$/);
  assert.strictEqual((await alice('POST', '/api/items/episode/ep001/comments', { name: 'A', body: 'x', atSec: -1 })).status, 400);
  assert.ok((await bob('GET', '/api/items/episode/ep001/comments')).body.some((x) => x.id === c.id));

  assert.strictEqual((await bob('POST', `/api/items/episode/ep001/comments/${c.id}/report`, { reason: 'Off topic' })).status, 204);
  assert.ok(!(await bob('GET', '/api/items/episode/ep001/comments')).body.some((x) => x.id === c.id), 'hidden once reported');
  const queued = (await host('GET', '/comments')).body.find((x) => x.id === c.id);
  assert.strictEqual(queued.itemTitle, 'Pair Programming with an AI Assistant');
  assert.deepStrictEqual(queued.reports, ['Off topic']);
  assert.strictEqual((await bob('POST', '/api/items/episode/ep001/comments/cm_nope/report', {})).status, 404);

  // A host can put it back.
  await host('PATCH', `/comments/${c.id}`, { status: 'approved' });
  assert.ok((await bob('GET', '/api/items/episode/ep001/comments')).body.some((x) => x.id === c.id));
});
