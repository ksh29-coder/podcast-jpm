const crypto = require('crypto');
const { tintFromUrl } = require('./tint');

// Database access and the JSON shapes the app sees. Media is either a static
// file under /media (the seeded episodes) or a video on the video service.

const MAX_SHORT_SEC = 90;

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

// Static media is stored as server-relative paths; clients need absolute URLs.
function absolutize(url, baseUrl) {
  return url && url.startsWith('/') ? baseUrl + url : url;
}

const EPISODE_SELECT = `
  select e.*, v.playback_id, v.status as video_status, v.audio_ready, v.has_audio,
         v.duration_sec as video_duration_sec, v.error as video_error
  from episodes e left join videos v on v.id = e.video_id`;

const SHORT_SELECT = `
  select s.*, v.playback_id, v.status as video_status, v.duration_sec as video_duration_sec,
         v.aspect_ratio, v.error as video_error,
         e.title as episode_title, e.artwork_url as episode_artwork_url,
         ev.playback_id as episode_playback_id, e.thumbnail_sec as episode_thumbnail_sec
  from shorts s
  left join videos v on v.id = s.video_id
  left join episodes e on e.id = s.episode_id
  left join videos ev on ev.id = e.video_id`;

function createStore({ db, video, tint = tintFromUrl }) {
  function episodeArtwork(row, baseUrl) {
    return row.playback_id ? video.thumbnailUrl(row.playback_id, row.thumbnail_sec) : absolutize(row.artwork_url, baseUrl);
  }

  function toShort(row, baseUrl) {
    const artworkUrl = row.episode_playback_id
      ? video.thumbnailUrl(row.episode_playback_id, row.episode_thumbnail_sec)
      : row.episode_artwork_url
        ? absolutize(row.episode_artwork_url, baseUrl)
        : row.playback_id && video.thumbnailUrl(row.playback_id, 0);
    return {
      id: row.id,
      title: row.title,
      startSec: row.start_sec,
      endSec: row.end_sec,
      videoUrl: row.playback_id ? video.hlsUrl(row.playback_id) : absolutize(row.video_url, baseUrl),
      focusX: row.focus_x,
      tags: row.tags || [],
      // "16:9" etc. when known, so the feed can crop wide videos around focusX.
      aspectRatio: row.aspect_ratio || null,
      episodeId: row.episode_id,
      episodeTitle: row.episode_title,
      artworkUrl: artworkUrl || null,
    };
  }

  function toEpisode(row, shorts, baseUrl) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      publishedAt: row.published_at && new Date(row.published_at).toISOString(),
      durationSec: row.video_duration_sec ?? row.duration_sec ?? 0,
      artworkUrl: episodeArtwork(row, baseUrl),
      // null for a video-only episode (its video has no sound).
      audioUrl: row.playback_id ? (row.has_audio === false ? null : video.audioUrl(row.playback_id)) : absolutize(row.audio_url, baseUrl),
      videoUrl: row.playback_id ? video.hlsUrl(row.playback_id) : absolutize(row.video_url, baseUrl),
      chapters: row.chapters,
      tags: row.tags || [],
      tint: row.tint || null,
      clips: shorts.map((s) => toShort(s, baseUrl)),
    };
  }

  // What hosts see: the public shape plus status and processing state.
  function withHostFields(out, row) {
    return {
      ...out,
      status: row.status,
      video: row.video_id
        ? {
            id: row.video_id,
            status: row.video_status,
            error: row.video_error,
            ...(row.audio_ready !== undefined && { audioReady: row.audio_ready, hasAudio: row.has_audio }),
          }
        : null,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  // Work out (once) the backdrop color for episodes that don't have one yet.
  async function fillTints(rows, baseUrl) {
    const missing = rows.filter((r) => !r.tint);
    await Promise.all(
      missing.map(async (r) => {
        const src = r.playback_id ? `https://image.mux.com/${r.playback_id}/thumbnail.jpg?time=${r.thumbnail_sec}&width=32&height=32` : absolutize(r.artwork_url, baseUrl);
        const color = src && (await tint(src));
        if (!color) return;
        r.tint = color;
        await db.query('update episodes set tint = $2 where id = $1', [r.id, color]);
      })
    );
    return rows;
  }

  async function shortsFor(episodeIds, { publishedOnly }) {
    if (!episodeIds.length) return new Map();
    const { rows } = await db.query(
      `${SHORT_SELECT} where s.episode_id = any($1) ${publishedOnly ? "and s.status = 'published'" : ''}
       order by s.start_sec nulls last, s.created_at`,
      [episodeIds]
    );
    const byEpisode = new Map();
    for (const r of rows) {
      if (!byEpisode.has(r.episode_id)) byEpisode.set(r.episode_id, []);
      byEpisode.get(r.episode_id).push(r);
    }
    return byEpisode;
  }

  // Ask the video service how unfinished videos are getting on, and save it.
  async function syncVideo(row) {
    if (row.status === 'errored' || (row.status === 'ready' && (row.audio_ready || !row.wants_audio || row.has_audio === false))) return;
    const patch = {};
    let assetId = row.asset_id;
    if (!assetId) {
      const up = await video.getUpload(row.upload_id);
      if (up.failed) patch.status = 'errored';
      if (up.error) patch.error = up.error;
      if (up.assetId) {
        assetId = patch.asset_id = up.assetId;
        patch.status = 'processing';
      }
    }
    if (assetId) {
      const a = await video.getAsset(assetId);
      Object.assign(patch, {
        status: a.status,
        playback_id: a.playbackId,
        duration_sec: a.durationSec,
        aspect_ratio: a.aspectRatio,
        audio_ready: a.audioReady,
        error: a.error,
      });
      // A video with no sound gets no audio file; the episode is video-only.
      if (a.audioReady) patch.has_audio = true;
      if (a.audioMissing) patch.has_audio = false;
    }
    const keys = Object.keys(patch);
    if (!keys.length) return;
    await db.query(
      `update videos set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`,
      [row.id, ...keys.map((k) => patch[k])]
    );
  }

  async function syncVideos(ids) {
    const { rows } = await db.query(
      'select * from videos where id = any($1)',
      [ids.filter(Boolean)]
    );
    // One slow or failing check shouldn't hide the rest.
    await Promise.all(rows.map((r) => syncVideo(r).catch((e) => console.warn('video sync', r.id, e.message))));
  }

  const PUBLISHED = "status = 'published'";

  return {
    async listEpisodes(baseUrl) {
      const { rows } = await db.query(`${EPISODE_SELECT} where e.${PUBLISHED} order by e.published_at desc`);
      await fillTints(rows, baseUrl);
      const shorts = await shortsFor(rows.map((r) => r.id), { publishedOnly: true });
      return rows.map((r) => toEpisode(r, shorts.get(r.id) || [], baseUrl));
    },

    async getEpisode(id, baseUrl, { host = false } = {}) {
      const { rows } = await db.query(`${EPISODE_SELECT} where e.id = $1 ${host ? '' : `and e.${PUBLISHED}`}`, [id]);
      if (!rows[0]) return null;
      await fillTints(rows, baseUrl);
      const shorts = await shortsFor([id], { publishedOnly: !host });
      const out = toEpisode(rows[0], shorts.get(id) || [], baseUrl);
      if (!host) return out;
      return withHostFields(
        { ...out, thumbnailSec: rows[0].thumbnail_sec, clips: (shorts.get(id) || []).map((s) => withHostFields(toShort(s, baseUrl), s)) },
        rows[0]
      );
    },

    async listShorts(baseUrl) {
      const { rows } = await db.query(`${SHORT_SELECT} where s.${PUBLISHED} order by s.published_at desc, s.start_sec`);
      return rows.map((r) => toShort(r, baseUrl));
    },

    async episodeDuration(id) {
      const ep = await this.getEpisode(id, '');
      return ep && ep.durationSec;
    },

    // ---- Host side ----

    async hostEpisodes(baseUrl) {
      let { rows } = await db.query(`${EPISODE_SELECT} order by e.created_at desc`);
      const pending = rows.filter(
        (r) => r.video_id && r.video_status !== 'errored' && (r.video_status !== 'ready' || (!r.audio_ready && r.has_audio !== false))
      );
      if (pending.length) {
        await syncVideos(pending.map((r) => r.video_id));
        ({ rows } = await db.query(`${EPISODE_SELECT} order by e.created_at desc`));
      }
      return rows.map((r) => withHostFields(toEpisode(r, [], baseUrl), r));
    },

    async hostShorts(baseUrl) {
      let { rows } = await db.query(`${SHORT_SELECT} order by s.created_at desc`);
      const pending = rows.filter((r) => r.video_id && !['ready', 'errored'].includes(r.video_status));
      if (pending.length) {
        await syncVideos(pending.map((r) => r.video_id));
        ({ rows } = await db.query(`${SHORT_SELECT} order by s.created_at desc`));
      }
      return rows.map((r) => withHostFields(toShort(r, baseUrl), r));
    },

    async createUpload({ kind }) {
      const { uploadId, uploadUrl } = await video.createUpload({ audio: kind === 'episode' });
      const id = newId('vid');
      await db.query(
        `insert into videos (id, provider, upload_id, status, wants_audio) values ($1, $2, $3, 'uploading', $4)`,
        [id, video.name, uploadId, kind === 'episode']
      );
      return { videoId: id, uploadUrl };
    },

    async getVideo(id) {
      await syncVideos([id]);
      const { rows } = await db.query('select * from videos where id = $1', [id]);
      const v = rows[0];
      return v && { id: v.id, status: v.status, durationSec: v.duration_sec, audioReady: v.audio_ready, hasAudio: v.has_audio, error: v.error };
    },

    async createEpisode({ title, description = '', chapters = [], tags = [], videoId, thumbnailSec = 0, createdBy }) {
      const id = newId('ep');
      await db.query(
        `insert into episodes (id, title, description, chapters, tags, video_id, thumbnail_sec, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, title, description, JSON.stringify(chapters), tags, videoId, thumbnailSec, createdBy]
      );
      return id;
    },

    async updateEpisode(id, fields) {
      return update('episodes', id, fields, {
        title: 'title',
        description: 'description',
        thumbnailSec: 'thumbnail_sec',
        chapters: 'chapters',
        tags: 'tags',
      });
    },

    // A Short cut from an episode: the video service makes a new video of that range.
    async createShortFromEpisode({ episodeId, title, startSec, endSec, focusX = 0.5, tags = [], createdBy }, baseUrl) {
      const { rows } = await db.query(`${EPISODE_SELECT} where e.id = $1`, [episodeId]);
      const ep = rows[0];
      if (!ep) throw httpError(404, 'Episode not found');
      const duration = ep.video_duration_sec ?? ep.duration_sec;
      if (!(endSec > startSec && startSec >= 0 && endSec <= duration + 0.5)) throw httpError(400, 'The range must be inside the episode');
      if (endSec - startSec > MAX_SHORT_SEC + 0.5) throw httpError(400, `A Short can be at most ${MAX_SHORT_SEC} seconds`);
      if (ep.video_id && ep.video_status !== 'ready') throw httpError(409, "The episode's video is still processing");

      const assetRow = ep.video_id ? (await db.query('select asset_id from videos where id = $1', [ep.video_id])).rows[0] : null;
      const sourceUrl = absolutize(ep.video_url, baseUrl);
      if (!assetRow?.asset_id && !sourceUrl) throw httpError(400, 'This episode has no video');
      const { assetId } = await video.createClip({ assetId: assetRow?.asset_id, sourceUrl, startSec, endSec });

      const videoId = newId('vid');
      await db.query(`insert into videos (id, provider, asset_id, status) values ($1, $2, $3, 'processing')`, [videoId, video.name, assetId]);
      const id = newId('sh');
      await db.query(
        `insert into shorts (id, title, source, episode_id, start_sec, end_sec, video_id, focus_x, tags, created_by)
         values ($1, $2, 'episode', $3, $4, $5, $6, $7, $8, $9)`,
        [id, title, episodeId, startSec, endSec, videoId, focusX, tags, createdBy]
      );
      return id;
    },

    async createShortFromUpload({ title, videoId, episodeId = null, focusX = 0.5, tags = [], createdBy }) {
      const id = newId('sh');
      await db.query(
        `insert into shorts (id, title, source, episode_id, video_id, focus_x, tags, created_by)
         values ($1, $2, 'upload', $3, $4, $5, $6, $7)`,
        [id, title, episodeId, videoId, focusX, tags, createdBy]
      );
      return id;
    },

    async updateShort(id, fields) {
      return update('shorts', id, fields, { title: 'title', focusX: 'focus_x', tags: 'tags' });
    },
  };

  // Shared PATCH for episodes and Shorts, including status changes. Publishing
  // checks the video is actually playable first.
  async function update(table, id, fields, columns) {
    const { rows } = await db.query(
      `select t.*, v.status as video_status, v.audio_ready, v.duration_sec as video_duration_sec
       from ${table} t left join videos v on v.id = t.video_id where t.id = $1`,
      [id]
    );
    const row = rows[0];
    if (!row) return false;

    const set = {};
    for (const [key, col] of Object.entries(columns)) {
      if (fields[key] !== undefined) set[col] = key === 'chapters' ? JSON.stringify(fields[key]) : fields[key];
    }
    if (fields.status !== undefined) {
      set.status = fields.status;
      if (fields.status === 'published') {
        if (row.video_id) await syncVideos([row.video_id]);
        const { rows: vs } = row.video_id ? await db.query('select * from videos where id = $1', [row.video_id]) : { rows: [] };
        const v = vs[0];
        if (v && v.status !== 'ready') throw httpError(409, 'The video is still processing');
        if (v && table === 'episodes' && !v.audio_ready && v.has_audio !== false) throw httpError(409, 'The audio version is still processing');
        if (v && table === 'shorts' && v.duration_sec > MAX_SHORT_SEC + 0.5) {
          throw httpError(400, `A Short can be at most ${MAX_SHORT_SEC} seconds`);
        }
        if (!row.published_at) set.published_at = new Date().toISOString();
      }
    }
    // A new cover frame means a new backdrop color.
    if (table === 'episodes' && set.thumbnail_sec !== undefined) set.tint = null;
    const keys = Object.keys(set);
    if (!keys.length) return true;
    await db.query(
      `update ${table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`,
      [id, ...keys.map((k) => set[k])]
    );
    return true;
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

module.exports = { createStore, httpError, MAX_SHORT_SEC };
