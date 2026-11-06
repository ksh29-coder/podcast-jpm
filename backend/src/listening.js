const express = require('express');
const { httpError } = require('./store');

// What the app sends about listening and watching (docs/listening-stats.md):
// listening sessions for episodes, and views of Shorts in the feed. Each is
// sent again and again as it goes, under an id the app makes, and each send
// replaces the last; one that arrives late (say, sent from a phone that was
// offline) never undoes a newer one. Only live episodes and Shorts count, so
// hosts trying out drafts don't show up in the stats.

const PLATFORMS = ['ios', 'android', 'web'];
// Where an episode was started from.
const SOURCES = ['home', 'search', 'episode', 'short', 'notification', 'link', 'continue', 'downloads', 'assistant', 'comments', 'other'];
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_RANGES = 2000;
// How far back a session sent late (after being offline) may have started.
const LATE_DAYS = 30;

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const round = (n) => Math.round(n * 1000) / 1000;

function oneOf(value, list, name) {
  if (!list.includes(value)) throw httpError(400, `${name} must be one of: ${list.join(', ')}`);
  return value;
}

function finite(value, name, { min = 0, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw httpError(400, `${name} must be a number from ${min}${Number.isFinite(max) ? ` to ${max}` : ''}`);
  return value;
}

// When the app says it started, if that's believable; otherwise now.
function startedAt(value) {
  const t = typeof value === 'string' ? new Date(value) : null;
  if (!t || Number.isNaN(t.getTime()) || t > new Date(Date.now() + 60_000) || t < new Date(Date.now() - LATE_DAYS * 86_400_000)) return new Date();
  return t;
}

// The parts played, [[from, to], …], kept inside the episode; and the
// seconds they add up to.
function cleanRanges(value, durationSec) {
  if (!Array.isArray(value) || value.length > MAX_RANGES) throw httpError(400, `ranges must be a list of up to ${MAX_RANGES} [from, to] pairs`);
  const ranges = [];
  for (const r of value) {
    if (!Array.isArray(r) || r.length !== 2 || !r.every((n) => typeof n === 'number' && Number.isFinite(n))) throw httpError(400, 'Each range must be [from, to] in seconds');
    const from = round(Math.max(0, Math.min(r[0], durationSec)));
    const to = round(Math.max(0, Math.min(r[1], durationSec)));
    if (to > from) ranges.push([from, to]);
  }
  return { ranges, heardSec: round(ranges.reduce((sum, [from, to]) => sum + to - from, 0)) };
}

function createListening({ db }) {
  // A live episode's length and its video (version), or null.
  async function liveEpisode(id) {
    const { rows } = await db.query(
      `select coalesce(v.duration_sec, e.duration_sec) as duration_sec, v.asset_id
       from episodes e left join videos v on v.id = e.video_id
       where e.id = $1 and e.status = 'published' and e.published_at <= now()`,
      [id]
    );
    return rows[0] || null;
  }

  function router() {
    const r = express.Router();

    // A listening session so far: { episodeId, ranges, stopSec, mode,
    // platform, source, speed, downloaded, startedAt }.
    r.put(
      '/listening/:id',
      ah(async (req, res) => {
        if (!ID.test(req.params.id)) throw httpError(400, 'Session ids are 8 to 64 letters, digits, - or _');
        const b = req.body || {};
        if (typeof b.episodeId !== 'string') throw httpError(400, 'episodeId is required');
        const ep = await liveEpisode(b.episodeId);
        if (!ep) return res.status(204).end();
        const durationSec = ep.duration_sec || 0;
        const { ranges, heardSec } = cleanRanges(b.ranges, durationSec);
        const fields = {
          stopSec: Math.min(finite(b.stopSec ?? 0, 'stopSec'), durationSec),
          mode: oneOf(b.mode, ['audio', 'video'], 'mode'),
          platform: oneOf(b.platform, PLATFORMS, 'platform'),
          source: oneOf(b.source ?? 'other', SOURCES, 'source'),
          speed: finite(b.speed ?? 1, 'speed', { min: 0.25, max: 4 }),
          downloaded: b.downloaded === true,
        };
        await db.query(
          `insert into listen_sessions (id, user_id, episode_id, version, started_at, ranges, heard_sec, stop_sec, mode, platform, source, speed, downloaded)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           on conflict (id) do update set ranges = excluded.ranges, heard_sec = excluded.heard_sec, stop_sec = excluded.stop_sec,
             speed = excluded.speed, updated_at = now()
           where listen_sessions.user_id = excluded.user_id and listen_sessions.episode_id = excluded.episode_id
             and excluded.heard_sec >= listen_sessions.heard_sec`,
          [req.params.id, req.user.id, b.episodeId, ep.asset_id, startedAt(b.startedAt), JSON.stringify(ranges), heardSec, fields.stopSec, fields.mode, fields.platform, fields.source, fields.speed, fields.downloaded]
        );
        res.status(204).end();
      })
    );

    // A Short shown in the feed so far: { shortId, watchedSec, loops,
    // openedEpisode, platform, shownAt }.
    r.put(
      '/short-views/:id',
      ah(async (req, res) => {
        if (!ID.test(req.params.id)) throw httpError(400, 'View ids are 8 to 64 letters, digits, - or _');
        const b = req.body || {};
        if (typeof b.shortId !== 'string') throw httpError(400, 'shortId is required');
        const { rows } = await db.query("select 1 from shorts where id = $1 and status = 'published' and published_at <= now()", [b.shortId]);
        if (!rows[0]) return res.status(204).end();
        const watched = round(finite(b.watchedSec ?? 0, 'watchedSec', { max: 4 * 3600 }));
        const loops = Math.round(finite(b.loops ?? 0, 'loops', { max: 1000 }));
        const platform = oneOf(b.platform, PLATFORMS, 'platform');
        await db.query(
          `insert into short_views (id, user_id, short_id, shown_at, watched_sec, loops, opened_episode, platform)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (id) do update set watched_sec = excluded.watched_sec, loops = excluded.loops,
             opened_episode = short_views.opened_episode or excluded.opened_episode, updated_at = now()
           where short_views.user_id = excluded.user_id and short_views.short_id = excluded.short_id
             and excluded.watched_sec >= short_views.watched_sec`,
          [req.params.id, req.user.id, b.shortId, startedAt(b.shownAt), watched, loops, b.openedEpisode === true, platform]
        );
        res.status(204).end();
      })
    );

    return r;
  }

  return { router };
}

module.exports = { createListening, SOURCES, PLATFORMS };
