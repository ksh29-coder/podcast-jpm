const SETTINGS = require('./stats-settings');

// Listening stats for hosts (docs/listening-stats.md), worked out from the
// listening sessions and Shorts views the app sends (listening.js).
//
// Hosts only ever see totals: nothing here names anyone, and any figure based
// on fewer than MIN_PEOPLE people is left out (null, shown as "fewer than 5").
// Worked out at most every REFRESH_MIN minutes and kept in stats_cache.

const POINTS = 100;
const round = (n, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

// ---- Ranges: [[from, to], …] in seconds ----

// Joined up and in order, so each second counts once.
function merge(ranges) {
  const out = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

const length = (ranges) => ranges.reduce((sum, [from, to]) => sum + to - from, 0);
const covers = (merged, t) => merged.some(([from, to]) => t >= from && t < to);

// The parts covered at least twice (heard again), at least minSec long.
function repeated(ranges, minSec) {
  const edges = ranges.flatMap(([from, to]) => [[from, 1], [to, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  let depth = 0;
  let start = null;
  for (const [t, d] of edges) {
    depth += d;
    if (depth >= 2 && start === null) start = t;
    if (depth < 2 && start !== null) {
      if (t - start >= minSec) out.push([start, t]);
      start = null;
    }
  }
  return out;
}

// The parts jumped over within a session (seeking forward past at least minSec).
function jumps(ranges, minSec) {
  const out = [];
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] > ranges[i - 1][1] + minSec) out.push([ranges[i - 1][1], ranges[i][0]]);
  }
  return out;
}

// What's in a but not in b (both merged).
function minus(a, b) {
  const out = [];
  for (const [from, to] of a) {
    let at = from;
    for (const [bf, bt] of b) {
      if (bt <= at || bf >= to) continue;
      if (bf > at) out.push([at, bf]);
      at = Math.max(at, bt);
    }
    if (at < to) out.push([at, to]);
  }
  return out;
}

// ---- One episode ----

// Everyone who heard the episode, from its sessions and its Shorts' views:
// Map user -> { ranges, heard, plays, sessions, shortRanges, shortHeard }.
function byPerson(sessions, shortViews, S) {
  const people = new Map();
  const get = (id) => {
    if (!people.has(id)) people.set(id, { ranges: [], heard: 0, plays: 0, sessions: [], shortRanges: [], shortHeard: 0 });
    return people.get(id);
  };
  for (const s of sessions) {
    const p = get(s.user_id);
    p.ranges.push(...s.ranges);
    p.heard += s.heard_sec;
    if (s.heard_sec >= S.PLAY_SEC) p.plays += 1;
    p.sessions.push(s);
  }
  // A Short cut from the episode is a part of it: what was watched of it,
  // from where it starts (all of it once it has looped).
  for (const v of shortViews) {
    const p = get(v.user_id);
    p.shortHeard += v.watched_sec;
    const end = Math.min(v.end_sec, v.start_sec + v.watched_sec);
    if (end > v.start_sec) p.shortRanges.push([v.start_sec, end]);
  }
  for (const p of people.values()) {
    p.merged = merge(p.ranges);
    p.all = merge([...p.ranges, ...p.shortRanges]);
    p.listener = p.plays > 0;
    p.viaShort = p.shortHeard >= S.PLAY_SEC;
  }
  return people;
}

// Plays, listeners, engaged, completed, time listened and average
// consumption: { …, enough } (enough: at least MIN_PEOPLE listeners).
function headline(people, durationSec, archived, S) {
  const all = [...people.values()];
  const listeners = all.filter((p) => p.listener || p.viaShort);
  const engaged = listeners.filter((p) => length(p.all) >= Math.min(S.ENGAGED_SHARE * durationSec, S.ENGAGED_SEC));
  const completed = listeners.filter((p) => length(p.all) >= S.COMPLETED_SHARE * durationSec);
  const heard = all.reduce((sum, p) => sum + p.heard, 0) + (archived?.heard_sec || 0);
  const shortHeard = all.reduce((sum, p) => sum + p.shortHeard, 0);
  const viaShortsOnly = listeners.filter((p) => !p.listener);
  const enough = listeners.length >= S.MIN_PEOPLE;
  const few = (n) => (n >= S.MIN_PEOPLE ? n : null);
  if (!enough) return { enough: false };
  return {
    enough: true,
    plays: all.reduce((sum, p) => sum + p.plays, 0) + (archived?.plays || 0),
    listeners: listeners.length,
    engaged: few(engaged.length),
    completed: few(completed.length),
    completionRate: round(completed.length / listeners.length),
    timeListenedSec: Math.round(heard + shortHeard),
    avgConsumption: durationSec ? round((heard + shortHeard) / (listeners.length * durationSec)) : null,
    fromShorts: { listeners: few(listeners.filter((p) => p.viaShort).length), onlyShorts: few(viaShortsOnly.length), timeSec: Math.round(shortHeard) },
  };
}

// For each of POINTS points across the episode, how many of `people` the
// test holds for.
const curve = (durationSec, people, test) =>
  Array.from({ length: POINTS }, (_, i) => {
    const t = ((i + 0.5) / POINTS) * durationSec;
    return people.filter((p) => test(p, t)).length;
  });

// Stretches where count stays at least `min`, with the most people in each:
// the top 3 [{ fromSec, toSec, people }].
function peaks(counts, durationSec, min) {
  const out = [];
  let start = null;
  for (let i = 0; i <= counts.length; i++) {
    if (i < counts.length && counts[i] >= min) {
      if (start === null) start = i;
    } else if (start !== null) {
      const most = Math.max(...counts.slice(start, i));
      out.push({ fromSec: Math.round((start / POINTS) * durationSec), toSec: Math.round((i / POINTS) * durationSec), people: most });
      start = null;
    }
  }
  return out.sort((a, b) => b.people - a.people).slice(0, 3);
}

// Breakdowns by one property of the sessions (mode, platform, source):
// [{ key, listeners, timeSec }], with groups of fewer than MIN_PEOPLE put
// together as "other" (or left out if that's still too few).
function split(listeners, key, S) {
  const groups = new Map();
  for (const p of listeners) {
    for (const s of p.sessions) {
      if (!groups.has(s[key])) groups.set(s[key], { people: new Set(), timeSec: 0 });
      const g = groups.get(s[key]);
      if (s.heard_sec >= S.PLAY_SEC) g.people.add(p);
      g.timeSec += s.heard_sec;
    }
  }
  const out = [];
  const other = { people: new Set(), timeSec: 0 };
  for (const [k, g] of groups) {
    if (g.people.size >= S.MIN_PEOPLE) out.push({ key: k, listeners: g.people.size, timeSec: Math.round(g.timeSec) });
    else {
      g.people.forEach((p) => other.people.add(p));
      other.timeSec += g.timeSec;
    }
  }
  if (other.people.size >= S.MIN_PEOPLE) out.push({ key: 'other', listeners: other.people.size, timeSec: Math.round(other.timeSec) });
  return out.sort((a, b) => b.listeners - a.listeners);
}

// Everything hosts see about one episode. firstEpisodes: Map user -> the
// first episode they ever played (for new vs returning listeners).
function episodeFigures({ durationSec, publishedAt, sessions, shortViews, archived, firstEpisodes, episodeId, now }, S = SETTINGS) {
  const people = byPerson(sessions, shortViews, S);
  const all = headline(people, durationSec, archived, S);
  const days = S.FIRST_DAYS * 86_400_000;
  const live = publishedAt ? new Date(publishedAt).getTime() : null;
  const early = (t) => live !== null && new Date(t).getTime() < live + days;
  const firstDays = live
    ? {
        ...headline(byPerson(sessions.filter((s) => early(s.started_at)), shortViews.filter((v) => early(v.shown_at)), S), durationSec, null, S),
        // Whether the first days are over (otherwise these are so far).
        complete: now.getTime() >= live + days,
      }
    : null;
  const out = { durationSec, all, firstDays, definitions: S };
  if (!all.enough) return out;

  const listeners = [...people.values()].filter((p) => p.listener);
  const base = [...people.values()].filter((p) => p.listener || p.viaShort).length;
  const share = (n) => round(n / base);
  // Retention: the share of listeners who heard each point, from the
  // episode itself; and, separately, through its Shorts.
  const heard = curve(durationSec, listeners, (p, t) => covers(p.merged, t));
  out.retention = heard.map(share);
  const shortsAt = curve(durationSec, [...people.values()], (p, t) => covers(merge(p.shortRanges), t));
  out.retentionFromShorts = shortsAt.some((n) => n >= S.MIN_PEOPLE) ? shortsAt.map(share) : null;

  // Where people stopped: the last place each listener who didn't finish got
  // to, in twentieths of the episode; the stretches with enough people. One
  // who got to the last twentieth (having skipped some) didn't stop early.
  const notDone = listeners.filter((p) => length(p.all) < S.COMPLETED_SHARE * durationSec);
  const buckets = new Array(20).fill(0);
  for (const p of notDone) {
    const last = p.sessions.reduce((a, b) => (new Date(b.started_at) > new Date(a.started_at) ? b : a));
    const at = Math.floor((last.stop_sec / durationSec) * 20);
    if (at < 19) buckets[at] += 1;
  }
  out.stopped = buckets
    .map((n, i) => ({ fromSec: Math.round((i / 20) * durationSec), toSec: Math.round(((i + 1) / 20) * durationSec), people: n, share: share(n) }))
    .filter((b) => b.people >= S.MIN_PEOPLE)
    .sort((a, b) => b.people - a.people)
    .slice(0, 3);

  // Key moments.
  const enoughFor = Math.max(S.MIN_PEOPLE, Math.ceil(listeners.length * 0.1));
  const introAt = Math.min(60, durationSec / 2);
  const skipped = curve(durationSec, listeners, (p, t) => covers(minus(merge(p.sessions.flatMap((s) => jumps(s.ranges, 5))), p.merged), t));
  const replayed = curve(durationSec, listeners, (p, t) => covers(repeated(p.ranges, 5), t));
  const drops = [];
  const w = 3;
  const candidates = heard
    .map((n, i) => ({ i, drop: i + w < POINTS - 5 ? (n - heard[i + w]) / listeners.length : 0 }))
    .filter((c) => c.drop >= 0.03)
    .sort((a, b) => b.drop - a.drop);
  for (const c of candidates) {
    if (drops.length === 3) break;
    if (drops.some((d) => Math.abs(d.i - c.i) <= w)) continue;
    drops.push(c);
  }
  out.moments = {
    // Heard up to the end of the intro (a second before, so listening up to
    // exactly then counts).
    intro: { atSec: Math.round(introAt), share: share(listeners.filter((p) => covers(p.merged, introAt - 1)).length) },
    skipped: peaks(skipped, durationSec, enoughFor),
    replayed: peaks(replayed, durationSec, enoughFor),
    drops: drops.map(({ i }) => ({
      fromSec: Math.round((i / POINTS) * durationSec),
      toSec: Math.round(((i + w) / POINTS) * durationSec),
      fromShare: share(heard[i]),
      toShare: share(heard[i + w]),
    })),
  };

  // Who listened, and how.
  const fresh = listeners.filter((p) => firstEpisodes.get(p.sessions[0].user_id) === episodeId).length;
  out.splits = {
    mode: split(listeners, 'mode', S),
    platform: split(listeners, 'platform', S),
    source: split(listeners, 'source', S),
    audience: [
      { key: 'new', listeners: fresh >= S.MIN_PEOPLE ? fresh : null },
      { key: 'returning', listeners: listeners.length - fresh >= S.MIN_PEOPLE ? listeners.length - fresh : null },
    ],
  };
  return out;
}

// ---- Across the show ----

// Monday 00:00 UTC of t's week.
function weekOf(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

// Listeners, plays and time listened per week, for the last `weeks` weeks.
function weekly({ sessions, shortViews, now, weeks = 12 }, S = SETTINGS) {
  const starts = Array.from({ length: weeks }, (_, i) => weekOf(now.getTime() - (weeks - 1 - i) * 7 * 86_400_000));
  const rows = new Map(starts.map((w) => [w, { week: w, people: new Set(), plays: 0, timeSec: 0 }]));
  for (const s of sessions) {
    const r = rows.get(weekOf(s.started_at));
    if (!r) continue;
    r.timeSec += s.heard_sec;
    if (s.heard_sec >= S.PLAY_SEC) {
      r.plays += 1;
      r.people.add(s.user_id);
    }
  }
  for (const v of shortViews) {
    const r = rows.get(weekOf(v.shown_at));
    if (!r) continue;
    r.timeSec += v.watched_sec;
    if (v.watched_sec >= S.PLAY_SEC) r.people.add(v.user_id);
  }
  return starts.map((w) => {
    const r = rows.get(w);
    const enough = r.people.size >= S.MIN_PEOPLE;
    return { week: w, listeners: enough ? r.people.size : null, plays: enough ? r.plays : null, timeSec: enough ? Math.round(r.timeSec) : null };
  });
}

// One line per Short: views, viewers, how many watched past the first
// seconds, average share watched, loops, and how many went to the episode.
function shortFigures({ short, views, archived }, S = SETTINGS) {
  const viewers = new Set(views.map((v) => v.user_id)).size;
  const len = short.lengthSec || 0;
  const base = { id: short.id, title: short.title, episodeId: short.episode_id, lengthSec: len };
  if (viewers < S.MIN_PEOPLE) return { ...base, enough: false };
  const viewed = views.filter((v) => v.watched_sec >= S.SWIPED_SEC).length;
  return {
    ...base,
    enough: true,
    views: views.length + (archived?.plays || 0),
    viewers,
    viewedShare: round(viewed / views.length),
    swipedShare: round(1 - viewed / views.length),
    // Can be over 1: loops count.
    avgWatchedShare: len ? round(views.reduce((sum, v) => sum + v.watched_sec / len, 0) / views.length) : null,
    loops: views.reduce((sum, v) => sum + v.loops, 0),
    openedEpisode: views.filter((v) => v.opened_episode).length,
  };
}

// ---- Reading the database ----

function createStats({ db, settings = SETTINGS, now = () => new Date() }) {
  const S = settings;
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

  // The figures under key, worked out again if older than REFRESH_MIN.
  async function cached(key, make) {
    const { rows } = await db.query('select value, computed_at from stats_cache where key = $1', [key]);
    if (rows[0] && now() - new Date(rows[0].computed_at) < S.REFRESH_MIN * 60_000) return parse(rows[0].value);
    await cleanUp();
    const value = { ...(await make()), refreshedAt: now().toISOString() };
    await db.query(
      `insert into stats_cache (key, value, computed_at) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, computed_at = excluded.computed_at`,
      [key, JSON.stringify(value), now().toISOString()]
    );
    return value;
  }

  // Sessions and Shorts views older than KEEP_MONTHS go; their plays and
  // time are added to listen_totals. At most once an hour per server.
  let lastCleanUp = 0;
  async function cleanUp() {
    if (now() - lastCleanUp < 3_600_000) return;
    lastCleanUp = now().getTime();
    const cutoff = new Date(now());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - S.KEEP_MONTHS);
    await db.query(
      `with gone as (delete from listen_sessions where started_at < $1 returning episode_id, heard_sec)
       insert into listen_totals (item_type, item_id, plays, heard_sec)
       select 'episode', episode_id, count(*) filter (where heard_sec >= $2), sum(heard_sec) from gone group by episode_id
       on conflict (item_type, item_id) do update set plays = listen_totals.plays + excluded.plays, heard_sec = listen_totals.heard_sec + excluded.heard_sec`,
      [cutoff.toISOString(), S.PLAY_SEC]
    );
    await db.query(
      `with gone as (delete from short_views where shown_at < $1 returning short_id, watched_sec)
       insert into listen_totals (item_type, item_id, plays, heard_sec)
       select 'short', short_id, count(*), sum(watched_sec) from gone group by short_id
       on conflict (item_type, item_id) do update set plays = listen_totals.plays + excluded.plays, heard_sec = listen_totals.heard_sec + excluded.heard_sec`,
      [cutoff.toISOString()]
    );
  }

  const sessionRows = (rows) => rows.map((r) => ({ ...r, ranges: parse(r.ranges) }));
  const SESSION = 'user_id, episode_id, started_at, ranges, heard_sec, stop_sec, mode, platform, source';
  const SHORT_VIEW = 'sv.user_id, sv.shown_at, sv.watched_sec, sv.loops, sv.opened_episode, s.start_sec, s.end_sec';

  // The first episode each of these people ever played.
  async function firstEpisodes(userIds) {
    if (!userIds.length) return new Map();
    const { rows } = await db.query(
      `select distinct on (user_id) user_id, episode_id from listen_sessions
       where user_id = any($1) and heard_sec >= $2 order by user_id, started_at`,
      [userIds, S.PLAY_SEC]
    );
    return new Map(rows.map((r) => [r.user_id, r.episode_id]));
  }

  async function figuresFor(ep) {
    const sessions = sessionRows((await db.query(`select ${SESSION} from listen_sessions where episode_id = $1 order by started_at`, [ep.id])).rows);
    const { rows: shortViews } = await db.query(
      `select ${SHORT_VIEW} from short_views sv join shorts s on s.id = sv.short_id
       where s.episode_id = $1 and s.source = 'episode' and s.start_sec is not null and s.end_sec is not null`,
      [ep.id]
    );
    const archived = (await db.query("select plays, heard_sec from listen_totals where item_type = 'episode' and item_id = $1", [ep.id])).rows[0];
    const first = await firstEpisodes([...new Set(sessions.map((s) => s.user_id))]);
    return episodeFigures({ durationSec: ep.duration_sec || 0, publishedAt: ep.published_at, sessions, shortViews, archived, firstEpisodes: first, episodeId: ep.id, now: now() }, S);
  }

  const EPISODE = `select e.id, e.title, e.status, e.published_at, coalesce(v.duration_sec, e.duration_sec) as duration_sec
    from episodes e left join videos v on v.id = e.video_id`;

  return {
    // One episode's stats, or null if there's no such episode.
    async episode(id) {
      const ep = (await db.query(`${EPISODE} where e.id = $1`, [id])).rows[0];
      if (!ep) return null;
      return cached(`episode:${id}`, () => figuresFor(ep));
    },

    // Across the show: weekly listening, totals, every live episode's
    // headline figures, and the Shorts table.
    async show() {
      return cached('show', async () => {
        const since = new Date(now().getTime() - 12 * 7 * 86_400_000).toISOString();
        const sessions = sessionRows((await db.query(`select ${SESSION} from listen_sessions where started_at >= $1`, [since])).rows);
        const { rows: shortViews } = await db.query(`select sv.user_id, sv.shown_at, sv.watched_sec from short_views sv where sv.shown_at >= $1`, [since]);
        const { rows: episodes } = await db.query(`${EPISODE} where e.status = 'published' and e.published_at <= now() order by e.published_at desc`);
        const list = [];
        for (const ep of episodes) {
          const f = await figuresFor(ep);
          list.push({ id: ep.id, title: ep.title, publishedAt: ep.published_at && new Date(ep.published_at).toISOString(), durationSec: f.durationSec, all: f.all, firstDays: f.firstDays });
        }
        const { rows: shorts } = await db.query(
          `select s.id, s.title, s.episode_id, coalesce(s.end_sec - s.start_sec, v.duration_sec) as length_sec
           from shorts s left join videos v on v.id = s.video_id
           where s.status = 'published' and s.published_at <= now() order by s.published_at desc`
        );
        const { rows: views } = await db.query('select short_id, user_id, watched_sec, loops, opened_episode from short_views');
        const { rows: archived } = await db.query("select item_id, plays from listen_totals where item_type = 'short'");
        const archivedBy = new Map(archived.map((a) => [a.item_id, a]));
        const totals = (await db.query("select coalesce(sum(plays), 0)::int as plays, coalesce(sum(heard_sec), 0) as heard from listen_totals where item_type = 'episode'")).rows[0];
        const { rows: all } = await db.query(
          `select (select count(*)::int from (select user_id from listen_sessions where heard_sec >= $1
                     union select user_id from short_views where watched_sec >= $1) people) as listeners,
                  count(*) filter (where heard_sec >= $1)::int as plays, coalesce(sum(heard_sec), 0) as heard
           from listen_sessions`,
          [S.PLAY_SEC]
        );
        const shortTime = (await db.query('select coalesce(sum(watched_sec), 0) as t from short_views')).rows[0].t;
        const enough = all[0].listeners >= S.MIN_PEOPLE;
        return {
          totals: enough
            ? { listeners: all[0].listeners, plays: all[0].plays + totals.plays, timeListenedSec: Math.round(Number(all[0].heard) + Number(totals.heard) + Number(shortTime)) }
            : null,
          weeks: weekly({ sessions, shortViews, now: now() }, S),
          episodes: list,
          shorts: shorts.map((s) =>
            shortFigures({ short: { ...s, lengthSec: s.length_sec }, views: views.filter((v) => v.short_id === s.id), archived: archivedBy.get(s.id) }, S)
          ),
          definitions: S,
        };
      });
    },

    cleanUp,
  };
}

module.exports = { createStats, episodeFigures, shortFigures, weekly, merge, repeated, jumps, minus, weekOf };
