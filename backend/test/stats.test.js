const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { createStats, episodeFigures, shortFigures, weekly, merge, repeated, jumps, minus, weekOf } = require('../src/stats');
const SETTINGS = require('../src/stats-settings');
const { fakeVideo } = require('./fake-video');

// Listening stats: what the app sends (listening.js), and what hosts see
// (stats.js) — totals only, and nothing based on fewer than 5 people.

const PASSCODE = 'test-passcode';
let server;
let base;
let db;

before(async () => {
  db = new PGlite();
  server = createApp({ db, video: fakeVideo(), cleanUpEveryMs: 0, tint: async () => '#334455', hostPasscode: PASSCODE }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const device = (n) => `dddddddd-0000-0000-0000-${String(n).padStart(12, '0')}`;
const send = async (who, path, body) => {
  const res = await fetch(`${base}/api${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Device-Id': device(who) }, body: JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const host = async (path) => (await fetch(`${base}/api/host${path}`, { headers: { 'X-Host-Passcode': PASSCODE } })).json();
const session = (n) => `session-${String(n).padStart(6, '0')}`;
const listen = (who, id, body) => send(who, `/listening/${id}`, { episodeId: 'ep001', mode: 'audio', platform: 'ios', source: 'home', ...body });

test('a session is saved as it goes; a late or stale send never undoes a newer one', async () => {
  assert.strictEqual((await listen(1, session(1), { ranges: [[0, 40]], stopSec: 40 })).status, 204);
  await listen(1, session(1), { ranges: [[0, 40], [100, 150]], stopSec: 150, speed: 1.5 });
  // Older (less heard) and someone else's sends are ignored.
  await listen(1, session(1), { ranges: [[0, 20]], stopSec: 20 });
  await listen(2, session(1), { ranges: [[0, 180]], stopSec: 180 });
  const { rows } = await db.query('select * from listen_sessions where id = $1', [session(1)]);
  assert.deepStrictEqual([rows[0].heard_sec, rows[0].stop_sec, rows[0].speed, rows[0].user_id], [90, 150, 1.5, `device:${device(1)}`]);
  assert.deepStrictEqual(rows[0].ranges, [[0, 40], [100, 150]]);

  // Kept inside the episode (180 seconds long).
  await listen(3, session(2), { ranges: [[170, 400], [-5, 10]], stopSec: 999 });
  const clipped = (await db.query('select ranges, heard_sec, stop_sec from listen_sessions where id = $1', [session(2)])).rows[0];
  assert.deepStrictEqual([clipped.ranges, clipped.heard_sec, clipped.stop_sec], [[[170, 180], [0, 10]], 20, 180]);

  for (const [body, error] of [
    [{ ranges: 'all' }, /ranges must be a list/],
    [{ ranges: [[0, 'x']] }, /Each range/],
    [{ ranges: [], mode: 'radio' }, /mode must be one of/],
    [{ ranges: [], platform: 'tv' }, /platform must be one of/],
    [{ ranges: [], source: 'billboard' }, /source must be one of/],
  ]) {
    const res = await listen(1, session(3), body);
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, error);
  }
  assert.strictEqual((await send(1, '/listening/x', {})).status, 400, 'a bad id');
  // An episode that isn't live is ignored.
  assert.strictEqual((await send(1, `/listening/${session(4)}`, { episodeId: 'nope', ranges: [], mode: 'audio', platform: 'web' })).status, 204);
  assert.strictEqual((await db.query('select count(*)::int as n from listen_sessions where id = $1', [session(4)])).rows[0].n, 0);
});

test('a Short view is saved as it goes; "play full episode" stays once tapped', async () => {
  const short = (who, id, body) => send(who, `/short-views/${id}`, { shortId: 'ep001-c1', platform: 'android', ...body });
  await short(1, 'view-000001', { watchedSec: 2, loops: 0 });
  await short(1, 'view-000001', { watchedSec: 45, loops: 1, openedEpisode: true });
  await short(1, 'view-000001', { watchedSec: 50, loops: 1, openedEpisode: false });
  const { rows } = await db.query('select watched_sec, loops, opened_episode from short_views where id = $1', ['view-000001']);
  assert.deepStrictEqual(rows[0], { watched_sec: 50, loops: 1, opened_episode: true });
  assert.strictEqual((await short(1, 'view-000002', { watchedSec: -1 })).status, 400);
});

// ---- The figures, from a made-up 600-second episode ----
//   people 1–5: heard it all (video, web, from Home), then heard 100–160 again;
//   people 6–10: heard 0–70, skipped to 200–250 and stopped (audio, iOS, from Search);
//   person 11: 10 seconds (not a play);
//   people 21–26: only watched its Short (300–330), all 30 seconds.
const D = 600;
const day = 86_400_000;
const published = new Date('2026-09-01T09:00:00Z');
const at = (days) => new Date(published.getTime() + days * day).toISOString();
const row = (n, ranges, extra = {}) => ({
  user_id: `u${n}`,
  started_at: at(1),
  ranges,
  heard_sec: ranges.reduce((s, [a, b]) => s + b - a, 0),
  stop_sec: ranges.at(-1)[1],
  mode: 'video',
  platform: 'web',
  source: 'home',
  ...extra,
});
const SESSIONS = [
  ...[1, 2, 3, 4, 5].flatMap((n) => [row(n, [[0, 600]]), row(n, [[100, 160]], { started_at: at(2) })]),
  ...[6, 7, 8, 9, 10].map((n) => row(n, [[0, 70], [200, 250]], { mode: 'audio', platform: 'ios', source: 'search', started_at: at(20) })),
  row(11, [[0, 10]]),
];
const SHORT_VIEWS = [21, 22, 23, 24, 25, 26].map((n) => ({ user_id: `u${n}`, shown_at: at(1), watched_sec: 30, start_sec: 300, end_sec: 330 }));
const FIRST = new Map([1, 2, 3, 4, 5].map((n) => [`u${n}`, 'ep1']).concat([6, 7, 8, 9, 10].map((n) => [`u${n}`, 'ep0'])));
const figures = (sessions = SESSIONS, shortViews = SHORT_VIEWS) =>
  episodeFigures({ durationSec: D, publishedAt: published, sessions, shortViews, archived: null, firstEpisodes: FIRST, episodeId: 'ep1', now: new Date(at(30)) });

test('headline figures: plays, listeners (Shorts included), engaged, completed, time listened', () => {
  const { all, firstDays } = figures();
  assert.deepStrictEqual(all, {
    enough: true,
    plays: 15,
    listeners: 16,
    engaged: 5,
    completed: 5,
    completionRate: 0.313,
    timeListenedSec: 5 * 660 + 5 * 120 + 10 + 6 * 30,
    avgConsumption: Math.round(((5 * 660 + 5 * 120 + 10 + 6 * 30) / (16 * 600)) * 1000) / 1000,
    fromShorts: { listeners: 6, onlyShorts: 6, timeSec: 180 },
  });
  // People 6–10 listened after the first 7 days.
  assert.deepStrictEqual([firstDays.listeners, firstDays.plays, firstDays.complete], [11, 10, true]);
});

test('retention, where people stopped, and key moments', () => {
  const f = figures();
  const share = (t) => f.retention[Math.floor((t / D) * 100)];
  assert.strictEqual(share(30), 0.625, '10 of 16 listeners');
  assert.strictEqual(share(150), 0.313, 'the skipped part: 5 of 16');
  assert.strictEqual(share(400), 0.313);
  assert.strictEqual(f.retentionFromShorts[Math.floor((315 / D) * 100)], 0.375, '6 of 16 heard 300–330 through the Short');
  assert.deepStrictEqual(f.stopped, [{ fromSec: 240, toSec: 270, people: 5, share: 0.313 }]);
  assert.deepStrictEqual(f.moments.intro, { atSec: 60, share: 0.625 });
  assert.deepStrictEqual(f.moments.skipped, [{ fromSec: 72, toSec: 198, people: 5 }]);
  assert.deepStrictEqual(f.moments.replayed, [{ fromSec: 102, toSec: 162, people: 5 }]);
  assert.strictEqual(f.moments.drops.length, 2, 'after 70s and after 250s');
  assert.ok(f.moments.drops.some((d) => d.fromSec <= 66 && d.toSec >= 72 && d.fromShare === 0.625 && d.toShare === 0.313));
});

test('splits by mode, platform, source and new or returning, grouping small ones', () => {
  const f = figures();
  assert.deepStrictEqual(f.splits.mode, [{ key: 'video', listeners: 5, timeSec: 3300 }, { key: 'audio', listeners: 5, timeSec: 600 }]);
  assert.deepStrictEqual(f.splits.source.map((s) => s.key), ['home', 'search']);
  assert.deepStrictEqual(f.splits.audience, [{ key: 'new', listeners: 5 }, { key: 'returning', listeners: 5 }]);
  // Four on Android and one on the web: too few to show alone, so together as "other".
  const mixed = SESSIONS.map((s) => (['u1', 'u2', 'u3', 'u4'].includes(s.user_id) ? { ...s, platform: 'android' } : s));
  assert.deepStrictEqual(figures(mixed).splits.platform.map((s) => [s.key, s.listeners]), [['ios', 5], ['other', 5]]);
  // Only four not on iOS: left out, rather than shown as a group of four.
  const four = mixed.filter((s) => s.user_id !== 'u5');
  assert.deepStrictEqual(figures(four).splits.platform.map((s) => [s.key, s.listeners]), [['ios', 5]]);
});

test('nothing is shown for fewer than 5 people', () => {
  const few = figures(SESSIONS.filter((s) => ['u1', 'u2', 'u3', 'u4'].includes(s.user_id)), []);
  assert.deepStrictEqual(few.all, { enough: false });
  assert.strictEqual(few.retention, undefined);
  assert.strictEqual(few.moments, undefined);
  // Enough listeners, but fewer than 5 engaged: that figure alone is left out.
  const some = figures(SESSIONS.filter((s) => !['u2', 'u3'].includes(s.user_id)), []);
  assert.deepStrictEqual([some.all.listeners, some.all.engaged, some.all.completed], [8, null, null]);
  // A Short watched by 4: its row says too few.
  assert.deepStrictEqual(shortFigures({ short: { id: 's', title: 'S', lengthSec: 30 }, views: SHORT_VIEWS.slice(0, 4).map((v) => ({ ...v, loops: 0, opened_episode: false })) }), {
    id: 's', title: 'S', episodeId: undefined, lengthSec: 30, enough: false,
  });
});

test('Shorts: viewed or swiped away, share watched, loops, and going on to the episode', () => {
  const views = [
    ...[1, 2, 3, 4].map((n) => ({ user_id: `u${n}`, watched_sec: 60, loops: 1, opened_episode: n === 1 })),
    { user_id: 'u5', watched_sec: 1, loops: 0, opened_episode: false },
    { user_id: 'u5', watched_sec: 15, loops: 0, opened_episode: false },
  ];
  assert.deepStrictEqual(shortFigures({ short: { id: 's', title: 'S', episode_id: 'e', lengthSec: 30 }, views, archived: { plays: 10 } }), {
    id: 's', title: 'S', episodeId: 'e', lengthSec: 30, enough: true,
    views: 16, viewers: 5, viewedShare: 0.833, swipedShare: 0.167, avgWatchedShare: 1.422, loops: 4, openedEpisode: 1,
  });
});

test('weekly listeners, plays and time; weeks with too few people are left out', () => {
  const now = new Date(at(21));
  const weeks = weekly({ sessions: SESSIONS, shortViews: SHORT_VIEWS, now, weeks: 4 });
  assert.deepStrictEqual(weeks.map((w) => w.week), [weekOf(at(0)), weekOf(at(7)), weekOf(at(14)), weekOf(at(21))]);
  const first = weeks.find((w) => w.week === weekOf(at(1)));
  assert.deepStrictEqual([first.listeners, first.plays], [11, 10]);
  assert.strictEqual(weeks.find((w) => w.week === weekOf(at(20))).listeners, 5);
  assert.strictEqual(weeks.find((w) => w.week === weekOf(at(7))).listeners, null);
});

test('the range sums', () => {
  assert.deepStrictEqual(merge([[5, 10], [0, 3], [2, 6]]), [[0, 10]]);
  assert.deepStrictEqual(repeated([[0, 100], [40, 50], [90, 92]], 5), [[40, 50]]);
  assert.deepStrictEqual(jumps([[0, 10], [12, 20], [60, 70]], 5), [[20, 60]]);
  assert.deepStrictEqual(minus([[0, 100]], [[10, 20], [50, 60]]), [[0, 10], [20, 50], [60, 100]]);
});

test('hosts get the stats over the API, worked out once and kept for a while', async () => {
  for (let n = 10; n < 16; n++) await listen(n, session(n), { ranges: [[0, 180]], stopSec: 180, mode: n < 13 ? 'video' : 'audio' });
  for (let n = 10; n < 16; n++) await send(n, `/short-views/view-${String(n).padStart(6, '0')}`, { shortId: 'ep001-c1', watchedSec: n === 10 ? 1 : 30, loops: 0, platform: 'ios' });
  const ep = await host('/episodes/ep001/stats');
  assert.strictEqual(ep.all.enough, true);
  assert.strictEqual(ep.all.completed, 6);
  assert.strictEqual(ep.retention.length, 100);
  assert.ok(ep.refreshedAt);
  assert.strictEqual(JSON.stringify(ep).includes('device:'), false, 'nobody is named');

  // More listening doesn't show until the figures are worked out again.
  await listen(20, session(20), { ranges: [[0, 180]], stopSec: 180 });
  assert.strictEqual((await host('/episodes/ep001/stats')).all.listeners, ep.all.listeners);

  const show = await host('/stats');
  assert.ok(show.totals.listeners >= 6);
  assert.strictEqual(show.weeks.length, 12);
  assert.deepStrictEqual(show.episodes.map((e) => e.id).sort(), ['ep001', 'ep002']);
  const short = show.shorts.find((s) => s.id === 'ep001-c1');
  assert.deepStrictEqual([short.enough, short.viewers, short.swipedShare], [true, 7, 0.143]);
  assert.strictEqual((await fetch(`${base}/api/host/episodes/nope/stats`, { headers: { 'X-Host-Passcode': PASSCODE } })).status, 404);
  assert.strictEqual((await fetch(`${base}/api/host/stats`)).status, 401);
});

test('after the keeping time, sessions go but their plays and time stay in the totals', async () => {
  const later = new Date(Date.now() + (SETTINGS.KEEP_MONTHS + 1) * 31 * day);
  const before = (await db.query("select count(*) filter (where heard_sec >= 30)::int as plays, sum(heard_sec) as heard from listen_sessions where episode_id = 'ep001'")).rows[0];
  const stats = createStats({ db, now: () => later });
  await stats.cleanUp();
  assert.strictEqual((await db.query('select count(*)::int as n from listen_sessions')).rows[0].n, 0);
  assert.strictEqual((await db.query('select count(*)::int as n from short_views')).rows[0].n, 0);
  const kept = (await db.query("select plays, heard_sec from listen_totals where item_type = 'episode' and item_id = 'ep001'")).rows[0];
  assert.deepStrictEqual([kept.plays, kept.heard_sec], [before.plays, Number(before.heard)]);
});

test('getting to the end after skipping isn’t stopping, and listening up to the intro’s end counts', () => {
  const skippers = [1, 2, 3, 4, 5].map((n) => row(n, [[0, 60], [100, 600]]));
  const quitters = [6, 7, 8, 9, 10].map((n) => row(n, [[0, 30]]));
  const f = figures([...skippers, ...quitters], []);
  assert.deepStrictEqual(f.stopped.map((s) => [s.fromSec, s.people]), [[30, 5]], 'only the ones who left at 30 s');
  assert.strictEqual(f.moments.intro.share, 0.5, 'the skippers heard up to exactly 60 s');
});

test('total listeners are people with a play (or 30 seconds through a Short), not everyone who pressed play', async () => {
  const stats = createStats({ db, settings: { ...SETTINGS, REFRESH_MIN: 0 } });
  // Enough people for a total to show.
  for (let n = 50; n < 55; n++) await listen(n, session(n), { ranges: [[0, 60]], stopSec: 60 });
  const before = (await stats.show()).totals;
  await listen(40, session(40), { ranges: [[0, 5]], stopSec: 5 });
  await send(41, '/short-views/view-000041', { shortId: 'ep001-c1', watchedSec: 30, platform: 'web' });
  const after = (await stats.show()).totals;
  assert.strictEqual(after.listeners - before.listeners, 1, 'the Short watcher, not the 5-second one');
});
