// The only file that talks to the video service. Everything else stores our
// own video ids and calls these functions, so moving to another platform
// (e.g. inside JPM) means rewriting this file and nothing else.
//
// Currently Mux: https://www.mux.com/docs/api-reference
//
// Private playback (MUX_SIGNED=true): new videos get a signed playback id and
// every link carries a short-lived token, so a copied link stops working.
// Needs a signing key (MUX_SIGNING_KEY_ID, and MUX_SIGNING_KEY as Mux gives it:
// base64 of the PEM). Videos made before switching on stay public. Mux rejects
// a token on a public id, so signed ids are stored as "s:<id>" to tell them apart.
// https://www.mux.com/docs/guides/secure-video-playback

const crypto = require('crypto');

const API = 'https://api.mux.com/video/v1';
const SIGNED = 's:';
// Links in API responses stay valid this long; apps refetch well within it.
const TOKEN_HOURS = 12;

function muxVideo({
  tokenId = process.env.MUX_TOKEN_ID,
  tokenSecret = process.env.MUX_TOKEN_SECRET,
  signed = process.env.MUX_SIGNED === 'true',
  signingKeyId = process.env.MUX_SIGNING_KEY_ID,
  signingKey = process.env.MUX_SIGNING_KEY,
  now = Date.now,
} = {}) {
  const auth = 'Basic ' + Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64');
  if (signed && !(signingKeyId && signingKey)) throw new Error('MUX_SIGNED needs MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY');
  const privateKey = signingKey ? crypto.createPrivateKey(Buffer.from(signingKey, 'base64').toString('utf8')) : null;
  const policy = signed ? 'signed' : 'public';

  // RS256 JWT. aud: v = video, audio and captions; t = thumbnail.
  function token(id, aud, claims) {
    if (!privateKey) throw Object.assign(new Error('This video is private but no signing key is configured'), { status: 503 });
    const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const body = `${part({ alg: 'RS256', typ: 'JWT', kid: signingKeyId })}.${part({ sub: id, aud, exp: Math.floor(now() / 1000) + TOKEN_HOURS * 3600, ...claims })}`;
    return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
  }

  // A link to a playback id's file. Signed ids put the options in the token,
  // since Mux allows nothing else in the query string.
  function link(ref, base, path, aud, options) {
    if (ref.startsWith(SIGNED)) {
      const id = ref.slice(SIGNED.length);
      return `${base}/${id}${path}?token=${token(id, aud, options)}`;
    }
    return `${base}/${ref}${path}${options ? `?${new URLSearchParams(options)}` : ''}`;
  }

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
    // for the episode's audio mode. Without `captions` (for a video that will
    // be cut, since the cut gets its own) no captions are made.
    async createUpload({ audio = false, captions = true } = {}) {
      const data = await call('POST', '/uploads', {
        cors_origin: process.env.UPLOAD_CORS_ORIGIN || '*',
        new_asset_settings: {
          playback_policies: [policy],
          video_quality: 'basic',
          // Speech-to-text captions; they double as the transcript.
          ...(captions && { inputs: [{ generated_subtitles: [{ language_code: 'en', name: 'English (generated)' }] }] }),
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
    // (the seeded episodes' static MP4s). `captions` asks for speech-to-text
    // captions on the new video, as uploads get.
    async createClip({ assetId, sourceUrl, startSec, endSec, captions = false }) {
      const data = await call('POST', '/assets', {
        inputs: [
          {
            url: assetId ? `mux://assets/${assetId}` : sourceUrl,
            start_time: startSec,
            end_time: endSec,
            ...(captions && { generated_subtitles: [{ language_code: 'en', name: 'English (generated)' }] }),
          },
        ],
        playback_policies: [policy],
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
        playbackId: playbackRef(data.playback_ids),
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

    // Gone for good, with its files and links.
    async deleteAsset(assetId) {
      await call('DELETE', `/assets/${assetId}`);
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
      const res = await fetch(link(playbackId, 'https://stream.mux.com', `/text/${trackId}.vtt`, 'v'));
      if (!res.ok) throw Object.assign(new Error(`Captions download failed: ${res.status}`), { status: 502 });
      return res.text();
    },

    hlsUrl: (playbackId) => link(playbackId, 'https://stream.mux.com', '.m3u8', 'v'),
    audioUrl: (playbackId) => link(playbackId, 'https://stream.mux.com', '/audio.m4a', 'v'),
    thumbnailUrl: (playbackId, timeSec = 0, size = 800) =>
      link(playbackId, 'https://image.mux.com', '/thumbnail.jpg', 't', { time: timeSec, width: size, height: size, fit_mode: 'smartcrop' }),
  };
}

// Our reference for an asset's playback id: a signed one if it has one.
function playbackRef(ids = []) {
  const signedId = ids.find((p) => p.policy === 'signed')?.id;
  return signedId ? SIGNED + signedId : ids.find((p) => p.policy === 'public')?.id || null;
}

module.exports = { muxVideo };
