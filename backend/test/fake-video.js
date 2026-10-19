// Stands in for the video service (src/video.js) in tests. Uploads finish and
// process instantly unless a test says otherwise via `state`.
function fakeVideo() {
  let n = 0;
  const assets = new Map();
  const uploads = new Map();
  const state = { calls: [], uploadDone: true, durationSec: 600, audioLate: false, silent: false };

  const addAsset = (durationSec) => {
    const id = `asset${++n}`;
    assets.set(id, { status: 'ready', playbackId: `play-${id}`, durationSec, aspectRatio: '16:9', audioReady: true, error: null });
    return id;
  };

  return {
    name: 'fake',
    state,
    assets,
    async createUpload(opts) {
      state.calls.push(['createUpload', opts]);
      const uploadId = `up${++n}`;
      uploads.set(uploadId, null);
      return { uploadId, uploadUrl: `https://upload.test/${uploadId}` };
    },
    async getUpload(uploadId) {
      if (!state.uploadDone) return { assetId: null, failed: false, error: null };
      if (!uploads.get(uploadId)) uploads.set(uploadId, addAsset(state.durationSec));
      return { assetId: uploads.get(uploadId), failed: false, error: null };
    },
    async createClip(opts) {
      state.calls.push(['createClip', opts]);
      return { assetId: addAsset(opts.endSec - opts.startSec) };
    },
    async getAsset(assetId) {
      const a = assets.get(assetId);
      // Like the real service, the audio file can finish after the video.
      if (state.audioLate) return { ...a, audioReady: false };
      if (state.silent) return { ...a, audioReady: false, audioMissing: true };
      return a;
    },
    hlsUrl: (p) => `https://stream.test/${p}.m3u8`,
    audioUrl: (p) => `https://stream.test/${p}/audio.m4a`,
    thumbnailUrl: (p, t = 0) => `https://image.test/${p}.jpg?time=${t}`,
  };
}

module.exports = { fakeVideo };
