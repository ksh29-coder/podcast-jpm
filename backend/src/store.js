const crypto = require('crypto');
const { tintFromUrl } = require('./tint');
const { parseVtt } = require('./vtt');
const { cleanInsights, cleanSuggestions } = require('./ai');
const { cuesToVtt } = require('./transcribe');

// Database access and the JSON shapes the app sees. Media is either a static
// file under /media (the seeded episodes) or a video on the video service.

const MAX_SHORT_SEC = 90;
// Rejected Shorts and uploads nobody posted are deleted (with their videos)
// after this long, to keep video storage free.
const KEEP_DAYS = 7;

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

// Static media is stored as server-relative paths; clients need absolute URLs.
function absolutize(url, baseUrl) {
  return url && url.startsWith('/') ? baseUrl + url : url;
}

const EPISODE_SELECT = `
  select e.*, v.playback_id, v.status as video_status, v.audio_ready, v.has_audio,
         v.transcript_status, v.transcript_source,
         v.duration_sec as video_duration_sec, v.error as video_error
  from episodes e left join videos v on v.id = e.video_id`;

const SHORT_SELECT = `
  select s.*, v.playback_id, v.status as video_status, v.duration_sec as video_duration_sec,
         v.aspect_ratio, v.error as video_error, v.suggest_status, v.suggestions,
         e.title as episode_title, e.artwork_url as episode_artwork_url,
         ev.playback_id as episode_playback_id, e.thumbnail_sec as episode_thumbnail_sec,
         p.name as author_name
  from shorts s
  left join videos v on v.id = s.video_id
  left join profiles p on p.user_id = s.author_id
  left join episodes e on e.id = s.episode_id
  left join videos ev on ev.id = e.video_id`;

function createStore({ db, video, ai, transcriber, tint = tintFromUrl, cleanUpEveryMs = 10 * 60_000 }) {
  function episodeArtwork(row, baseUrl) {
    return row.playback_id ? video.thumbnailUrl(row.playback_id, row.thumbnail_sec) : absolutize(row.artwork_url, baseUrl);
  }

  function toShort(row, baseUrl) {
    const artworkUrl = row.episode_playback_id
      ? video.thumbnailUrl(row.episode_playback_id, row.episode_thumbnail_sec)
      : row.episode_artwork_url
        ? absolutize(row.episode_artwork_url, baseUrl)
        : row.playback_id && video.thumbnailUrl(row.playback_id, row.cover_sec ?? 0);
    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      // Who posted it; null for Shorts made by hosts.
      author: row.author_id ? { name: row.author_name || 'Someone' } : null,
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
      // Shown to listeners only once a host has approved them.
      summary: row.summary || null,
      mentions: row.mentions || [],
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
            ...(row.transcript_status !== undefined && { transcriptStatus: row.transcript_status, transcriptSource: row.transcript_source }),
          }
        : null,
      createdAt: new Date(row.created_at).toISOString(),
      // In the future when scheduled.
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    };
  }

  // A Short as hosts and its uploader see it: status, the uploader, the AI's
  // check, and the host's note when it wasn't approved.
  function toManagedShort(row, baseUrl) {
    return {
      ...withHostFields(toShort(row, baseUrl), row),
      coverSec: row.cover_sec ?? null,
      reviewNote: row.review_note || null,
      aiCheck: row.author_id ? { status: row.suggest_status || 'none', concerns: row.suggestions?.concerns || [] } : null,
    };
  }

  // Work out (once) the backdrop color for episodes that don't have one yet.
  async function fillTints(rows, baseUrl) {
    const missing = rows.filter((r) => !r.tint);
    await Promise.all(
      missing.map(async (r) => {
        const src = r.playback_id ? video.thumbnailUrl(r.playback_id, r.thumbnail_sec, 32) : absolutize(r.artwork_url, baseUrl);
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
      `${SHORT_SELECT} where s.episode_id = any($1) ${publishedOnly ? `and ${live('s')}` : ''}
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
      // Keep only the part the uploader chose: cut it into a new video and
      // delete the original. Claimed in the database so it happens once.
      if (a.status === 'ready' && row.trim_start != null) {
        const { rows: claimed } = await db.query(
          `update videos v set trim_start = null, trim_end = null
           from (select id, trim_start, trim_end from videos where id = $1 and trim_start is not null for update) old
           where v.id = old.id returning old.trim_start, old.trim_end`,
          [row.id]
        );
        const range = claimed[0];
        if (range) {
          const end = Math.min(range.trim_end, a.durationSec ?? range.trim_end);
          if (range.trim_start > 0.2 || end < (a.durationSec ?? end) - 0.2) {
            const clip = await video.createClip({ assetId, startSec: range.trim_start, endSec: end, captions: true }).catch(async (e) => {
              // Try again on the next check rather than keep the whole video.
              await db.query('update videos set trim_start = $2, trim_end = $3 where id = $1', [row.id, range.trim_start, range.trim_end]);
              throw e;
            });
            // The original is deleted once the cut is ready (it's made from it).
            await db.query(
              "update videos set asset_id = $2, source_asset_id = $3, status = 'processing', playback_id = null, duration_sec = null where id = $1",
              [row.id, clip.assetId, assetId]
            );
            return;
          }
        }
      }
      Object.assign(patch, {
        status: a.status,
        playback_id: a.playbackId,
        duration_sec: a.durationSec,
        aspect_ratio: a.aspectRatio,
        audio_ready: a.audioReady,
        error: a.error,
      });
      if (row.source_asset_id && a.status !== 'processing') {
        await video.deleteAsset(row.source_asset_id).catch((e) => console.warn('delete original', row.source_asset_id, e.message));
        patch.source_asset_id = null;
      }
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

  // Moves a video's transcript along: asks for captions if nobody has, and
  // stores them once they're ready. Returns the transcript status.
  async function ensureTranscript(v, { thorough = false, force = false, baseUrl } = {}) {
    if (!force && (v.transcript_status === 'ready' || v.transcript_status === 'unavailable')) return v.transcript_status;
    if (v.has_audio === false && v.status === 'ready') return setStatus('unavailable');

    // The better transcription (with speakers) runs on publish or when a host
    // asks, since it takes a few seconds per hour of audio.
    if (thorough && transcriber && v.playback_id && v.audio_ready) {
      const recent = v.transcript_status === 'transcribing' && v.transcript_started_at && Date.now() - new Date(v.transcript_started_at) < 5 * 60_000;
      if (recent && !force) return 'generating';
      await db.query("update videos set transcript_status = 'transcribing', transcript_started_at = now() where id = $1", [v.id]);
      v.transcript_status = 'transcribing';
      try {
        const { cues } = await transcriber.transcribe(video.audioUrl(v.playback_id));
        if (!cues.length) return setStatus('unavailable');
        await storeCues(cues, transcriber.model);
        // Swap the video's captions for this transcript (Mux fetches it from us).
        if (baseUrl?.startsWith('https://')) {
          await video.replaceCaptions(v.asset_id, `${baseUrl}/api/captions/${v.id}.vtt`).catch((e) => console.warn('captions', v.id, e.message));
        }
        return setStatus('ready');
      } catch (e) {
        console.warn('transcribe', v.id, e.message);
        await db.query("update videos set transcript_status = 'none' where id = $1 and transcript_status = 'transcribing'", [v.id]);
        v.transcript_status = 'none';
        if (force) throw e;
        // Fall through to Mux's captions.
      }
    }
    if (v.transcript_status === 'transcribing') return 'generating';
    if (!v.asset_id || !v.playback_id || v.has_audio === false) return v.status === 'ready' && v.has_audio === false ? setStatus('unavailable') : 'none';
    const asset = await video.getAsset(v.asset_id);
    const track = asset.textTrack;
    if (!track) {
      if (!asset.hasAudioTrack) return setStatus('unavailable');
      if (v.transcript_status === 'none' && asset.status === 'ready') {
        await video.generateSubtitles(v.asset_id);
        return setStatus('generating');
      }
      return v.transcript_status;
    }
    if (track.status === 'errored') return setStatus('unavailable');
    if (track.status !== 'ready') return setStatus('generating');
    await storeCues(parseVtt(await video.fetchCaptions(v.playback_id, track.id)), 'mux');
    return setStatus('ready');

    async function storeCues(cues, source) {
      await db.query('delete from transcript_cues where video_id = $1', [v.id]);
      for (let i = 0; i < cues.length; i++) {
        await db.query('insert into transcript_cues (video_id, idx, start_sec, end_sec, text, speaker) values ($1, $2, $3, $4, $5, $6)', [
          v.id,
          i,
          cues[i].startSec,
          cues[i].endSec,
          cues[i].text,
          cues[i].speaker ?? null,
        ]);
      }
      await db.query('update videos set transcript_source = $2 where id = $1', [v.id, source]);
      v.transcript_source = source;
    }

    async function setStatus(status) {
      if (status !== v.transcript_status) await db.query('update videos set transcript_status = $2 where id = $1', [v.id, status]);
      v.transcript_status = status;
      return status;
    }
  }

  // Ask the AI for suggestions from the episode's transcript and keep them
  // for the host to review. Needs the transcript, so it may ask the host to wait.
  async function generateInsights(episodeId, baseUrl) {
    if (!ai) throw httpError(503, 'AI isn’t set up on this server');
    // Bring the upload's processing state up to date first.
    const { rows: vids } = await db.query('select video_id from episodes where id = $1', [episodeId]);
    if (vids[0]?.video_id) await syncVideos([vids[0].video_id]);
    const { rows } = await db.query(
      `select e.title, e.description, v.*, v.duration_sec as video_duration_sec from episodes e join videos v on v.id = e.video_id where e.id = $1`,
      [episodeId]
    );
    const v = rows[0];
    if (!v) throw httpError(404, 'This episode has no uploaded video to read');
    const status = await ensureTranscript(v, { thorough: true, baseUrl });
    if (status === 'unavailable') throw httpError(409, 'This episode has no spoken audio, so there’s nothing for the AI to read');
    if (status !== 'ready') throw httpError(409, 'The transcript is still being prepared. Try again in a few minutes.');
    const { rows: cueRows } = await db.query('select start_sec, end_sec, text, speaker from transcript_cues where video_id = $1 order by idx', [v.id]);
    const cues = cueRows.map((c) => ({ startSec: c.start_sec, endSec: c.end_sec, text: c.text, speaker: c.speaker }));
    const durationSec = v.video_duration_sec || cues.at(-1)?.endSec || 0;
    const raw = await ai.episodeInsights({ title: v.title, description: v.description, durationSec, cues });
    const insights = { ...cleanInsights(raw, { durationSec, cues }), model: ai.model, generatedAt: new Date().toISOString() };
    await db.query('update episodes set ai = $2, updated_at = now() where id = $1', [episodeId, JSON.stringify(insights)]);
  }

  // Moves a posted (or still being posted) Short's video along: processing,
  // captions, then the AI's suggestions and check. Called while the uploader
  // waits on the details screen and when a host opens the review queue, since
  // there are no background jobs. Returns the fresh video row.
  async function advanceUpload(videoId) {
    await syncVideos([videoId]);
    let v = (await db.query('select * from videos where id = $1', [videoId])).rows[0];
    if (!v || v.status !== 'ready' || ['ready', 'unavailable'].includes(v.suggest_status)) return v;
    const finish = async (status, suggestions) => {
      await db.query('update videos set suggest_status = $2, suggestions = $3 where id = $1', [videoId, status, JSON.stringify(suggestions)]);
      return (await db.query('select * from videos where id = $1', [videoId])).rows[0];
    };
    const durationSec = v.duration_sec || 0;
    const transcript = await ensureTranscript(v);
    // Nothing said, or no AI here: just a cover frame from the middle.
    if (transcript === 'unavailable' || !ai) return finish('unavailable', { coverSec: Math.round(durationSec * 5) / 10, concerns: [] });
    if (transcript !== 'ready') return v;
    // One request at a time; a stuck one is retried after two minutes.
    const { rowCount } = await db.query(
      `update videos set suggest_status = 'generating', suggest_started_at = now()
       where id = $1 and (suggest_status = 'none' or (suggest_status = 'generating' and suggest_started_at < now() - interval '2 minutes'))`,
      [videoId]
    );
    if (!rowCount) return v;
    try {
      const { rows } = await db.query('select start_sec, end_sec, text from transcript_cues where video_id = $1 order by idx', [videoId]);
      const cues = rows.map((c) => ({ startSec: c.start_sec, endSec: c.end_sec, text: c.text }));
      const raw = await ai.shortSuggestions({ durationSec, cues });
      v = await finish('ready', { ...cleanSuggestions(raw, { durationSec }), model: ai.model });
    } catch (e) {
      console.warn('short suggestions', videoId, e.message);
      v = await finish('unavailable', { coverSec: Math.round(durationSec * 5) / 10, concerns: [], error: true });
    }
    return v;
  }

  // Deletes rejected Shorts and never-posted uploads older than KEEP_DAYS,
  // and their videos. Runs at most every ten minutes per server instance,
  // from requests that need the space (there are no background jobs).
  let lastCleanUp = 0;
  async function cleanUp() {
    if (Date.now() - lastCleanUp < cleanUpEveryMs) return;
    lastCleanUp = Date.now();
    const { rows: rejected } = await db.query(
      `select id from shorts where author_id is not null and status = 'rejected' and updated_at < now() - interval '${KEEP_DAYS} days'`
    );
    for (const r of rejected) await removeShort(r.id);
    const { rows: unposted } = await db.query(
      `delete from videos v where owner_id is not null and created_at < now() - interval '${KEEP_DAYS} days'
       and not exists (select 1 from shorts s where s.video_id = v.id) returning asset_id, source_asset_id`
    );
    await deleteAssets(unposted);
  }

  // The video service's files for deleted video rows (and any uncut original).
  async function deleteAssets(rows) {
    const ids = rows.flatMap((r) => [r.asset_id, r.source_asset_id]).filter(Boolean);
    await Promise.all(ids.map((id) => video.deleteAsset(id).catch((e) => console.warn('delete asset', id, e.message))));
  }

  // A Short and everything hanging off it: likes, views, comments, its video.
  async function removeShort(id) {
    const { rows } = await db.query('delete from shorts where id = $1 returning video_id', [id]);
    for (const table of ['likes', 'views', 'comments']) await db.query(`delete from ${table} where item_type = 'short' and item_id = $1`, [id]);
    if (rows[0]?.video_id) {
      const { rows: vids } = await db.query('delete from videos where id = $1 returning asset_id, source_asset_id', [rows[0].video_id]);
      await deleteAssets(vids);
    }
  }

  // A Short someone posted, if it's theirs.
  async function ownShort(userId, id) {
    const { rows } = await db.query(`${SHORT_SELECT} where s.id = $1 and s.author_id = $2`, [id, userId]);
    if (!rows[0]) throw httpError(404, 'Short not found');
    return rows[0];
  }

  // Visible to listeners: published, and the release time (if scheduled) has come.
  const live = (alias) => `${alias}.status = 'published' and ${alias}.published_at <= now()`;

  return {
    async listEpisodes(baseUrl) {
      const { rows } = await db.query(`${EPISODE_SELECT} where ${live('e')} order by e.published_at desc`);
      await fillTints(rows, baseUrl);
      const shorts = await shortsFor(rows.map((r) => r.id), { publishedOnly: true });
      return rows.map((r) => toEpisode(r, shorts.get(r.id) || [], baseUrl));
    },

    async getEpisode(id, baseUrl, { host = false } = {}) {
      const { rows } = await db.query(`${EPISODE_SELECT} where e.id = $1 ${host ? '' : `and ${live('e')}`}`, [id]);
      if (!rows[0]) return null;
      await fillTints(rows, baseUrl);
      const shorts = await shortsFor([id], { publishedOnly: !host });
      const out = toEpisode(rows[0], shorts.get(id) || [], baseUrl);
      if (!host) return out;
      // Every speaker the transcript found, so hosts can name each one.
      const { rows: voices } = await db.query(
        'select distinct speaker from transcript_cues where video_id = $1 and speaker is not null order by speaker',
        [rows[0].video_id]
      );
      return withHostFields(
        {
          ...out,
          thumbnailSec: rows[0].thumbnail_sec,
          ai: rows[0].ai || null,
          speakers: rows[0].speakers || {},
          transcriptSpeakers: voices.map((r) => String(r.speaker)),
          clips: (shorts.get(id) || []).map((s) => withHostFields(toShort(s, baseUrl), s)),
        },
        rows[0]
      );
    },

    async listShorts(baseUrl) {
      const { rows } = await db.query(`${SHORT_SELECT} where ${live('s')} order by s.published_at desc, s.start_sec`);
      return rows.map((r) => toShort(r, baseUrl));
    },

    async episodeDuration(id) {
      const ep = await this.getEpisode(id, '');
      return ep && ep.durationSec;
    },

    // The transcript of a published episode, from its generated captions.
    // Captions take a few minutes; until then the status says so, and the
    // first request asks the video service to start if nobody has yet.
    async transcript(episodeId) {
      const { rows } = await db.query(
        `select v.*, e.speakers from episodes e join videos v on v.id = e.video_id where e.id = $1 and ${live('e')}`,
        [episodeId]
      );
      const v = rows[0];
      if (!v) return null;
      // Listeners never wait for a full transcription; that happens on publish.
      const status = await ensureTranscript(v);
      if (status !== 'ready') return { status, cues: [] };
      const cues = await db.query('select start_sec, end_sec, text, speaker from transcript_cues where video_id = $1 order by idx', [v.id]);
      return {
        status,
        source: v.transcript_source,
        speakers: v.speakers || {},
        cues: cues.rows.map((c) => ({ startSec: c.start_sec, endSec: c.end_sec, text: c.text, speaker: c.speaker })),
      };
    },

    // Search titles, descriptions, tags and what was said.
    async search(q, baseUrl) {
      const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      const eps = await db.query(
        `${EPISODE_SELECT} where ${live('e')} and (e.title ilike $1 or e.description ilike $1 or exists (select 1 from unnest(e.tags) t where t ilike $1))
         order by e.published_at desc limit 20`,
        [like]
      );
      const shorts = await db.query(
        `${SHORT_SELECT} where ${live('s')} and (s.title ilike $1 or s.description ilike $1 or exists (select 1 from unnest(s.tags) t where t ilike $1))
         order by s.published_at desc limit 20`,
        [like]
      );
      // Moments: transcript lines that mention it, linked to the second they're said.
      const moments = await db.query(
        `select e.id as episode_id, e.title as episode_title, c.start_sec, c.text
         from transcript_cues c join episodes e on e.video_id = c.video_id
         where ${live('e')} and c.text ilike $1
         order by e.published_at desc, c.idx limit 30`,
        [like]
      );
      await fillTints(eps.rows, baseUrl);
      return {
        episodes: eps.rows.map((r) => toEpisode(r, [], baseUrl)),
        shorts: shorts.rows.map((r) => toShort(r, baseUrl)),
        moments: moments.rows.map((m) => ({ episodeId: m.episode_id, episodeTitle: m.episode_title, startSec: m.start_sec, text: m.text })),
      };
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
      return rows.map((r) => withHostFields({ ...toEpisode(r, [], baseUrl), ai: r.ai || null }, r));
    },

    async hostShorts(baseUrl) {
      await cleanUp().catch((e) => console.warn('clean up', e.message));
      let { rows } = await db.query(`${SHORT_SELECT} order by s.created_at desc`);
      const pending = rows.filter((r) => r.video_id && !['ready', 'errored'].includes(r.video_status));
      // Posted Shorts waiting for review also get the AI's check, if the
      // uploader didn't stay on the details screen long enough for it.
      const unchecked = rows.filter((r) => r.author_id && r.status === 'in_review' && r.video_id && !['ready', 'unavailable'].includes(r.suggest_status));
      if (pending.length || unchecked.length) {
        await syncVideos(pending.map((r) => r.video_id));
        await Promise.all(unchecked.map((r) => advanceUpload(r.video_id).catch((e) => console.warn('advance', r.video_id, e.message))));
        ({ rows } = await db.query(`${SHORT_SELECT} order by s.created_at desc`));
      }
      return rows.map((r) => toManagedShort(r, baseUrl));
    },

    async reach(episodeId) {
      const ep = await this.getEpisode(episodeId, '', { host: true });
      if (!ep) return null;
      const d = ep.durationSec || 0;
      const { rows } = await db.query('select max_sec from progress where episode_id = $1', [episodeId]);
      const listeners = rows.length;
      // Share of listeners who got at least to the start of each tenth (0%, 10% … 90%), and to the end.
      const points = Array.from({ length: 11 }, (_, i) => {
        const at = (d * i) / 10;
        const reached = rows.filter((r) => r.max_sec >= at - (i === 10 ? 5 : 0)).length;
        return { percent: i * 10, atSec: Math.round(at), listeners: reached, share: listeners ? reached / listeners : 0 };
      });
      return { listeners, durationSec: d, points };
    },

    // Host asks to (re)make the transcript with the speech-to-text service.
    async retranscribe(episodeId, baseUrl) {
      if (!transcriber) throw httpError(503, 'Transcription isn’t set up on this server');
      const { rows } = await db.query('select v.* from episodes e join videos v on v.id = e.video_id where e.id = $1', [episodeId]);
      const v = rows[0];
      if (!v) throw httpError(404, 'This episode has no uploaded video to transcribe');
      await syncVideos([v.id]);
      const fresh = (await db.query('select * from videos where id = $1', [v.id])).rows[0];
      if (fresh.has_audio === false) throw httpError(409, 'This video has no sound to transcribe');
      if (!fresh.audio_ready) throw httpError(409, 'The audio is still being prepared. Try again in a minute.');
      return ensureTranscript(fresh, { thorough: true, force: true, baseUrl });
    },

    // A video's transcript as WebVTT (fetched by the video service for captions).
    async captionsVtt(videoId) {
      const { rows } = await db.query('select start_sec, end_sec, text from transcript_cues where video_id = $1 order by idx', [videoId]);
      return rows.length ? cuesToVtt(rows.map((c) => ({ startSec: c.start_sec, endSec: c.end_sec, text: c.text }))) : null;
    },

    // Ask the AI for suggestions from the episode's transcript and keep them
    // for the host to review. Needs the transcript, so it may ask the host to wait.
    generateInsights,

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

    // baseUrl lets publishing hand the video service a link to our captions.
    async updateEpisode(id, fields, baseUrl) {
      return update('episodes', id, { ...fields, baseUrl }, {
        title: 'title',
        description: 'description',
        thumbnailSec: 'thumbnail_sec',
        chapters: 'chapters',
        tags: 'tags',
        summary: 'summary',
        mentions: 'mentions',
        speakers: 'speakers',
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
      return update('shorts', id, fields, {
        title: 'title',
        description: 'description',
        focusX: 'focus_x',
        tags: 'tags',
        coverSec: 'cover_sec',
        reviewNote: 'review_note',
      });
    },

    // ---- Posting Shorts from the app (anyone) ----

    async profile(userId) {
      const { rows } = await db.query('select name, guidelines_at from profiles where user_id = $1', [userId]);
      return { name: rows[0]?.name ?? null, acceptedGuidelines: !!rows[0]?.guidelines_at, maxShortSec: MAX_SHORT_SEC };
    },

    // Agreeing to the guidelines is remembered; it can't be taken back here.
    async saveProfile(userId, { name, acceptGuidelines }) {
      await db.query(
        `insert into profiles (user_id, name, guidelines_at) values ($1, $2, case when $3 then now() end)
         on conflict (user_id) do update set name = excluded.name,
           guidelines_at = coalesce(profiles.guidelines_at, excluded.guidelines_at), updated_at = now()`,
        [userId, name, !!acceptGuidelines]
      );
      return this.profile(userId);
    },

    // A one-time upload URL for someone's Short. A range keeps only that part.
    async createUserUpload(userId, { startSec, endSec }) {
      const me = await this.profile(userId);
      if (!me.name || !me.acceptedGuidelines) throw httpError(403, 'Add your name and agree to the guidelines first');
      await cleanUp().catch((e) => console.warn('clean up', e.message));
      const { uploadId, uploadUrl } = await video.createUpload({ audio: false, captions: startSec == null }).catch((e) => {
        // The video service's storage is full (e.g. a plan's video limit).
        if (/limit/i.test(e.message)) throw httpError(503, 'Posting is paused because video storage is full. Please try again later.');
        throw e;
      });
      const id = newId('vid');
      await db.query(
        `insert into videos (id, provider, upload_id, status, owner_id, trim_start, trim_end) values ($1, $2, $3, 'uploading', $4, $5, $6)`,
        [id, video.name, uploadId, userId, startSec ?? null, endSec ?? null]
      );
      return { videoId: id, uploadUrl };
    },

    // Where an upload has got to, with the AI's suggestions once there are
    // some and a few frames to pick the cover from.
    async uploadState(userId, videoId) {
      const { rows } = await db.query('select owner_id from videos where id = $1', [videoId]);
      if (!rows[0] || rows[0].owner_id !== userId) throw httpError(404, 'Upload not found');
      const v = await advanceUpload(videoId);
      const s = v.suggestions || {};
      const ready = v.status === 'ready' && v.playback_id;
      const d = v.duration_sec || 0;
      return {
        status: v.status,
        error: v.error,
        durationSec: v.duration_sec,
        suggestions: {
          status: v.status === 'errored' ? 'unavailable' : v.suggest_status,
          title: s.title || null,
          description: s.description || null,
          tags: s.tags || [],
          coverSec: s.coverSec ?? null,
        },
        // Six evenly spaced frames, plus the suggested one.
        frames: ready
          ? [...new Set([...Array.from({ length: 6 }, (_, i) => Math.round(((i + 0.5) * d) / 6)), ...(s.coverSec != null ? [s.coverSec] : [])])]
              .sort((a, b) => a - b)
              .map((sec) => ({ sec, url: video.thumbnailUrl(v.playback_id, sec, 240) }))
          : [],
      };
    },

    // An upload that was never posted (the person gave up on it).
    async deleteUserUpload(userId, videoId) {
      const { rows } = await db.query(
        `delete from videos v where id = $1 and owner_id = $2 and not exists (select 1 from shorts s where s.video_id = v.id) returning asset_id, source_asset_id`,
        [videoId, userId]
      );
      if (!rows[0]) throw httpError(404, 'Upload not found');
      await deleteAssets(rows);
    },

    async createUserShort(userId, { videoId, title, description = '', tags = [], coverSec = null }) {
      const { rows } = await db.query('select * from videos where id = $1', [videoId]);
      const v = rows[0];
      if (!v || v.owner_id !== userId) throw httpError(404, 'Upload not found');
      // Sent twice (e.g. the first reply was lost): it's already posted.
      const { rows: existing } = await db.query('select id, author_id from shorts where video_id = $1', [videoId]);
      if (existing[0]) {
        if (existing[0].author_id === userId) return existing[0].id;
        throw httpError(409, 'This video is already posted');
      }
      if (v.status === 'ready' && v.duration_sec > MAX_SHORT_SEC + 0.5) throw httpError(400, `A Short can be at most ${MAX_SHORT_SEC} seconds`);
      const id = newId('sh');
      await db.query(
        `insert into shorts (id, title, description, status, source, video_id, tags, cover_sec, author_id, created_by)
         values ($1, $2, $3, 'in_review', 'upload', $4, $5, $6, $7, $7)`,
        [id, title, description, videoId, tags, coverSec, userId]
      );
      return id;
    },

    async myShorts(userId, baseUrl) {
      let { rows } = await db.query(`${SHORT_SELECT} where s.author_id = $1 order by s.created_at desc`, [userId]);
      const pending = rows.filter((r) => r.video_id && !['ready', 'errored'].includes(r.video_status));
      if (pending.length) {
        await syncVideos(pending.map((r) => r.video_id));
        ({ rows } = await db.query(`${SHORT_SELECT} where s.author_id = $1 order by s.created_at desc`, [userId]));
      }
      // The AI's check is for hosts.
      return rows.map((r) => ({ ...toManagedShort(r, baseUrl), aiCheck: undefined }));
    },

    // Details can change while a Short waits for review, not once it's live.
    async updateMyShort(userId, id, fields) {
      const row = await ownShort(userId, id);
      if (row.status !== 'in_review') throw httpError(409, 'Only Shorts still in review can be edited');
      return update('shorts', id, fields, { title: 'title', description: 'description', tags: 'tags', coverSec: 'cover_sec' });
    },

    // Gone for everyone, with its likes, views and comments, and the video itself.
    async deleteMyShort(userId, id) {
      await ownShort(userId, id);
      await removeShort(id);
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
      if (fields[key] !== undefined) set[col] = key === 'chapters' || key === 'mentions' || key === 'speakers' ? JSON.stringify(fields[key]) : fields[key];
    }
    if (fields.status !== undefined) {
      set.status = fields.status;
      if (table === 'shorts' && fields.status !== 'rejected' && fields.reviewNote === undefined) set.review_note = null;
      if (fields.status === 'published') {
        if (row.video_id) await syncVideos([row.video_id]);
        const { rows: vs } = row.video_id ? await db.query('select * from videos where id = $1', [row.video_id]) : { rows: [] };
        const v = vs[0];
        if (v && v.status !== 'ready') throw httpError(409, 'The video is still processing');
        if (v && table === 'episodes' && !v.audio_ready && v.has_audio !== false) throw httpError(409, 'The audio version is still processing');
        if (v && table === 'shorts' && v.duration_sec > MAX_SHORT_SEC + 0.5) {
          throw httpError(400, `A Short can be at most ${MAX_SHORT_SEC} seconds`);
        }
        // A release time in the future schedules it; otherwise it goes live now.
        if (fields.publishAt) set.published_at = fields.publishAt;
        else if (!row.published_at || new Date(row.published_at) > new Date()) set.published_at = new Date().toISOString();
        // Start the transcript now so it's ready (and searchable) sooner.
        if (table === 'episodes' && v) await ensureTranscript(v, { thorough: true, baseUrl: fields.baseUrl }).catch((e) => console.warn('transcript', v.id, e.message));
        // Have AI suggestions waiting for the host, the first time only.
        if (table === 'episodes' && v && ai && !row.ai) {
          await generateInsights(id, fields.baseUrl).catch((e) => console.warn('ai on publish', id, e.message));
        }
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

module.exports = { createStore, httpError, MAX_SHORT_SEC, KEEP_DAYS };
