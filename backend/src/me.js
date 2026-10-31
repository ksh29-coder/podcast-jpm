const express = require('express');
const { httpError } = require('./store');
const { cues, num, pictures, str, tags } = require('./validate');

// Posting Shorts (phone or website) and episodes (website), open to
// everyone: a name and the guidelines first, then upload (a Short can keep
// only part of the video), details with the AI's suggestions, and the
// person's own posts with their status. Everything posted waits for a host
// to approve it.
//
// "Me" is req.user: a device until sign-in exists.

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function meRouter({ store, engagement, activity, push, baseUrl }) {
  const r = express.Router();

  // Without a device id everyone would share one "me".
  r.use((req, res, next) => (req.user.id === 'dev-user' ? next(httpError(400, 'This app version can’t post Shorts yet')) : next()));

  r.get('/', ah(async (req, res) => res.json(await store.profile(req.user.id))));

  // Activity: what happened around this person's comments and posts.
  r.get('/activity', ah(async (req, res) => res.json(await activity.list(req.user.id))));
  // Phone alerts: this phone's Expo push token, and which kinds to send.
  r.put(
    '/push/token',
    ah(async (req, res) => {
      if (!(await push.register(req.user.id, req.body?.token))) throw httpError(400, 'token must be an Expo push token');
      res.status(204).end();
    })
  );
  r.delete(
    '/push/token',
    ah(async (req, res) => {
      await push.unregister(req.user.id, String(req.body?.token ?? ''));
      res.status(204).end();
    })
  );
  r.get('/push/settings', ah(async (req, res) => res.json(await push.settings(req.user.id))));
  r.put(
    '/push/settings',
    ah(async (req, res) => {
      const b = req.body || {};
      const changes = {};
      for (const k of push.KINDS) {
        if (b[k] === undefined) continue;
        if (typeof b[k] !== 'boolean') throw httpError(400, `${k} must be true or false`);
        changes[k] = b[k];
      }
      res.json(await push.saveSettings(req.user.id, changes));
    })
  );

  r.post(
    '/activity/seen',
    ah(async (req, res) => {
      await activity.markSeen(req.user.id);
      res.status(204).end();
    })
  );

  r.put(
    '/',
    ah(async (req, res) => {
      const b = req.body || {};
      const name = str(b.name, 'name', { required: true, max: 50 });
      if (b.acceptGuidelines !== undefined && typeof b.acceptGuidelines !== 'boolean') throw httpError(400, 'acceptGuidelines must be true or false');
      res.json(await store.saveProfile(req.user.id, { name, acceptGuidelines: b.acceptGuidelines }));
    })
  );

  // kind "short" (the default): up to 10 minutes of video, of which at most a
  // Short's length is kept. kind "episode": a long video, kept whole.
  r.post(
    '/uploads',
    ah(async (req, res) => {
      const b = req.body || {};
      const kind = b.kind ?? 'short';
      if (!['short', 'episode'].includes(kind)) throw httpError(400, 'kind must be "short" or "episode"');
      if (kind === 'episode' && (b.startSec !== undefined || b.endSec !== undefined)) throw httpError(400, 'Episodes are kept whole');
      const startSec = num(b.startSec, 'startSec', { min: 0, max: 600 });
      const endSec = num(b.endSec, 'endSec', { min: 0, max: 600 });
      if ((startSec === undefined) !== (endSec === undefined)) throw httpError(400, 'Send both startSec and endSec, or neither');
      if (endSec !== undefined) {
        const { maxShortSec } = await store.profile(req.user.id);
        if (endSec - startSec < 1) throw httpError(400, 'Keep at least a second');
        if (endSec - startSec > maxShortSec + 0.5) throw httpError(400, `A Short can be at most ${maxShortSec} seconds`);
      }
      res.status(201).json(await store.createUserUpload(req.user.id, { kind, startSec, endSec }));
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
      const id = await store.createUserShort(req.user.id, {
        ...d,
        videoId: str(b.videoId, 'videoId', { required: true }),
        pictures: b.pictures === undefined ? [] : pictures(b.pictures),
      });
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

  // Pictures added to a Short. The file goes up in pieces of up to 4 MB (the
  // most a request can carry), then is checked; the list of pictures, with
  // where and when each shows, comes with the Short or changes in review.
  r.post('/pictures', ah(async (req, res) => res.status(201).json(await store.createPicture(req.user.id))));
  r.put(
    '/pictures/:id',
    express.raw({ type: () => true, limit: '4mb' }),
    ah(async (req, res) => {
      const offset = Number(req.query.offset);
      if (!Number.isInteger(offset) || offset < 0) throw httpError(400, 'offset must be a whole number');
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, 'Send the picture’s bytes');
      res.json(await store.addPictureData(req.user.id, req.params.id, offset, req.body));
    })
  );
  r.post('/pictures/:id/done', ah(async (req, res) => res.json(await store.finishPicture(req.user.id, req.params.id, baseUrl(req)))));
  r.get('/shorts/:id/pictures', ah(async (req, res) => res.json(await store.myShortPictures(req.user.id, req.params.id, baseUrl(req)))));
  r.put(
    '/shorts/:id/pictures',
    ah(async (req, res) => res.json(await store.setMyShortPictures(req.user.id, req.params.id, pictures(req.body?.pictures), baseUrl(req))))
  );

  // Captions: checked and fixed before posting (by upload) or while in review (by Short).
  r.get('/uploads/:videoId/captions', ah(async (req, res) => res.json(await store.uploadCaptions(req.user.id, req.params.videoId))));
  r.put(
    '/uploads/:videoId/captions',
    ah(async (req, res) => res.json(await store.setUploadCaptions(req.user.id, req.params.videoId, cues(req.body?.cues))))
  );
  r.get('/shorts/:id/captions', ah(async (req, res) => res.json(await store.shortCaptions(req.params.id, { userId: req.user.id }))));
  r.put(
    '/shorts/:id/captions',
    ah(async (req, res) => res.json(await store.setShortCaptions(req.params.id, cues(req.body?.cues), { userId: req.user.id })))
  );

  // The AI's fixes for misheard words, for whoever is editing captions (hosts too).
  r.post(
    '/captions/tidy',
    ah(async (req, res) => {
      const b = req.body || {};
      const lines = cues(b.cues);
      if (lines.length > 300) throw httpError(400, 'Too many lines to tidy at once');
      res.json(
        await store.tidyCaptions({
          cues: lines,
          title: str(b.title, 'title', { max: 200 }),
          description: str(b.description, 'description', { max: 1000 }),
          tags: tags(b.tags),
        })
      );
    })
  );

  // Episodes: the same, without trimming. The cover is a time in the video.
  const episodeDetails = (b) => {
    const { coverSec, ...rest } = details(b);
    return { ...rest, thumbnailSec: coverSec };
  };
  const mineEpisode = async (req, id) =>
    (await engagement.withStats('episode', await store.myEpisodes(req.user.id, baseUrl(req)), req.user.id)).find((e) => e.id === id);

  r.get('/episodes', ah(async (req, res) => res.json(await engagement.withStats('episode', await store.myEpisodes(req.user.id, baseUrl(req)), req.user.id))));

  r.post(
    '/episodes',
    ah(async (req, res) => {
      const b = req.body || {};
      const d = episodeDetails(b);
      if (!d.title) throw httpError(400, 'title is required');
      const id = await store.createUserEpisode(req.user.id, { ...d, videoId: str(b.videoId, 'videoId', { required: true }) });
      res.status(201).json(await mineEpisode(req, id));
    })
  );

  r.patch(
    '/episodes/:id',
    ah(async (req, res) => {
      const d = episodeDetails(req.body || {});
      if (d.title === '') throw httpError(400, 'title is required');
      await store.updateMyEpisode(req.user.id, req.params.id, d);
      res.json(await mineEpisode(req, req.params.id));
    })
  );

  r.delete(
    '/episodes/:id',
    ah(async (req, res) => {
      await store.deleteMyEpisode(req.user.id, req.params.id);
      res.status(204).end();
    })
  );

  return r;
}

module.exports = { meRouter };
