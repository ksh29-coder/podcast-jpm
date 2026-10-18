const path = require('path');
const express = require('express');
const { loadCatalogue, withAbsoluteUrls, shortsFeed } = require('./catalogue');
const { authMiddleware } = require('./auth');

const MEDIA_DIR = path.join(__dirname, '..', 'media');

function createApp({ episodes = loadCatalogue(), mediaDir = MEDIA_DIR, auth = authMiddleware() } = {}) {
  const app = express();
  app.use(express.json());

  // In-memory listening positions, keyed by user then episode. Lets a listener
  // resume on another device; swap for a real store before production.
  const progress = new Map();

  const baseUrl = (req) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Everything below requires a signed-in user, media included.
  app.use(auth);

  // express.static honours Range requests, which iOS/Android players need for seeking.
  app.use('/media', express.static(mediaDir, { fallthrough: false }));

  app.get('/api/episodes', (req, res) => {
    res.json(episodes.map((ep) => withAbsoluteUrls(ep, baseUrl(req))));
  });

  app.get('/api/episodes/:id', (req, res) => {
    const ep = episodes.find((e) => e.id === req.params.id);
    if (!ep) return res.status(404).json({ error: 'Episode not found' });
    res.json(withAbsoluteUrls(ep, baseUrl(req)));
  });

  app.get('/api/shorts', (req, res) => {
    res.json(shortsFeed(episodes, baseUrl(req)));
  });

  app.get('/api/progress', (req, res) => {
    res.json(Object.fromEntries(progress.get(req.user.id) || []));
  });

  app.put('/api/progress/:episodeId', (req, res) => {
    const ep = episodes.find((e) => e.id === req.params.episodeId);
    if (!ep) return res.status(404).json({ error: 'Episode not found' });
    const { positionSec } = req.body || {};
    if (typeof positionSec !== 'number' || positionSec < 0 || positionSec > ep.durationSec) {
      return res.status(400).json({ error: `positionSec must be a number between 0 and ${ep.durationSec}` });
    }
    if (!progress.has(req.user.id)) progress.set(req.user.id, new Map());
    const entry = { positionSec, updatedAt: new Date().toISOString() };
    progress.get(req.user.id).set(ep.id, entry);
    res.json(entry);
  });

  app.use((err, req, res, next) => {
    if (err.status === 404) return res.status(404).json({ error: 'Not found' });
    next(err);
  });

  return app;
}

module.exports = { createApp };
