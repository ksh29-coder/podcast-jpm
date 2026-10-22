const express = require('express');
const { httpError } = require('./store');
const { num, str, tags } = require('./validate');

// Posting Shorts from the app, open to everyone: a name and the guidelines
// first, then upload (optionally keeping only part of the video), details
// with the AI's suggestions, and the person's own Shorts with their status.
// Everything posted waits for a host to approve it.
//
// "Me" is req.user: a device until sign-in exists.

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function meRouter({ store, engagement, baseUrl }) {
  const r = express.Router();

  // Without a device id everyone would share one "me".
  r.use((req, res, next) => (req.user.id === 'dev-user' ? next(httpError(400, 'This app version can’t post Shorts yet')) : next()));

  r.get('/', ah(async (req, res) => res.json(await store.profile(req.user.id))));

  r.put(
    '/',
    ah(async (req, res) => {
      const b = req.body || {};
      const name = str(b.name, 'name', { required: true, max: 50 });
      if (b.acceptGuidelines !== undefined && typeof b.acceptGuidelines !== 'boolean') throw httpError(400, 'acceptGuidelines must be true or false');
      res.json(await store.saveProfile(req.user.id, { name, acceptGuidelines: b.acceptGuidelines }));
    })
  );

  // Up to 10 minutes of video, of which at most a Short's length is kept.
  r.post(
    '/uploads',
    ah(async (req, res) => {
      const b = req.body || {};
      const startSec = num(b.startSec, 'startSec', { min: 0, max: 600 });
      const endSec = num(b.endSec, 'endSec', { min: 0, max: 600 });
      if ((startSec === undefined) !== (endSec === undefined)) throw httpError(400, 'Send both startSec and endSec, or neither');
      if (endSec !== undefined) {
        const { maxShortSec } = await store.profile(req.user.id);
        if (endSec - startSec < 1) throw httpError(400, 'Keep at least a second');
        if (endSec - startSec > maxShortSec + 0.5) throw httpError(400, `A Short can be at most ${maxShortSec} seconds`);
      }
      res.status(201).json(await store.createUserUpload(req.user.id, { startSec, endSec }));
    })
  );

  r.get('/uploads/:videoId', ah(async (req, res) => res.json(await store.uploadState(req.user.id, req.params.videoId))));

  r.delete(
    '/uploads/:videoId',
    ah(async (req, res) => {
      await store.deleteUserUpload(req.user.id, req.params.videoId);
      res.status(204).end();
    })
  );

  const details = (b) => ({
    title: str(b.title, 'title', { max: 100 }),
    description: str(b.description, 'description', { max: 1000 }),
    tags: tags(b.tags),
    coverSec: num(b.coverSec, 'coverSec', { min: 0 }),
  });
  const mine = async (req, id) => (await engagement.withStats('short', await store.myShorts(req.user.id, baseUrl(req)), req.user.id)).find((s) => s.id === id);

  r.get('/shorts', ah(async (req, res) => res.json(await engagement.withStats('short', await store.myShorts(req.user.id, baseUrl(req)), req.user.id))));

  r.post(
    '/shorts',
    ah(async (req, res) => {
      const b = req.body || {};
      const d = details(b);
      if (!d.title) throw httpError(400, 'title is required');
      const id = await store.createUserShort(req.user.id, { ...d, videoId: str(b.videoId, 'videoId', { required: true }) });
      res.status(201).json(await mine(req, id));
    })
  );

  r.patch(
    '/shorts/:id',
    ah(async (req, res) => {
      const d = details(req.body || {});
      if (d.title === '') throw httpError(400, 'title is required');
      await store.updateMyShort(req.user.id, req.params.id, d);
      res.json(await mine(req, req.params.id));
    })
  );

  r.delete(
    '/shorts/:id',
    ah(async (req, res) => {
      await store.deleteMyShort(req.user.id, req.params.id);
      res.status(204).end();
    })
  );

  return r;
}

module.exports = { meRouter };
