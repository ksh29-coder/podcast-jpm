// The only file that talks to the video service. Everything else stores our
// own video ids and calls these functions, so moving to another platform
// (e.g. inside JPM) means rewriting this file and nothing else.
//
// Currently Mux: https://www.mux.com/docs/api-reference

const API = 'https://api.mux.com/video/v1';

function muxVideo({ tokenId = process.env.MUX_TOKEN_ID, tokenSecret = process.env.MUX_TOKEN_SECRET } = {}) {
  const auth = 'Basic ' + Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64');

  async function call(method, path, body) {
    if (!tokenId || !tokenSecret) throw Object.assign(new Error('Video service is not configured'), { status: 503 });
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = json.error?.messages?.join('; ') || `${method} ${path} failed: ${res.status}`;
      throw Object.assign(new Error(`Video service: ${message}`), { status: 502 });
    }
    return json.data;
  }

  return {
    name: 'mux',

    // A one-time URL the phone or browser PUTs the file to, so the file
    // never passes through our backend. `audio` also makes an audio-only file
    // for the episode's audio mode.
    async createUpload({ audio = false } = {}) {
      const data = await call('POST', '/uploads', {
        cors_origin: process.env.UPLOAD_CORS_ORIGIN || '*',
        new_asset_settings: {
          playback_policies: ['public'],
          video_quality: 'basic',
          // Speech-to-text captions; they double as the transcript.
          inputs: [{ generated_subtitles: [{ language_code: 'en', name: 'English (generated)' }] }],
          ...(audio && { static_renditions: [{ resolution: 'audio-only' }] }),
        },
      });
      return { uploadId: data.id, uploadUrl: data.url };
    },

    // Where an upload has got to. assetId appears once the file is in.
    async getUpload(uploadId) {
      const data = await call('GET', `/uploads/${uploadId}`);
      const failed = ['errored', 'cancelled', 'timed_out'].includes(data.status);
      return { assetId: data.asset_id || null, failed, error: failed ? `Upload ${data.status}` : null };
    },

    // A new video cut from an existing one (ours) or from a public URL
    // (the seeded episodes' static MP4s).
    async createClip({ assetId, sourceUrl, startSec, endSec }) {
      const data = await call('POST', '/assets', {
        inputs: [{ url: assetId ? `mux://assets/${assetId}` : sourceUrl, start_time: startSec, end_time: endSec }],
        playback_policies: ['public'],
        video_quality: 'basic',
      });
      return { assetId: data.id };
    },

    async getAsset(assetId) {
      const data = await call('GET', `/assets/${assetId}`);
      const status = data.status === 'ready' ? 'ready' : data.status === 'errored' ? 'errored' : 'processing';
      const audio = (data.static_renditions?.files || []).find((f) => f.resolution === 'audio-only');
      const text = (data.tracks || []).find((t) => t.type === 'text' && t.text_source === 'generated_vod');
      return {
        status,
        playbackId: data.playback_ids?.find((p) => p.policy === 'public')?.id || null,
        durationSec: data.duration ?? null,
        aspectRatio: data.aspect_ratio || null,
        audioReady: audio?.status === 'ready',
        // Mux skips the audio-only file when the video has no sound.
        audioMissing: audio?.status === 'skipped' || audio?.status === 'errored',
        error: status === 'errored' ? data.errors?.messages?.join('; ') || 'Processing failed' : null,
        // Generated captions: { id, status: 'preparing' | 'ready' | 'errored' } or null.
        textTrack: text ? { id: text.id, status: text.status } : null,
        hasAudioTrack: (data.tracks || []).some((t) => t.type === 'audio'),
      };
    },

    // Ask for captions on a video uploaded before captions were switched on.
    async generateSubtitles(assetId) {
      const asset = await call('GET', `/assets/${assetId}`);
      const audio = (asset.tracks || []).find((t) => t.type === 'audio' && t.primary !== false);
      if (!audio) return false;
      await call('POST', `/assets/${assetId}/tracks/${audio.id}/generate-subtitles`, {
        generated_subtitles: [{ language_code: 'en', name: 'English (generated)' }],
      });
      return true;
    },

    // Replace the generated (Whisper) captions with our own transcript, which
    // Mux fetches from `url`. Video players then offer the better captions.
    async replaceCaptions(assetId, url) {
      await call('POST', `/assets/${assetId}/tracks`, {
        url,
        type: 'text',
        text_type: 'subtitles',
        language_code: 'en',
        name: 'English',
        closed_captions: false,
      });
      const asset = await call('GET', `/assets/${assetId}`);
      for (const t of asset.tracks || []) {
        if (t.type === 'text' && t.text_source === 'generated_vod') await call('DELETE', `/assets/${assetId}/tracks/${t.id}`).catch(() => {});
      }
    },

    // The captions as WebVTT text.
    async fetchCaptions(playbackId, trackId) {
      const res = await fetch(`https://stream.mux.com/${playbackId}/text/${trackId}.vtt`);
      if (!res.ok) throw Object.assign(new Error(`Captions download failed: ${res.status}`), { status: 502 });
      return res.text();
    },

    hlsUrl: (playbackId) => `https://stream.mux.com/${playbackId}.m3u8`,
    audioUrl: (playbackId) => `https://stream.mux.com/${playbackId}/audio.m4a`,
    thumbnailUrl: (playbackId, timeSec = 0) =>
      `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${timeSec}&width=800&height=800&fit_mode=smartcrop`,
  };
}

module.exports = { muxVideo };
