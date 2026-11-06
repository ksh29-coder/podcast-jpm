const crypto = require('crypto');
const { tintFromUrl } = require('./tint');
const { parseVtt } = require('./vtt');
const { cleanInsights, cleanSuggestions, cleanCaptionFix } = require('./ai');
const { cuesToVtt } = require('./transcribe');
const { inBackground } = require('./background');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const plans = require('./edit-engine/plan');
const episodeEdit = require('./episode-edit');

// Database access and the JSON shapes the app sees. Media is either a static
// file under /media (the seeded episodes) or a video on the video service.

const MAX_SHORT_SEC = 90;
// Rejected Shorts and uploads nobody posted are deleted (with their videos)
// after this long, to keep video storage free.
const KEEP_DAYS = 7;
// Largest picture file someone can add to a Short (it's made smaller).
const MAX_PICTURE_BYTES = 25 << 20;

// Pictures are being (or waiting to be) added to the video.
const editBusy = (status) => status === 'queued' || status === 'rendering';

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

// Lets a viewer hide someone's posts without learning who (or which device)
// they are. The same key as on comments, so one block covers both.
const authorKey = (userId) => crypto.createHash('sha256').update(`author:${userId}`).digest('hex').slice(0, 16);

// Reasons viewers gave when reporting it ('' when they gave none).
const reportsOf = (type, alias) =>
  `(select coalesce(json_agg(r.reason order by r.created_at), '[]') from content_reports r where r.item_type = '${type}' and r.item_id = ${alias}.id) as reports`;

// Static media is stored as server-relative paths; clients need absolute URLs.
function absolutize(url, baseUrl) {
  return url && url.startsWith('/') ? baseUrl + url : url;
}

const EPISODE_SELECT = `
  select e.*, v.playback_id, v.status as video_status, v.audio_ready, v.has_audio,
         v.transcript_status, v.transcript_source,
         v.duration_sec as video_duration_sec, v.error as video_error, v.suggest_status, v.suggestions,
         p.name as author_name, ${reportsOf('episode', 'e')}
  from episodes e left join videos v on v.id = e.video_id
  left join profiles p on p.user_id = e.author_id`;

const SHORT_SELECT = `
  select s.*, v.playback_id, v.status as video_status, v.duration_sec as video_duration_sec,
         v.aspect_ratio, v.error as video_error, v.suggest_status, v.suggestions,
         v.edit_status, v.edit_error, jsonb_array_length(v.pictures) as picture_count,
         e.title as episode_title, e.artwork_url as episode_artwork_url,
         ev.playback_id as episode_playback_id, e.thumbnail_sec as episode_thumbnail_sec,
         p.name as author_name, ${reportsOf('short', 's')}
  from shorts s
  left join videos v on v.id = s.video_id
  left join profiles p on p.user_id = s.author_id
  left join episodes e on e.id = s.episode_id
  left join videos ev on ev.id = e.video_id`;

// editWorker 'external': episode edits are made by a separate worker
// (bin/edit-worker.js), not in the request's time limit (see background.js).
function createStore({ db, video, ai, transcriber, editor, engine, background = inBackground, tint = tintFromUrl, cleanUpEveryMs = 10 * 60_000, editWorker = process.env.EDIT_WORKER }) {
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
      author: row.author_id ? { name: row.author_name || 'Someone', key: authorKey(row.author_id) } : null,
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
      // Who posted it; null for episodes made by hosts.
      author: row.author_id ? { name: row.author_name || 'Someone', key: authorKey(row.author_id) } : null,
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
            // Pictures being added to a Short's video (see advanceEdit).
            ...(row.edit_status !== undefined && { edit: { status: row.edit_status, error: row.edit_error } }),
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
      pictureCount: row.picture_count || 0,
      reviewNote: row.review_note || null,
      reports: parseReports(row.reports),
      aiCheck: row.author_id ? { status: row.suggest_status || 'none', concerns: row.suggestions?.concerns || [] } : null,
    };
  }

  // An episode as hosts and its uploader see it (see toManagedShort).
  function toManagedEpisode(row, baseUrl) {
    return {
      ...withHostFields({ ...toEpisode(row, [], baseUrl), ai: row.ai || null }, row),
      reviewNote: row.review_note || null,
      reports: parseReports(row.reports),
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
    for (const r of rows) if (editBusy(r.edit_status) && !(r.edit_plan && editWorker === 'external')) background(advanceEdit(r.id));
  }

  // ---- Pictures in a Short's video ----

  // Videos this server is adding pictures to (or waiting to), so checks every
  // few seconds don't start another.
  const editing = new Set();

  // Makes the video again with its pictures, once it's processed (and
  // trimmed): ffmpeg adds them to a copy of the video without pictures, which
  // replaces the one shown. Claimed in the database so only one runs; one
  // cut off by the server's time limit is tried again after a few minutes.
  async function advanceEdit(videoId) {
    if (editing.has(videoId)) return;
    editing.add(videoId);
    try {
      await makeEdit(videoId);
    } finally {
      editing.delete(videoId);
    }
  }

  async function makeEdit(videoId) {
    const claimable = `(edit_status = 'queued' or (edit_status = 'rendering' and edit_started_at < now() - interval '6 minutes'))
      and status = 'ready' and trim_start is null and source_asset_id is null`;
    const { rows } = await db.query(`select * from videos where id = $1 and ${claimable}`, [videoId]);
    const v = rows[0];
    if (!v) return;
    const plan = v.edit_plan && episodeEdit.changesVideo(v.edit_plan);
    if (!v.pictures.length && !plan) {
      // All taken out again: back to the video without them (an episode's
      // chapters and transcript back in the original's times).
      if (v.edit_plan && v.unedited_asset_id) await retime(v, null);
      await db.query(
        `update videos set asset_id = unedited_asset_id, playback_id = unedited_playback_id, source_asset_id = asset_id,
           status = 'processing', audio_ready = false, unedited_asset_id = null, unedited_playback_id = null, edit_rendered = null
         where id = $1 and unedited_asset_id is not null`,
        [videoId]
      );
      await db.query("update videos set edit_status = 'none', edit_error = null where id = $1 and edit_status = $2", [videoId, v.edit_status]);
      return;
    }
    const fail = (message) => db.query("update videos set edit_status = 'failed', edit_error = $2 where id = $1", [videoId, message]);
    if (plan ? !engine : !editor) return fail(plan ? 'Editing videos isn’t set up on this server' : 'Adding pictures isn’t set up on this server');
    // The video service may take a minute to make the file downloadable.
    let url = null;
    for (let i = 0; i < 12 && !url; i++) {
      url = await video.downloadUrl(v.unedited_asset_id || v.asset_id);
      if (!url) await new Promise((r) => setTimeout(r, 5000));
    }
    if (!url) return;
    const { rows: claimed } = await db.query(
      `update videos set edit_status = 'rendering', edit_started_at = now(), edit_error = null where id = $1 and ${claimable} returning *`,
      [videoId]
    );
    const job = claimed[0];
    if (!job) return;
    if (plan) return renderPlan(job, url).catch(async (e) => {
      console.warn('episode edit', videoId, e.message);
      await fail(e.expose ? e.message : 'The edit couldn’t be made. Try again.');
    });
    try {
      const ids = job.pictures.map((p) => p.pictureId);
      const { rows: files } = await db.query("select id, data, mime, width, height from pictures where id = any($1) and status = 'ready'", [ids]);
      const byId = new Map(files.map((f) => [f.id, f]));
      if (ids.some((id) => !byId.has(id))) throw httpError(409, 'A picture is missing. Add it again.');
      await editor.render({ videoUrl: url, pictures: job.pictures.map((p) => ({ ...p, ...byId.get(p.pictureId) })) }, async (file) => {
        const { uploadId, uploadUrl } = await video.createUpload({ captions: job.transcript_status !== 'ready' });
        await video.uploadFile(uploadUrl, file);
        // The new video shows once it's processed. The one without pictures
        // is kept; an earlier one with pictures is deleted then (source_asset_id).
        await db.query(
          `update videos set upload_id = $2, asset_id = null, playback_id = null, status = 'processing',
             unedited_asset_id = coalesce(unedited_asset_id, asset_id), unedited_playback_id = coalesce(unedited_playback_id, playback_id),
             source_asset_id = case when unedited_asset_id is null then null else asset_id end,
             edit_status = 'ready'
           where id = $1`,
          [videoId, uploadId]
        );
      });
    } catch (e) {
      console.warn('edit', videoId, e.message);
      await fail(e.expose ? e.message : 'The pictures couldn’t be added to the video. Try again.');
    }
  }

  // ---- Editing an episode's video (episode-edit.js) ----

  // Makes the episode's video from its edit plan and the original upload
  // (at url), sends it to the video service, and moves the episode's
  // chapters, cover frame and transcript to the new video's times.
  async function renderPlan(v, url) {
    const plan = plans.withDefaults(v.edit_plan);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'episode-edit-'));
    // A long episode takes a while: say it's still going, so it isn't taken
    // for one cut off and started again elsewhere.
    const alive = setInterval(() => {
      db.query("update videos set edit_started_at = now() where id = $1 and edit_status = 'rendering'", [v.id]).catch(() => {});
    }, 60_000);
    let uploadId;
    try {
      const out = path.join(dir, 'edit.mp4');
      const started = Date.now();
      // Each recording read once, from a file: the real sizes, then the edit.
      const files = await engine.downloadAll({ [plans.MAIN]: url, ...(await sourceUrls(plan)) }, dir);
      const info = await engine.probe(files[plans.MAIN]);
      plan.source = { ...plan.source, ...info, durationSec: Math.max(info.durationSec, plan.source.durationSec || 0) };
      for (const name of Object.keys(plan.sources)) {
        const { width, height, durationSec } = await engine.probe(files[name]);
        plan.sources[name] = { ...plan.sources[name], width, height, durationSec };
      }
      await engine.render(plan, { paths: files, out, quality: 'full' });
      console.log('episode edit render', v.id, { seconds: (Date.now() - started) / 1000 });
      const upload = await video.createUpload({ audio: v.wants_audio, captions: v.transcript_status !== 'ready' });
      await video.uploadFile(upload.uploadUrl, out);
      uploadId = upload.uploadId;
    } finally {
      clearInterval(alive);
      await fs.rm(dir, { recursive: true, force: true });
    }
    await retime(v, episodeEdit.segmentsOf(plan));
    // The new video shows once it's processed. The original is kept to edit
    // again; an earlier edit is deleted then (source_asset_id).
    await db.query(
      `update videos set upload_id = $2, asset_id = null, playback_id = null, status = 'processing', audio_ready = false,
         unedited_asset_id = coalesce(unedited_asset_id, asset_id), unedited_playback_id = coalesce(unedited_playback_id, playback_id),
         source_asset_id = case when unedited_asset_id is null then null else asset_id end,
         edit_status = 'ready', edit_rendered = $3
       where id = $1`,
      [v.id, uploadId, JSON.stringify(plan)]
    );
  }

  // A link to download a video's file; the video service may take a minute
  // to make one.
  async function fileUrl(assetId, what) {
    for (let i = 0; i < 12; i++) {
      const url = await video.downloadUrl(assetId);
      if (url) return url;
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw httpError(409, `${what} isn’t ready to use yet. Try again in a minute.`);
  }

  // Links to the other recordings a plan shows (like a screen share), by name.
  async function sourceUrls(plan) {
    const out = {};
    for (const [name, s] of Object.entries(plan.sources)) {
      const id = String(s.video).replace(/^video:/, '');
      const { rows } = await db.query('select asset_id from videos where id = $1', [id]);
      if (!rows[0]?.asset_id) throw httpError(409, `The ${name} recording is missing. Add it again.`);
      out[name] = await fileUrl(rows[0].asset_id, `The ${name} recording`);
    }
    return out;
  }

  // The video's transcript lines as stored: [{ startSec, endSec, text, speaker }].
  const storedCues = async (videoId) =>
    (await db.query('select start_sec, end_sec, text, speaker from transcript_cues where video_id = $1 order by idx', [videoId])).rows.map((c) => ({
      startSec: c.start_sec,
      endSec: c.end_sec,
      text: c.text,
      speaker: c.speaker,
    }));

  // The transcript in the original upload's times, by line.
  async function originalLines(v) {
    if (v.original_cues) return v.original_cues;
    return episodeEdit.toOriginal(v.edit_segments, await storedCues(v.id), ['startSec', 'endSec']);
  }

  // Moves the episode's chapters, cover frame and transcript from the current
  // video's times to those of the video made of the original's `segments`
  // (null: the original itself).
  async function retime(v, segments) {
    const move = episodeEdit.retimer(v.edit_segments, segments);
    const { rows } = await db.query('select id, chapters, thumbnail_sec from episodes where video_id = $1', [v.id]);
    for (const ep of rows) {
      const chapters = ep.chapters.map((c) => ({ ...c, startSec: move(c.startSec) })).filter((c) => c.startSec !== null);
      await db.query('update episodes set chapters = $2, thumbnail_sec = $3, tint = null, updated_at = now() where id = $1', [ep.id, JSON.stringify(chapters), move(ep.thumbnail_sec) ?? 0]);
    }
    let original = v.original_cues;
    if (v.transcript_status === 'ready') {
      original = await originalLines(v);
      const cues = episodeEdit.transcriptFor(segments, { words: v.transcript_words, lines: original });
      await db.query('delete from transcript_cues where video_id = $1', [v.id]);
      for (let i = 0; i < cues.length; i++) {
        await db.query('insert into transcript_cues (video_id, idx, start_sec, end_sec, text, speaker) values ($1, $2, $3, $4, $5, $6)', [
          v.id, i, cues[i].startSec, cues[i].endSec, cues[i].text, cues[i].speaker ?? null,
        ]);
      }
    }
    await db.query('update videos set edit_segments = $2, original_cues = $3 where id = $1', [
      v.id,
      segments ? JSON.stringify(segments) : null,
      segments && original ? JSON.stringify(original) : null,
    ]);
  }

  // The episode and its video, for editing; with why the video can't be
  // edited now, if it can't.
  async function editableEpisode(episodeId) {
    const { rows } = await db.query('select e.id as episode_id, e.status as episode_status, e.published_at, e.speakers, e.video_id from episodes e where e.id = $1', [episodeId]);
    const ep = rows[0];
    if (!ep) throw httpError(404, 'Episode not found');
    if (!ep.video_id) throw httpError(409, 'This episode has no uploaded video to edit');
    await syncVideos([ep.video_id]);
    const v = (await db.query('select * from videos where id = $1', [ep.video_id])).rows[0];
    const live = ep.episode_status === 'published' && ep.published_at && new Date(ep.published_at) <= new Date();
    const locked = live
      ? 'This episode is live. Unpublish it to edit the video, so nobody finds it missing while the new version is made.'
      : !v.unedited_asset_id && v.status !== 'ready'
        ? 'The video is still processing. Try again in a few minutes.'
        : null;
    return { ep, v, locked };
  }

  // The edit plan to start from: the saved one, or an empty one on the original.
  function planOf(v) {
    if (v.edit_plan) return plans.withDefaults(v.edit_plan);
    return plans.emptyPlan({ video: `video:${v.id}`, durationSec: v.duration_sec || 0, hasAudio: v.has_audio !== false });
  }

  // A plan's other recording (like a screen share): its video row.
  async function sourceVideo(plan, name) {
    const s = plan.sources[name];
    if (!s) throw httpError(404, `This edit has no ${name} recording`);
    const id = String(s.video).replace(/^video:/, '');
    await syncVideos([id]);
    const row = (await db.query('select * from videos where id = $1', [id])).rows[0];
    if (!row) throw httpError(404, `The ${name} recording is missing. Add it again.`);
    return row;
  }

  // Width and height for a "16:9"-style aspect ratio, until the real ones are
  // read from the file when the edit is made.
  function sizeOf(aspect) {
    const [a, b] = String(aspect || '16:9').split(':').map(Number);
    return { width: 1920, height: a > 0 && b > 0 ? Math.max(2, Math.round((1920 * b) / a / 2) * 2) : 1080 };
  }

  // Order-proof copy of a picture list, to tell whether it changed.
  const sameList = (a, b) => {
    const key = (l) => JSON.stringify(l.map((p) => [p.pictureId, p.kind, p.startSec, p.endSec, p.x, p.y, p.w]));
    return key(a) === key(b);
  };

  // Whether these pictures can go on this video (they're the uploader's, and
  // within the video); throws a readable reason if not.
  async function checkPictures(v, list) {
    if (v.edit_status === 'rendering') throw httpError(409, 'Your last change is still being added to the video. Try again in a minute.');
    // Once live, the video without pictures is gone, so they stay as they are.
    if (v.pictures.length && v.edit_status === 'ready' && !v.unedited_asset_id) throw httpError(409, 'Pictures can’t be changed once the Short has gone live');
    const ids = [...new Set(list.map((p) => p.pictureId))];
    const { rows } = await db.query("select id from pictures where id = any($1) and owner_id = $2 and status = 'ready'", [ids, v.owner_id]);
    if (rows.length !== ids.length) throw httpError(400, 'One of the pictures wasn’t found. Add it again.');
    const length = v.trim_start != null ? v.trim_end - v.trim_start : v.duration_sec;
    if (length && list.some((p) => p.startSec >= length)) throw httpError(400, 'A picture starts after the end of the video');
  }

  // Saves a video's pictures and starts making it again with them.
  async function setPictures(v, list) {
    await checkPictures(v, list);
    if (sameList(list, v.pictures) && v.edit_status !== 'failed') return;
    const status = list.length || v.unedited_asset_id ? 'queued' : 'none';
    await db.query('update videos set pictures = $2, edit_status = $3, edit_error = null where id = $1', [v.id, JSON.stringify(list), status]);
    if (status === 'queued') background(advanceEdit(v.id));
  }

  // Once a Short is live its pictures are fixed: the video without them and
  // the picture files go.
  async function dropUnedited(videoId) {
    const { rows } = await db.query(
      `update videos v set unedited_asset_id = null, unedited_playback_id = null
       from (select id, unedited_asset_id, pictures from videos where id = $1 for update) old
       where v.id = old.id returning old.unedited_asset_id, old.pictures`,
      [videoId]
    );
    const old = rows[0];
    if (!old) return;
    if (old.unedited_asset_id) await video.deleteAsset(old.unedited_asset_id).catch((e) => console.warn('delete unedited', old.unedited_asset_id, e.message));
    const ids = old.pictures.map((p) => p.pictureId);
    if (ids.length) await db.query('delete from pictures where id = any($1)', [ids]);
  }

  const pictureUrl = (id, baseUrl) => `${baseUrl}/api/pictures/${id}`;

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
        const { cues, words } = await transcriber.transcribe(video.audioUrl(v.playback_id));
        if (!cues.length) return setStatus('unavailable');
        await storeCues(cues, transcriber.model, words);
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

    async function storeCues(cues, source, words = null) {
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
      // For the video editor: in the original upload's times when this video
      // is an edit of it, and word by word when the service gives words.
      const segments = v.edit_segments;
      const original = segments ? episodeEdit.toOriginal(segments, cues, ['startSec', 'endSec']) : null;
      const byWord = words?.length ? episodeEdit.toOriginal(segments, words, ['start', 'end']) : null;
      await db.query('update videos set transcript_source = $2, original_cues = $3, transcript_words = $4 where id = $1', [
        v.id,
        source,
        original && JSON.stringify(original),
        byWord && JSON.stringify(byWord),
      ]);
      Object.assign(v, { transcript_source: source, original_cues: original, transcript_words: byWord });
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
    const { rows: rejectedEpisodes } = await db.query(
      `select id from episodes where author_id is not null and status = 'rejected' and updated_at < now() - interval '${KEEP_DAYS} days'`
    );
    for (const r of rejectedEpisodes) await removeEpisode(r.id);
    const { rows: unposted } = await db.query(
      `delete from videos v where owner_id is not null and created_at < now() - interval '${KEEP_DAYS} days'
       and not exists (select 1 from shorts s where s.video_id = v.id)
       and not exists (select 1 from episodes e where e.video_id = v.id) returning asset_id, source_asset_id, unedited_asset_id`
    );
    await deleteAssets(unposted);
    // Picture files nothing uses (never posted, or their video was deleted).
    await db.query(
      `delete from pictures p where p.created_at < now() - interval '1 day'
       and not exists (select 1 from videos v where v.pictures @> jsonb_build_array(jsonb_build_object('pictureId', p.id)))`
    );
  }

  // The video service's files for deleted video rows (and any uncut original,
  // or copy without pictures).
  async function deleteAssets(rows) {
    const ids = rows.flatMap((r) => [r.asset_id, r.source_asset_id, r.unedited_asset_id]).filter(Boolean);
    await Promise.all(ids.map((id) => video.deleteAsset(id).catch((e) => console.warn('delete asset', id, e.message))));
  }

  // A Short and everything hanging off it: likes, views, comments, its video.
  async function removeShort(id) {
    const { rows } = await db.query('delete from shorts where id = $1 returning video_id', [id]);
    for (const table of ['likes', 'views', 'comments', 'content_reports']) await db.query(`delete from ${table} where item_type = 'short' and item_id = $1`, [id]);
    if (rows[0]?.video_id) {
      const { rows: vids } = await db.query('delete from videos where id = $1 returning asset_id, source_asset_id, unedited_asset_id', [rows[0].video_id]);
      await deleteAssets(vids);
    }
  }

  // An episode and everything hanging off it. Shorts cut from it stay, unlinked.
  async function removeEpisode(id) {
    const { rows: plansOf } = await db.query('select v.edit_plan from episodes e join videos v on v.id = e.video_id where e.id = $1', [id]);
    for (const s of Object.values(plansOf[0]?.edit_plan?.sources || {})) await removeVideo(String(s.video).replace(/^video:/, ''));
    const { rows } = await db.query('delete from episodes where id = $1 returning video_id', [id]);
    for (const table of ['likes', 'views', 'comments', 'content_reports']) await db.query(`delete from ${table} where item_type = 'episode' and item_id = $1`, [id]);
    if (rows[0]?.video_id) {
      const { rows: vids } = await db.query('delete from videos where id = $1 returning asset_id, source_asset_id, unedited_asset_id', [rows[0].video_id]);
      await deleteAssets(vids);
    }
  }

  // A video row and its files at the video service.
  async function removeVideo(id) {
    const { rows } = await db.query('delete from videos where id = $1 returning asset_id, source_asset_id, unedited_asset_id', [id]);
    await deleteAssets(rows);
  }

  async function ownEpisode(userId, id) {
    const { rows } = await db.query(`${EPISODE_SELECT} where e.id = $1 and e.author_id = $2`, [id, userId]);
    if (!rows[0]) throw httpError(404, 'Episode not found');
    return rows[0];
  }

  // A Short someone posted, if it's theirs.
  async function ownShort(userId, id) {
    const { rows } = await db.query(`${SHORT_SELECT} where s.id = $1 and s.author_id = $2`, [id, userId]);
    if (!rows[0]) throw httpError(404, 'Short not found');
    return rows[0];
  }

  const cuesOf = async (videoId) =>
    (await db.query('select start_sec, end_sec, text from transcript_cues where video_id = $1 order by idx', [videoId])).rows.map((c) => ({
      startSec: c.start_sec,
      endSec: c.end_sec,
      text: c.text,
    }));

  // A Short's captions: its own video's lines (generated, or fixed by a
  // person), else the episode's lines for the part it was cut from. Asks the
  // video service to make captions when there are none yet.
  async function captionsOf(s) {
    const v = s.video_id && (await db.query('select * from videos where id = $1', [s.video_id])).rows[0];
    if (v?.transcript_status === 'ready') return { status: 'ready', source: v.transcript_source, cues: await cuesOf(v.id) };
    if (s.episode_id && s.start_sec != null && s.end_sec != null) {
      const { rows } = await db.query(
        `select c.start_sec, c.end_sec, c.text from transcript_cues c join episodes e on e.video_id = c.video_id
         where e.id = $1 and c.end_sec > $2 and c.start_sec < $3 order by c.idx`,
        [s.episode_id, s.start_sec, s.end_sec]
      );
      const len = s.end_sec - s.start_sec;
      const at = (sec) => Math.round(Math.min(len, Math.max(0, sec - s.start_sec)) * 100) / 100;
      if (rows.length) return { status: 'ready', source: 'episode', cues: rows.map((c) => ({ startSec: at(c.start_sec), endSec: at(c.end_sec), text: c.text })) };
    }
    if (!v) return { status: 'unavailable', source: null, cues: [] };
    const status = await ensureTranscript(v);
    return status === 'ready' ? { status, source: v.transcript_source, cues: await cuesOf(v.id) } : { status, source: null, cues: [] };
  }

  // Lines a person checked replace the generated ones for good.
  async function saveCaptions(videoId, cues) {
    await db.query('delete from transcript_cues where video_id = $1', [videoId]);
    for (let i = 0; i < cues.length; i++) {
      await db.query('insert into transcript_cues (video_id, idx, start_sec, end_sec, text) values ($1, $2, $3, $4, $5)', [
        videoId,
        i,
        cues[i].startSec,
        cues[i].endSec,
        cues[i].text,
      ]);
    }
    await db.query("update videos set transcript_status = 'ready', transcript_source = 'edited' where id = $1", [videoId]);
  }

  async function findShort(id, { host = false, userId } = {}) {
    const { rows } = await db.query(`select s.*, ${live('s')} as live from shorts s where s.id = $1`, [id]);
    const s = rows[0];
    if (!s || !(host || s.live || (userId && s.author_id === userId))) throw httpError(404, 'Short not found');
    return s;
  }

  async function ownUpload(userId, videoId) {
    const { rows } = await db.query('select * from videos where id = $1', [videoId]);
    if (!rows[0] || rows[0].owner_id !== userId || rows[0].wants_audio) throw httpError(404, 'Upload not found');
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
      const unchecked = rows.filter((r) => r.author_id && r.status === 'in_review' && r.video_id && !['ready', 'unavailable'].includes(r.suggest_status));
      if (pending.length || unchecked.length) {
        await syncVideos(pending.map((r) => r.video_id));
        await Promise.all(unchecked.map((r) => advanceUpload(r.video_id).catch((e) => console.warn('advance', r.video_id, e.message))));
        ({ rows } = await db.query(`${EPISODE_SELECT} order by e.created_at desc`));
      }
      return rows.map((r) => toManagedEpisode(r, baseUrl));
    },

    async hostShorts(baseUrl) {
      await cleanUp().catch((e) => console.warn('clean up', e.message));
      let { rows } = await db.query(`${SHORT_SELECT} order by s.created_at desc`);
      const pending = rows.filter((r) => r.video_id && (!['ready', 'errored'].includes(r.video_status) || editBusy(r.edit_status)));
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

    // What the website's video editor needs: the plan, the original upload to
    // play (plan times are its times), its transcript in those times, and
    // where making the edit has got to.
    async episodeEdit(episodeId) {
      const { ep, v, locked } = await editableEpisode(episodeId);
      const plan = planOf(v);
      const playback = v.unedited_playback_id || v.playback_id;
      const lines = v.transcript_status === 'ready' ? await originalLines(v) : [];
      const rendered = v.edit_rendered ? plans.withDefaults(v.edit_rendered) : null;
      const same = (a, b) => ['cuts', 'texts', 'scenes', 'zooms'].every((k) => JSON.stringify(plans.included(a, { suggestions: false })[k]) === JSON.stringify(b ? plans.included(b, { suggestions: false })[k] : []));
      return {
        plan,
        videoUrl: playback ? video.hlsUrl(playback) : null,
        posterUrl: playback ? video.thumbnailUrl(playback, 0) : null,
        durationSec: plan.source.durationSec,
        locked,
        edit: {
          status: v.edit_plan || v.edit_rendered ? v.edit_status : 'none',
          error: v.edit_error,
          // Saved changes the current video doesn't have yet.
          changed: !same(plan, rendered),
          // The new video is made but still processing at the video service.
          processing: v.edit_status === 'ready' && v.status !== 'ready',
        },
        transcript: {
          status: v.transcript_status,
          lines,
          // Word by word ([text, start, end]) when the speech-to-text service made it.
          words: v.transcript_words ? v.transcript_words.map((w) => [w.word, w.start, w.end]) : null,
          speakers: ep.speakers || {},
        },
        pauses: v.pauses,
        // Other recordings (like the screen share), to play beside the original.
        sources: Object.fromEntries(
          await Promise.all(
            Object.entries(plan.sources).map(async ([name, s]) => {
              const row = await sourceVideo(plan, name).catch(() => null);
              return [name, { videoId: String(s.video).replace(/^video:/, ''), url: row?.playback_id ? video.hlsUrl(row.playback_id) : null, offsetSec: s.offsetSec, durationSec: s.durationSec }];
            })
          )
        ),
      };
    },

    // Adds (or replaces) another recording of the episode, like the screen
    // share, once it's uploaded and processed. offsetSec: where it starts on
    // the original's clock.
    async setEditSource(episodeId, name, { videoId, offsetSec = 0 }) {
      const { v, locked } = await editableEpisode(episodeId);
      if (locked) throw httpError(409, locked);
      if (videoId === v.id) throw httpError(400, 'That’s the episode’s own video');
      await syncVideos([videoId]);
      const row = (await db.query('select * from videos where id = $1', [videoId])).rows[0];
      if (!row) throw httpError(404, 'Recording not found');
      if (row.status === 'errored') throw httpError(409, `The recording couldn’t be processed: ${row.error || 'unknown error'}`);
      if (row.status !== 'ready') throw httpError(409, 'The recording is still processing. Try again in a minute.');
      const plan = planOf(v);
      const old = plan.sources[name];
      let next;
      try {
        next = plans.addSource(plan, name, { video: `video:${row.id}`, durationSec: row.duration_sec, ...sizeOf(row.aspect_ratio), offsetSec });
      } catch (e) {
        throw httpError(400, e.message);
      }
      const { errors } = plans.validate(next.plan);
      if (errors.length) throw httpError(400, errors.join('\n'));
      await db.query('update videos set edit_plan = $2 where id = $1', [v.id, JSON.stringify(next.plan)]);
      if (old && old.video !== `video:${row.id}`) await removeVideo(String(old.video).replace(/^video:/, ''));
      return { plan: next.plan };
    },

    // Takes a recording out of the edit, with the layouts and zooms using it.
    async removeEditSource(episodeId, name) {
      const { v, locked } = await editableEpisode(episodeId);
      if (locked) throw httpError(409, locked);
      const plan = planOf(v);
      const s = plan.sources[name];
      if (!s) throw httpError(404, `This edit has no ${name} recording`);
      const { [name]: _, ...sources } = plan.sources;
      const next = { ...plan, sources, scenes: plan.scenes.filter((x) => (x.source || 'screen') !== name || x.layout === plans.MAIN), zooms: plan.zooms.filter((z) => z.source !== name) };
      await db.query('update videos set edit_plan = $2 where id = $1', [v.id, JSON.stringify(next)]);
      await removeVideo(String(s.video).replace(/^video:/, ''));
      return { plan: next };
    },

    // When a recording (the screen share) is blank, and when its picture
    // changes a lot (a new slide or window), on the original's clock. Found once.
    async editSourceActivity(episodeId, name) {
      const { v } = await editableEpisode(episodeId);
      const plan = planOf(v);
      const row = await sourceVideo(plan, name);
      const offset = plan.sources[name].offsetSec || 0;
      let found = row.activity;
      if (!found) {
        if (!engine) throw httpError(503, 'Editing videos isn’t set up on this server');
        if (!row.asset_id || row.status !== 'ready') throw httpError(409, 'The recording is still processing. Try again in a minute.');
        found = await engine.activity(await fileUrl(row.asset_id, 'The recording'));
        await db.query('update videos set activity = $2 where id = $1', [row.id, JSON.stringify(found)]);
      }
      const at = (t) => Math.round((t + offset) * 1000) / 1000;
      return { blank: found.blank.map((b) => ({ from: at(b.from), to: at(b.to) })), changes: found.changes.map(at) };
    },

    // Saves the plan the website sent (see episode-edit.js); doesn't make it.
    async saveEpisodeEdit(episodeId, input) {
      const { v, locked } = await editableEpisode(episodeId);
      if (locked) throw httpError(409, locked);
      const { plan, warnings } = episodeEdit.fromWebsite(input, planOf(v));
      await db.query('update videos set edit_plan = $2 where id = $1', [v.id, JSON.stringify(plan)]);
      return { plan, warnings };
    },

    // Starts making the edited video from the saved plan.
    async makeEpisodeEdit(episodeId) {
      const { v, locked } = await editableEpisode(episodeId);
      if (locked) throw httpError(409, locked);
      if (editBusy(v.edit_status)) throw httpError(409, 'The edit is already being made');
      if (v.edit_status === 'ready' && v.status !== 'ready') throw httpError(409, 'The last edit is still processing. Try again in a few minutes.');
      if (!v.edit_plan || (!episodeEdit.changesVideo(v.edit_plan) && !v.unedited_asset_id)) throw httpError(400, 'There’s nothing to change yet');
      await db.query("update videos set edit_status = 'queued', edit_error = null where id = $1", [v.id]);
      if (editWorker !== 'external') background(advanceEdit(v.id));
      return { status: 'queued' };
    },

    // Quiet stretches of the original upload, worth cutting: [{ from, to, durationSec }].
    async episodePauses(episodeId) {
      const { v } = await editableEpisode(episodeId);
      if (v.pauses) return v.pauses;
      if (v.has_audio === false) return [];
      if (!engine) throw httpError(503, 'Editing videos isn’t set up on this server');
      const playback = v.unedited_playback_id || v.playback_id;
      if (!playback || !v.audio_ready) throw httpError(409, 'The audio is still being prepared. Try again in a minute.');
      const pauses = await engine.silences(video.audioUrl(playback), { minSec: 1 });
      await db.query('update videos set pauses = $2 where id = $1', [v.id, JSON.stringify(pauses)]);
      return pauses;
    },

    // For the edit worker: makes every edit waiting to be made (or cut off
    // part-way), one at a time. Returns how many it tried.
    async makeQueuedEdits() {
      const { rows } = await db.query(
        `select id from videos where edit_status = 'queued' or (edit_status = 'rendering' and edit_started_at < now() - interval '6 minutes') order by created_at`
      );
      for (const r of rows) {
        await syncVideos([r.id]).catch(() => {});
        await advanceEdit(r.id).catch((e) => console.warn('edit worker', r.id, e.message));
      }
      return rows.length;
    },

    // kind 'screen': another recording for an episode's edit (like a screen
    // share), which needs no audio file or captions of its own.
    async createUpload({ kind }) {
      const { uploadId, uploadUrl } = await video.createUpload(kind === 'screen' ? { audio: false, captions: false } : { audio: kind === 'episode' });
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
        reviewNote: 'review_note',
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
    async createUserUpload(userId, { kind = 'short', startSec, endSec }) {
      const me = await this.profile(userId);
      if (!me.name || !me.acceptedGuidelines) throw httpError(403, 'Add your name and agree to the guidelines first');
      await cleanUp().catch((e) => console.warn('clean up', e.message));
      const { uploadId, uploadUrl } = await video.createUpload({ audio: kind === 'episode', captions: startSec == null }).catch((e) => {
        // The video service's storage is full (e.g. a plan's video limit).
        if (/limit/i.test(e.message)) throw httpError(503, 'Posting is paused because video storage is full. Please try again later.');
        throw e;
      });
      const id = newId('vid');
      await db.query(
        `insert into videos (id, provider, upload_id, status, owner_id, trim_start, trim_end, wants_audio) values ($1, $2, $3, 'uploading', $4, $5, $6, $7)`,
        [id, video.name, uploadId, userId, startSec ?? null, endSec ?? null, kind === 'episode']
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
        `delete from videos v where id = $1 and owner_id = $2 and not exists (select 1 from shorts s where s.video_id = v.id)
         and not exists (select 1 from episodes e where e.video_id = v.id) returning asset_id, source_asset_id, unedited_asset_id`,
        [videoId, userId]
      );
      if (!rows[0]) throw httpError(404, 'Upload not found');
      await deleteAssets(rows);
    },

    async createUserShort(userId, { videoId, title, description = '', tags = [], coverSec = null, pictures = [] }) {
      const { rows } = await db.query('select * from videos where id = $1', [videoId]);
      const v = rows[0];
      if (!v || v.owner_id !== userId || v.wants_audio) throw httpError(404, 'Upload not found');
      // Sent twice (e.g. the first reply was lost): it's already posted.
      const { rows: existing } = await db.query('select id, author_id from shorts where video_id = $1', [videoId]);
      if (existing[0]) {
        if (existing[0].author_id === userId) return existing[0].id;
        throw httpError(409, 'This video is already posted');
      }
      if (v.status === 'ready' && v.duration_sec > MAX_SHORT_SEC + 0.5) throw httpError(400, `A Short can be at most ${MAX_SHORT_SEC} seconds`);
      if (pictures.length) await checkPictures(v, pictures);
      const id = newId('sh');
      await db.query(
        `insert into shorts (id, title, description, status, source, video_id, tags, cover_sec, author_id, created_by)
         values ($1, $2, $3, 'in_review', 'upload', $4, $5, $6, $7, $7)`,
        [id, title, description, videoId, tags, coverSec, userId]
      );
      if (pictures.length) await setPictures(v, pictures);
      return id;
    },

    async createUserEpisode(userId, { videoId, title, description = '', tags = [], thumbnailSec = null }) {
      const { rows } = await db.query('select * from videos where id = $1', [videoId]);
      const v = rows[0];
      if (!v || v.owner_id !== userId || !v.wants_audio) throw httpError(404, 'Upload not found');
      // Sent twice (e.g. the first reply was lost): it's already posted.
      const { rows: existing } = await db.query('select id from episodes where video_id = $1 and author_id = $2', [videoId, userId]);
      if (existing[0]) return existing[0].id;
      const id = newId('ep');
      await db.query(
        `insert into episodes (id, title, description, status, tags, video_id, thumbnail_sec, author_id, created_by)
         values ($1, $2, $3, 'in_review', $4, $5, $6, $7, $7)`,
        [id, title, description, tags, videoId, thumbnailSec ?? v.suggestions?.coverSec ?? 0, userId]
      );
      return id;
    },

    async myEpisodes(userId, baseUrl) {
      let { rows } = await db.query(`${EPISODE_SELECT} where e.author_id = $1 order by e.created_at desc`, [userId]);
      const pending = rows.filter((r) => r.video_id && !['ready', 'errored'].includes(r.video_status));
      if (pending.length) {
        await syncVideos(pending.map((r) => r.video_id));
        ({ rows } = await db.query(`${EPISODE_SELECT} where e.author_id = $1 order by e.created_at desc`, [userId]));
      }
      return rows.map((r) => ({ ...toManagedEpisode(r, baseUrl), aiCheck: undefined, ai: undefined }));
    },

    async updateMyEpisode(userId, id, fields) {
      const row = await ownEpisode(userId, id);
      if (row.status !== 'in_review') throw httpError(409, 'Only episodes still in review can be edited');
      return update('episodes', id, fields, { title: 'title', description: 'description', tags: 'tags', thumbnailSec: 'thumbnail_sec' });
    },

    async deleteMyEpisode(userId, id) {
      await ownEpisode(userId, id);
      await removeEpisode(id);
    },

    async myShorts(userId, baseUrl) {
      let { rows } = await db.query(`${SHORT_SELECT} where s.author_id = $1 order by s.created_at desc`, [userId]);
      const pending = rows.filter((r) => r.video_id && (!['ready', 'errored'].includes(r.video_status) || editBusy(r.edit_status)));
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

    // ---- Pictures in Shorts ----

    async createPicture(userId) {
      // Unguessable, since anyone with the link can see the picture.
      const id = `pic_${crypto.randomBytes(12).toString('hex')}`;
      await db.query('insert into pictures (id, owner_id) values ($1, $2)', [id, userId]);
      return { id };
    },

    // The next piece of a picture's file. offset is how much was sent before,
    // so a piece sent twice (a lost reply) isn't added twice.
    async addPictureData(userId, id, offset, data) {
      const { rows } = await db.query(
        `update pictures set data = data || $4::bytea where id = $1 and owner_id = $2 and status = 'uploading'
         and octet_length(data) = $3 and octet_length(data) + $5 <= $6 returning octet_length(data) as size`,
        [id, userId, offset, data, data.length, MAX_PICTURE_BYTES]
      );
      if (rows[0]) return { received: rows[0].size };
      const { rows: cur } = await db.query('select octet_length(data) as size, status from pictures where id = $1 and owner_id = $2', [id, userId]);
      if (!cur[0] || cur[0].status !== 'uploading') throw httpError(404, 'Picture not found');
      if (cur[0].size === offset + data.length) return { received: cur[0].size };
      if (cur[0].size === offset) throw httpError(413, `That picture is too big (at most ${MAX_PICTURE_BYTES >> 20} MB)`);
      throw httpError(409, `Send the piece from ${cur[0].size}`);
    },

    // All of it is in: checked and made a sensible size.
    async finishPicture(userId, id, baseUrl) {
      const { rows } = await db.query('select status, data, width, height from pictures where id = $1 and owner_id = $2', [id, userId]);
      const row = rows[0];
      if (!row) throw httpError(404, 'Picture not found');
      if (row.status !== 'ready') {
        if (!editor) throw httpError(503, 'Adding pictures isn’t set up on this server');
        if (!row.data.length) throw httpError(400, 'The picture is empty');
        const pic = await editor.normalizePicture(Buffer.from(row.data));
        await db.query("update pictures set data = $2, mime = $3, width = $4, height = $5, status = 'ready' where id = $1", [id, pic.data, pic.mime, pic.width, pic.height]);
        Object.assign(row, pic);
      }
      return { id, url: pictureUrl(id, baseUrl), width: row.width, height: row.height };
    },

    async pictureFile(id) {
      const { rows } = await db.query("select mime, data from pictures where id = $1 and status = 'ready'", [id]);
      return rows[0] ? { mime: rows[0].mime, data: Buffer.from(rows[0].data) } : null;
    },

    // A Short's pictures for its uploader's editor, with the video to place
    // them on (the one without pictures).
    async myShortPictures(userId, id, baseUrl) {
      const s = await ownShort(userId, id);
      // Moves processing along too, as the uploader's screen checks back.
      if (s.video_id) await syncVideos([s.video_id]);
      const v = s.video_id && (await db.query('select * from videos where id = $1', [s.video_id])).rows[0];
      if (!v) throw httpError(404, 'This Short has no video of its own');
      const ids = v.pictures.map((p) => p.pictureId);
      const { rows: files } = await db.query('select id, width, height from pictures where id = any($1)', [ids]);
      const byId = new Map(files.map((f) => [f.id, f]));
      const locked = v.pictures.length > 0 && v.edit_status === 'ready' && !v.unedited_asset_id;
      const unedited = locked ? null : v.unedited_playback_id || (v.unedited_asset_id ? null : v.playback_id);
      return {
        videoUrl: unedited && video.hlsUrl(unedited),
        durationSec: v.duration_sec,
        aspectRatio: v.aspect_ratio,
        editable: s.status === 'in_review' && !locked,
        edit: { status: v.edit_status, error: v.edit_error },
        pictures: v.pictures
          .filter((p) => byId.has(p.pictureId))
          .map((p) => {
            const f = byId.get(p.pictureId);
            return { ...p, picture: { id: f.id, url: pictureUrl(f.id, baseUrl), width: f.width, height: f.height } };
          }),
      };
    },

    // Uploaders can change the pictures while the Short waits for review.
    async setMyShortPictures(userId, id, list, baseUrl) {
      const s = await ownShort(userId, id);
      if (s.status !== 'in_review') throw httpError(409, 'Only Shorts still in review can be edited');
      const v = s.video_id && (await db.query('select * from videos where id = $1', [s.video_id])).rows[0];
      if (!v) throw httpError(404, 'This Short has no video of its own');
      await setPictures(v, list);
      return this.myShortPictures(userId, id, baseUrl);
    },

    // ---- Captions on Shorts ----

    // who: {} for a viewer (live Shorts only), { userId } adds their own, { host: true } any.
    async shortCaptions(id, who) {
      return captionsOf(await findShort(id, who));
    },

    // Uploaders can fix their captions while the Short waits for review; hosts any time.
    async setShortCaptions(id, cues, who) {
      const s = await findShort(id, who);
      if (!who.host && (s.author_id !== who.userId || s.status !== 'in_review')) throw httpError(409, 'Only Shorts still in review can be edited');
      if (!s.video_id) throw httpError(409, 'This Short’s captions come from its episode’s transcript');
      await saveCaptions(s.video_id, cues);
      return captionsOf(s);
    },

    // Captions of an upload not posted yet, so they can be checked before posting.
    async uploadCaptions(userId, videoId) {
      return captionsOf({ video_id: (await ownUpload(userId, videoId)).id });
    },

    async setUploadCaptions(userId, videoId, cues) {
      const v = await ownUpload(userId, videoId);
      const { rows } = await db.query('select id from shorts where video_id = $1', [videoId]);
      if (rows[0]) return this.setShortCaptions(rows[0].id, cues, { userId });
      await saveCaptions(v.id, cues);
      return captionsOf({ video_id: v.id });
    },

    // The AI's fixes for caption lines, for the person to accept or not (nothing is saved).
    async tidyCaptions({ cues, title, description, tags }) {
      if (!ai?.fixCaptions) throw httpError(503, 'AI isn’t set up on this server');
      if (!cues.length) return { cues };
      const lines = cues.map((c) => c.text);
      const fixed = cleanCaptionFix(await ai.fixCaptions({ title, description, tags, lines }), lines);
      return { cues: cues.map((c, i) => ({ ...c, text: fixed[i] })) };
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
      if (fields.status !== 'rejected' && fields.reviewNote === undefined) set.review_note = null;
      if (fields.status === 'published') {
        if (row.video_id) await syncVideos([row.video_id]);
        const { rows: vs } = row.video_id ? await db.query('select * from videos where id = $1', [row.video_id]) : { rows: [] };
        const v = vs[0];
        if (v && v.status !== 'ready') throw httpError(409, 'The video is still processing');
        if (v && table === 'episodes' && !v.audio_ready && v.has_audio !== false) throw httpError(409, 'The audio version is still processing');
        if (v && table === 'shorts' && v.duration_sec > MAX_SHORT_SEC + 0.5) {
          throw httpError(400, `A Short can be at most ${MAX_SHORT_SEC} seconds`);
        }
        if (v && editBusy(v.edit_status)) throw httpError(409, table === 'episodes' ? 'The edited video is still being made. Try again once it’s ready.' : 'The pictures are still being added to the video. Try again in a minute.');
        // Approving it answers any reports.
        await db.query('delete from content_reports where item_type = $1 and item_id = $2', [table === 'episodes' ? 'episode' : 'short', id]);
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
    if (table === 'shorts' && set.status === 'published' && row.video_id) await dropUnedited(row.video_id);
    return true;
  }
}

// json_agg comes back parsed from Postgres, as text from some drivers.
function parseReports(value) {
  return typeof value === 'string' ? JSON.parse(value) : value || [];
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

module.exports = { createStore, httpError, MAX_SHORT_SEC, KEEP_DAYS };
