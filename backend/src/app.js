const path = require('path');
const express = require('express');
const { authMiddleware } = require('./auth');
const { connect, migrate } = require('./db');
const { createEngagement } = require('./engagement');
const { hostRouter } = require('./host');
const { createStore } = require('./store');
const { muxVideo } = require('./video');

const MEDIA_DIR = path.join(__dirname, '..', 'public', 'media');

// Express 4 doesn't catch rejected promises from handlers.
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function createApp({ db = connect(), video = muxVideo(), tint, mediaDir = MEDIA_DIR, auth = authMiddleware(), hostPasscode } = {}) {
  const app = express();
  const store = createStore({ db, video, ...(tint && { tint }) });
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

  // In-memory listening positions, keyed by user then episode. Lets a listener
  // resume on another device; swap for a real store before production.
  const progress = new Map();

  const baseUrl = (req) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Landing page so the bare domain shows the service is up.
  app.get('/', (req, res) => {
    res.json({
      service: 'AI Dev Podcast backend',
      ok: true,
      endpoints: ['/api/episodes', '/api/episodes/:id', '/api/shorts', '/api/progress', '/api/items/*', '/api/host/*', '/media/*'],
    });
  });

  // Everything below requires a signed-in user, media included.
  app.use(auth);

  // express.static honours Range requests, which iOS/Android players need for seeking.
  app.use('/media', express.static(mediaDir, { fallthrough: false }));

  app.use('/api', ensureDb);
  app.use('/api/host', hostRouter({ store, engagement, baseUrl, passcode: hostPasscode }));
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
    '/api/shorts',
    ah(async (req, res) => res.json(await engagement.withStats('short', await store.listShorts(baseUrl(req)), req.user.id)))
  );

  app.get('/api/progress', (req, res) => {
    res.json(Object.fromEntries(progress.get(req.user.id) || []));
  });

  app.put(
    '/api/progress/:episodeId',
    ah(async (req, res) => {
      const durationSec = await store.episodeDuration(req.params.episodeId);
      if (durationSec == null) return res.status(404).json({ error: 'Episode not found' });
      const { positionSec } = req.body || {};
      if (typeof positionSec !== 'number' || positionSec < 0 || positionSec > durationSec) {
        return res.status(400).json({ error: `positionSec must be a number between 0 and ${durationSec}` });
      }
      if (!progress.has(req.user.id)) progress.set(req.user.id, new Map());
      const entry = { positionSec, updatedAt: new Date().toISOString() };
      progress.get(req.user.id).set(req.params.episodeId, entry);
      res.json(entry);
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
