const crypto = require('crypto');
const express = require('express');
const { STATUSES } = require('./db');
const { httpError, MAX_SHORT_SEC } = require('./store');
const { cues, num, str, tags } = require('./validate');

// Host mode: uploading and publishing episodes and Shorts.
//
// Until SSO lands, hosts unlock it with a shared passcode (HOST_PASSCODE),
// sent as the X-Host-Passcode header. Swap this check for a role on req.user
// once real sign-in exists.
//
// Wrong guesses are limited per network address: after MAX_FAILURES within
// WINDOW_MIN minutes, that address is locked out for WINDOW_MIN minutes. The
// count lives in the database because serverless instances share no memory.
const MAX_FAILURES = 10;
const WINDOW_MIN = 15;

function requireHost(passcode = process.env.HOST_PASSCODE, db) {
  const expected = passcode && crypto.createHash('sha256').update(passcode).digest();
  return async (req, res, next) => {
    try {
      if (!expected) return res.status(503).json({ error: 'Host mode is not set up on this server' });
      const key = `ip:${req.ip}`;
      if (db) {
        const { rows } = await db.query('select locked_until from host_attempts where key = $1 and locked_until > now()', [key]);
        if (rows[0]) {
          const mins = Math.max(1, Math.ceil((new Date(rows[0].locked_until) - Date.now()) / 60_000));
          return res.status(429).json({ error: `Too many wrong passcodes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
        }
      }
      const given = crypto.createHash('sha256').update(String(req.get('X-Host-Passcode') || '')).digest();
      if (!crypto.timingSafeEqual(given, expected)) {
        if (db) {
          await db.query(
            `insert into host_attempts (key, failures, window_start) values ($1, 1, now())
             on conflict (key) do update set
               failures = case when host_attempts.window_start < now() - interval '${WINDOW_MIN} minutes' then 1 else host_attempts.failures + 1 end,
               window_start = case when host_attempts.window_start < now() - interval '${WINDOW_MIN} minutes' then now() else host_attempts.window_start end,
               locked_until = case
                 when host_attempts.window_start >= now() - interval '${WINDOW_MIN} minutes' and host_attempts.failures + 1 >= ${MAX_FAILURES}
                 then now() + interval '${WINDOW_MIN} minutes' else null end`,
            [key]
          );
        }
        return res.status(401).json({ error: 'Wrong host passcode' });
      }
      if (db) await db.query('delete from host_attempts where key = $1', [key]);
      next();
    } catch (e) {
      next(e);
    }
  };
}

// Express 4 doesn't catch rejected promises from handlers.
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// An ISO time up to a year ahead; only with status "published".
function publishAt(value, statusValue) {
  if (value === undefined || value === null) return undefined;
  const t = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(t.getTime())) throw httpError(400, 'publishAt must be a date and time');
  if (t.getTime() > Date.now() + 366 * 24 * 3600_000) throw httpError(400, 'publishAt can be at most a year ahead');
  if (statusValue !== 'published') throw httpError(400, 'Set status to "published" together with publishAt to schedule it');
  return t.toISOString();
}

function status(value) {
  if (value === undefined) return undefined;
  if (!STATUSES.includes(value)) throw httpError(400, `status must be one of ${STATUSES.join(', ')}`);
  return value;
}

function mentions(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw httpError(400, 'mentions must be a list');
  return value.slice(0, 25).map((m, i) => ({
    startSec: num(m?.startSec, `mentions[${i}].startSec`, { required: true, min: 0 }),
    name: str(m?.name, `mentions[${i}].name`, { required: true, max: 80 }),
    kind: str(m?.kind, `mentions[${i}].kind`, { max: 20 }) ?? 'concept',
    // Only plain https links reach listeners.
    url: typeof m?.url === 'string' && /^https:\/\/\S+$/.test(m.url) ? m.url.slice(0, 300) : null,
  }));
}

// {"0": "Kai", "1": "Isabella"}: names for detected speakers.
function speakers(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'speakers must be an object like {"0": "Kai"}');
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, 10)) {
    if (!/^\d+$/.test(k)) throw httpError(400, 'speaker keys are numbers');
    const name = str(v, `speakers.${k}`, { max: 40 });
    if (name) out[k] = name;
  }
  return out;
}

function chapters(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw httpError(400, 'chapters must be a list');
  return value.map((c, i) => ({
    title: str(c?.title, `chapters[${i}].title`, { required: true, max: 200 }),
    startSec: num(c?.startSec, `chapters[${i}].startSec`, { required: true, min: 0 }),
  }));
}

function hostRouter({ store, engagement, push, later, baseUrl, passcode, db }) {
  const r = express.Router();
  r.use(requireHost(passcode, db));
  const by = () => 'host';

  // Lets the app check a passcode before showing host screens.
  r.get('/session', (req, res) => res.json({ ok: true }));

  // Step 1 of any upload: get a one-time URL to PUT the file to.
  r.post(
    '/uploads',
    ah(async (req, res) => {
      const kind = req.body?.kind;
      if (!['episode', 'short'].includes(kind)) throw httpError(400, 'kind must be "episode" or "short"');
      res.status(201).json(await store.createUpload({ kind }));
    })
  );

  r.get(
    '/videos/:id',
    ah(async (req, res) => {
      const v = await store.getVideo(req.params.id);
      if (!v) throw httpError(404, 'Video not found');
      res.json(v);
    })
  );

  r.get('/episodes', ah(async (req, res) => res.json(await engagement.withStats('episode', await store.hostEpisodes(baseUrl(req)), 'host'))));

  r.get(
    '/episodes/:id',
    ah(async (req, res) => {
      const ep = await store.getEpisode(req.params.id, baseUrl(req), { host: true });
      if (!ep) throw httpError(404, 'Episode not found');
      res.json(ep);
    })
  );

  r.post(
    '/episodes',
    ah(async (req, res) => {
      const b = req.body || {};
      const id = await store.createEpisode({
        title: str(b.title, 'title', { required: true, max: 200 }),
        description: str(b.description, 'description') ?? '',
        chapters: chapters(b.chapters) ?? [],
        tags: tags(b.tags) ?? [],
        videoId: str(b.videoId, 'videoId', { required: true }),
        thumbnailSec: num(b.thumbnailSec, 'thumbnailSec', { min: 0 }) ?? 0,
        createdBy: by(req),
      });
      res.status(201).json(await store.getEpisode(id, baseUrl(req), { host: true }));
    })
  );

  r.patch(
    '/episodes/:id',
    ah(async (req, res) => {
      const b = req.body || {};
      const found = await store.updateEpisode(req.params.id, {
        title: str(b.title, 'title', { max: 200 }),
        description: str(b.description, 'description'),
        chapters: chapters(b.chapters),
        tags: tags(b.tags),
        summary: b.summary === null ? null : str(b.summary, 'summary', { max: 800 }),
        mentions: mentions(b.mentions),
        speakers: speakers(b.speakers),
        thumbnailSec: num(b.thumbnailSec, 'thumbnailSec', { min: 0 }),
        // Shown to the uploader when a posted episode isn't approved.
        reviewNote: b.reviewNote === null ? null : str(b.reviewNote, 'reviewNote', { max: 500 }),
        status: status(b.status),
        publishAt: publishAt(b.publishAt, b.status),
      }, baseUrl(req));
      if (!found) throw httpError(404, 'Episode not found');
      // Approving or turning it down may be news for its author, or everyone.
      if (b.status && push) later(push.sweep());
      res.json(await store.getEpisode(req.params.id, baseUrl(req), { host: true }));
    })
  );

  // How far people got: of everyone who started the episode, the share who
  // reached each tenth of it.
  r.get(
    '/episodes/:id/reach',
    ah(async (req, res) => {
      const reach = await store.reach(req.params.id);
      if (!reach) throw httpError(404, 'Episode not found');
      res.json(reach);
    })
  );

  // (Re)make the transcript with the speech-to-text service.
  r.post(
    '/episodes/:id/transcribe',
    ah(async (req, res) => {
      await store.retranscribe(req.params.id, baseUrl(req));
      res.json(await store.getEpisode(req.params.id, baseUrl(req), { host: true }));
    })
  );

  // AI suggestions from the transcript (summary, chapters, tags, mentions, Shorts).
  r.post(
    '/episodes/:id/ai',
    ah(async (req, res) => {
      await store.generateInsights(req.params.id, baseUrl(req));
      res.json(await store.getEpisode(req.params.id, baseUrl(req), { host: true }));
    })
  );

  // Editing the episode's video on the website: the edit plan (cuts, texts,
  // layouts, zooms; see episode-edit.js), saved as it's edited and made into
  // the new video when the host asks.
  r.get('/episodes/:id/edit', ah(async (req, res) => res.json(await store.episodeEdit(req.params.id))));
  r.put('/episodes/:id/edit', ah(async (req, res) => res.json(await store.saveEpisodeEdit(req.params.id, req.body?.plan))));
  r.post('/episodes/:id/edit/make', ah(async (req, res) => res.status(202).json(await store.makeEpisodeEdit(req.params.id))));
  r.get('/episodes/:id/edit/pauses', ah(async (req, res) => res.json(await store.episodePauses(req.params.id))));

  r.get('/shorts', ah(async (req, res) => res.json(await engagement.withStats('short', await store.hostShorts(baseUrl(req)), 'host'))));

  // Comment review queue: reported comments, hidden until a host approves
  // (shows it again) or rejects them.
  r.get(
    '/comments',
    ah(async (req, res) => res.json(await engagement.hostComments(['approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending')))
  );

  r.patch(
    '/comments/:id',
    ah(async (req, res) => {
      await engagement.setCommentStatus(req.params.id, req.body?.status);
      res.status(204).end();
    })
  );

  // Either cut from an episode (episodeId + startSec/endSec) or an uploaded
  // video (videoId, optionally linked to an episode).
  r.post(
    '/shorts',
    ah(async (req, res) => {
      const b = req.body || {};
      const common = {
        title: str(b.title, 'title', { required: true, max: 200 }),
        focusX: num(b.focusX, 'focusX', { min: 0, max: 1 }) ?? 0.5,
        tags: tags(b.tags) ?? [],
        createdBy: by(req),
      };
      let id;
      if (b.videoId !== undefined) {
        id = await store.createShortFromUpload({
          ...common,
          videoId: str(b.videoId, 'videoId', { required: true }),
          episodeId: str(b.episodeId, 'episodeId') ?? null,
        });
      } else {
        id = await store.createShortFromEpisode(
          {
            ...common,
            episodeId: str(b.episodeId, 'episodeId', { required: true }),
            startSec: num(b.startSec, 'startSec', { required: true, min: 0 }),
            endSec: num(b.endSec, 'endSec', { required: true, min: 0 }),
          },
          baseUrl(req)
        );
      }
      const all = await store.hostShorts(baseUrl(req));
      res.status(201).json(all.find((s) => s.id === id));
    })
  );

  r.patch(
    '/shorts/:id',
    ah(async (req, res) => {
      const b = req.body || {};
      const found = await store.updateShort(req.params.id, {
        title: str(b.title, 'title', { max: 200 }),
        description: str(b.description, 'description', { max: 1000 }),
        focusX: num(b.focusX, 'focusX', { min: 0, max: 1 }),
        tags: tags(b.tags),
        coverSec: num(b.coverSec, 'coverSec', { min: 0 }),
        // Shown to the uploader when a posted Short isn't approved.
        reviewNote: b.reviewNote === null ? null : str(b.reviewNote, 'reviewNote', { max: 500 }),
        status: status(b.status),
        publishAt: publishAt(b.publishAt, b.status),
      });
      if (!found) throw httpError(404, 'Short not found');
      // Approving or turning it down is news for its author.
      if (b.status && push) later(push.sweep());
      const all = await store.hostShorts(baseUrl(req));
      res.json(all.find((s) => s.id === req.params.id));
    })
  );

  r.get('/shorts/:id/captions', ah(async (req, res) => res.json(await store.shortCaptions(req.params.id, { host: true }))));
  r.put('/shorts/:id/captions', ah(async (req, res) => res.json(await store.setShortCaptions(req.params.id, cues(req.body?.cues), { host: true }))));

  r.get('/limits', (req, res) => res.json({ maxShortSec: MAX_SHORT_SEC }));

  return r;
}

module.exports = { hostRouter, requireHost };
