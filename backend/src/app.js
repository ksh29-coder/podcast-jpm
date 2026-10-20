const path = require('path');
const express = require('express');
const { authMiddleware } = require('./auth');
const { connect, migrate } = require('./db');
const { createEngagement } = require('./engagement');
const { openRouterAi } = require('./ai');
const { openRouterTranscriber } = require('./transcribe');
const { hostRouter } = require('./host');
const { createStore } = require('./store');
const { muxVideo } = require('./video');

const MEDIA_DIR = path.join(__dirname, '..', 'public', 'media');

// Express 4 doesn't catch rejected promises from handlers.
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function createApp({ db = connect(), video = muxVideo(), ai = openRouterAi(), transcriber = openRouterTranscriber(), tint, mediaDir = MEDIA_DIR, auth = authMiddleware(), hostPasscode } = {}) {
  const app = express();
  const store = createStore({ db, video, ai, transcriber, ...(tint && { tint }) });
  const engagement = createEngagement({ db });

  // Tables are created (and seeded) on first use, so a fresh database needs no
  // separate setup step. Retried on the next request if it fails.
  let ready;
  const ensureDb = (req, res, next) => {
    ready ??= migrate(db).catch((e) => {
      ready = undefined;
      throw e;
    });
    ready.then(() => next(), next);
  };
  // Behind Vercel's (or any) proxy, so absolute URLs come out as https.
  app.set('trust proxy', true);
  app.use(express.json());

  // The web preview of the app runs on another origin. Native apps don't need CORS.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range, X-Host-Passcode, X-Device-Id');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const baseUrl = (req) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Landing page so the bare domain shows the service is up.
  app.get('/', (req, res) => {
    res.json({
      service: 'AI Dev Podcast backend',
      ok: true,
      endpoints: ['/api/episodes', '/api/episodes/:id', '/api/episodes/:id/transcript', '/api/search?q=', '/api/shorts', '/api/progress', '/api/items/*', '/api/host/*', '/media/*'],
    });
  });

  // Everything below requires a signed-in user, media included.
  app.use(auth);

  // express.static honours Range requests, which iOS/Android players need for seeking.
  app.use('/media', express.static(mediaDir, { fallthrough: false }));

  app.use('/api', ensureDb);
  app.use('/api/host', hostRouter({ store, engagement, baseUrl, passcode: hostPasscode, db }));
  app.use('/api/items', engagement.router());

  app.get(
    '/api/episodes',
    ah(async (req, res) => res.json(await engagement.withStats('episode', await store.listEpisodes(baseUrl(req)), req.user.id)))
  );

  app.get(
    '/api/episodes/:id',
    ah(async (req, res) => {
      const ep = await store.getEpisode(req.params.id, baseUrl(req));
      if (!ep) return res.status(404).json({ error: 'Episode not found' });
      res.json((await engagement.withStats('episode', [ep], req.user.id))[0]);
    })
  );

  app.get(
    '/api/episodes/:id/transcript',
    ah(async (req, res) => {
      const t = await store.transcript(req.params.id);
      if (!t) return res.status(404).json({ error: 'No transcript for this episode' });
      res.json(t);
    })
  );

  // Captions for a video, as WebVTT. The video service fetches this to show
  // our transcript as the player's subtitles.
  app.get(
    '/api/captions/:file',
    ah(async (req, res) => {
      const m = /^(vid_[0-9a-f]+)\.vtt$/.exec(req.params.file);
      const vtt = m && (await store.captionsVtt(m[1]));
      if (!vtt) return res.status(404).json({ error: 'No captions' });
      res.type('text/vtt').send(vtt);
    })
  );

  app.get(
    '/api/search',
    ah(async (req, res) => {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return res.json({ episodes: [], shorts: [], moments: [] });
      const results = await store.search(q.slice(0, 100), baseUrl(req));
      res.json({
        ...results,
        episodes: await engagement.withStats('episode', results.episodes, req.user.id),
        shorts: await engagement.withStats('short', results.shorts, req.user.id),
      });
    })
  );

  app.get(
    '/api/shorts',
    ah(async (req, res) => res.json(await engagement.withStats('short', await store.listShorts(baseUrl(req)), req.user.id)))
  );

  app.get(
    '/api/progress',
    ah(async (req, res) => {
      const { rows } = await db.query('select episode_id, position_sec, updated_at from progress where user_id = $1', [req.user.id]);
      res.json(Object.fromEntries(rows.map((r) => [r.episode_id, { positionSec: r.position_sec, updatedAt: new Date(r.updated_at).toISOString() }])));
    })
  );

  app.put(
    '/api/progress/:episodeId',
    ah(async (req, res) => {
      const durationSec = await store.episodeDuration(req.params.episodeId);
      if (durationSec == null) return res.status(404).json({ error: 'Episode not found' });
      const { positionSec } = req.body || {};
      if (typeof positionSec !== 'number' || positionSec < 0 || positionSec > durationSec) {
        return res.status(400).json({ error: `positionSec must be a number between 0 and ${durationSec}` });
      }
      const { rows } = await db.query(
        `insert into progress (user_id, episode_id, position_sec, max_sec) values ($1, $2, $3, $3)
         on conflict (user_id, episode_id) do update
           set position_sec = excluded.position_sec, max_sec = greatest(progress.max_sec, excluded.position_sec), updated_at = now()
         returning position_sec, updated_at`,
        [req.user.id, req.params.episodeId, positionSec]
      );
      res.json({ positionSec: rows[0].position_sec, updatedAt: new Date(rows[0].updated_at).toISOString() });
    })
  );

  app.use((err, req, res, next) => {
    if (err.expose) return res.status(err.status).json({ error: err.message });
    if (err.status === 404) return res.status(404).json({ error: 'Not found' });
    if (err.status === 502 || err.status === 503) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body must be valid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

module.exports = { createApp };
