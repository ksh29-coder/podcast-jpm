// Stands in for the video service (src/video.js) in tests. Uploads finish and
// process instantly unless a test says otherwise via `state`.
function fakeVideo() {
  let n = 0;
  const assets = new Map();
  const uploads = new Map();
  const state = { calls: [], uploadDone: true, durationSec: 600, audioLate: false, silent: false, captions: 'ready' };

  const addAsset = (durationSec) => {
    const id = `asset${++n}`;
    assets.set(id, { status: 'ready', playbackId: `play-${id}`, durationSec, aspectRatio: '16:9', audioReady: true, error: null, captionsRequested: false });
    return id;
  };

  return {
    name: 'fake',
    state,
    assets,
    async createUpload(opts) {
      state.calls.push(['createUpload', opts]);
      const uploadId = `up${++n}`;
      state.captionsOnUpload = true;
      uploads.set(uploadId, null);
      return { uploadId, uploadUrl: `https://upload.test/${uploadId}` };
    },
    async getUpload(uploadId) {
      if (!state.uploadDone) return { assetId: null, failed: false, error: null };
      if (!uploads.get(uploadId)) {
        uploads.set(uploadId, addAsset(state.durationSec));
        assets.get(uploads.get(uploadId)).captionsRequested = true;
      }
      return { assetId: uploads.get(uploadId), failed: false, error: null };
    },
    async createClip(opts) {
      state.calls.push(['createClip', opts]);
      const assetId = addAsset(opts.endSec - opts.startSec);
      assets.get(assetId).captionsRequested = !!opts.captions;
      return { assetId };
    },
    async deleteAsset(assetId) {
      state.calls.push(['deleteAsset', assetId]);
      assets.delete(assetId);
    },
    async getAsset(assetId) {
      const stored = assets.get(assetId);
      // Captions exist once requested (uploads request them up front); state.captions says how far along.
      const a = { ...stored, hasAudioTrack: !state.silent, textTrack: stored.captionsRequested ? { id: 'txt1', status: state.captions } : null };
      // Like the real service, the audio file can finish after the video.
      if (state.audioLate) return { ...a, audioReady: false };
      if (state.silent) return { ...a, audioReady: false, audioMissing: true };
      return a;
    },
    async generateSubtitles(assetId) {
      state.calls.push(['generateSubtitles', assetId]);
      assets.get(assetId).captionsRequested = true;
      return true;
    },
    async fetchCaptions() {
      return 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nWelcome to the AI Dev Podcast\n\n00:00:04.000 --> 00:00:09.500\nToday we talk about Kubernetes operators\n';
    },
    hlsUrl: (p) => `https://stream.test/${p}.m3u8`,
    audioUrl: (p) => `https://stream.test/${p}/audio.m4a`,
    thumbnailUrl: (p, t = 0, size = 800) => `https://image.test/${p}.jpg?time=${t}${size === 800 ? '' : `&size=${size}`}`,
  };
}

module.exports = { fakeVideo };
