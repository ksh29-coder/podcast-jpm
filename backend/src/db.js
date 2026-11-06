const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'data', 'episodes.json');

// Every episode and Short moves through these. Hosts can publish directly;
// Shorts from everyone else stop at in_review until a host approves them.
const STATUSES = ['draft', 'in_review', 'published', 'rejected'];

// Things viewers can like, view and comment on.
const ITEM_TYPES = ['episode', 'short'];

const SCHEMA = `
create table if not exists videos (
  id text primary key,
  provider text not null,
  upload_id text,
  asset_id text,
  playback_id text,
  status text not null check (status in ('uploading', 'processing', 'ready', 'errored')),
  -- Episodes also need an audio-only file for audio mode.
  wants_audio boolean not null default false,
  audio_ready boolean not null default false,
  duration_sec double precision,
  aspect_ratio text,
  error text,
  created_at timestamptz not null default now()
);
alter table videos add column if not exists wants_audio boolean not null default false;
-- false when the video has no sound: no audio file is made, and the episode
-- is video-only.
alter table videos add column if not exists has_audio boolean;

create table if not exists episodes (
  id text primary key,
  title text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'rejected')),
  published_at timestamptz,
  -- Static media (the seeded episodes). Uploaded episodes use video_id instead.
  duration_sec double precision,
  artwork_url text,
  audio_url text,
  video_url text,
  video_id text references videos(id),
  thumbnail_sec double precision not null default 0,
  chapters jsonb not null default '[]',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shorts (
  id text primary key,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'rejected')),
  published_at timestamptz,
  source text not null check (source in ('episode', 'upload')),
  -- Where the Short sits in its episode, for "play full episode from here".
  -- Uploaded Shorts may have no episode.
  episode_id text references episodes(id) on delete set null,
  start_sec double precision,
  end_sec double precision,
  video_url text,
  video_id text references videos(id),
  -- Horizontal point (0 left, 1 right) to keep in view when a wide video is
  -- shown full-screen in the vertical Shorts feed.
  focus_x double precision not null default 0.5,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table episodes add column if not exists tags text[] not null default '{}';
-- Backdrop color picked from the artwork; worked out on first read, cleared
-- when the cover frame changes.
alter table episodes add column if not exists tint text;
-- AI suggestions for hosts (summary, chapters, tags, mentions, Shorts), and
-- the parts a host has approved for listeners.
alter table episodes add column if not exists ai jsonb;
alter table episodes add column if not exists summary text;
alter table episodes add column if not exists mentions jsonb not null default '[]';
alter table shorts add column if not exists tags text[] not null default '{}';

-- Transcript: generated captions, stored line by line for the follow-along
-- view and for search. Status: none (not asked yet), generating, ready,
-- unavailable (no sound, or the service couldn't make one).
alter table videos add column if not exists transcript_status text not null default 'none';
-- Which engine made the transcript: 'mux' (Whisper captions) or the model
-- id of the speech-to-text service (better, with speakers).
alter table videos add column if not exists transcript_source text;
alter table videos add column if not exists transcript_started_at timestamptz;
create table if not exists transcript_cues (
  video_id text not null references videos(id) on delete cascade,
  idx int not null,
  start_sec double precision not null,
  end_sec double precision not null,
  text text not null,
  primary key (video_id, idx)
);
-- 0, 1, 2… from speaker detection; null when unknown.
alter table transcript_cues add column if not exists speaker int;
-- Names for those speakers, set by a host (often from AI suggestions): {"0": "Kai"}.
alter table episodes add column if not exists speakers jsonb not null default '{}';

-- Where each person (device, until sign-in) got to in each episode, so they
-- can resume anywhere; max_sec is the furthest they've reached, for hosts'
-- "how far people got" view.
create table if not exists progress (
  user_id text not null,
  episode_id text not null references episodes(id) on delete cascade,
  position_sec double precision not null,
  max_sec double precision not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);

-- Wrong host-passcode guesses per network address, for the lockout.
create table if not exists host_attempts (
  key text primary key,
  failures int not null,
  window_start timestamptz not null,
  locked_until timestamptz
);

-- One like per person (device, until sign-in) per episode or Short.
create table if not exists likes (
  item_type text not null check (item_type in ('episode', 'short')),
  item_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (item_type, item_id, user_id)
);

-- Views count each person once per episode or Short.
create table if not exists views (
  item_type text not null check (item_type in ('episode', 'short')),
  item_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (item_type, item_id, user_id)
);

-- Comments go up straight away (status approved). A reported one goes back to
-- pending, hidden until a host looks at it. Older comments may still be
-- pending from when every comment waited for a host.
create table if not exists comments (
  id text primary key,
  item_type text not null check (item_type in ('episode', 'short')),
  item_id text not null,
  user_id text not null,
  author_name text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists comments_item on comments (item_type, item_id, status);
-- Optional moment in the episode the comment is about.
alter table comments add column if not exists at_sec double precision;
-- Replies, one level deep like YouTube: parent_id is the top-level comment
-- of the thread, reply_to_id the comment answered (the parent, or a reply in
-- it). Its author is the one told about the reply.
alter table comments add column if not exists parent_id text references comments(id) on delete cascade;
alter table comments add column if not exists reply_to_id text references comments(id) on delete set null;
create index if not exists comments_reply_to on comments (reply_to_id);

-- When each person last looked at their Activity (in Me); newer things are
-- unread.
create table if not exists activity_seen (
  user_id text primary key,
  seen_at timestamptz not null default now()
);

-- Phone alerts (Expo push). Each phone's token, who it belongs to, which
-- kinds of alert they want (all on until they turn one off), and alerts
-- already sent, so each goes once and comment alerts at most every few minutes.
create table if not exists push_tokens (
  token text primary key,
  user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on push_tokens (user_id);
create table if not exists push_settings (
  user_id text primary key,
  replies boolean not null default true,
  comments boolean not null default true,
  reviews boolean not null default true,
  episodes boolean not null default true
);
create table if not exists push_sent (
  key text primary key,
  sent_at timestamptz not null default now()
);

-- Reports of comments by viewers. A reported comment is hidden until a host
-- looks at it again (approve to show it, reject to keep it hidden).
create table if not exists comment_reports (
  comment_id text not null references comments(id) on delete cascade,
  user_id text not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- Everyone can post Shorts from the app (the ＋ tab). They wait in_review
-- until a host approves them. A profile holds the name shown on someone's
-- Shorts and when they agreed to the posting guidelines.
create table if not exists profiles (
  user_id text primary key,
  name text not null,
  guidelines_at timestamptz,
  updated_at timestamptz not null default now()
);
-- Who uploaded a video, and the part of it to keep: once the upload is in,
-- the video service cuts that range into a new video and the original is
-- deleted, so nothing outside it is kept.
alter table videos add column if not exists owner_id text;
alter table videos add column if not exists trim_start double precision;
alter table videos add column if not exists trim_end double precision;
-- The uncut upload, kept until the cut video is ready (it's made from it).
alter table videos add column if not exists source_asset_id text;
-- AI suggestions for the uploader's details screen (title, description,
-- tags, cover frame) and a check for the host. Status: none, generating,
-- ready, unavailable (no speech to read).
alter table videos add column if not exists suggest_status text not null default 'none';
alter table videos add column if not exists suggest_started_at timestamptz;
alter table videos add column if not exists suggestions jsonb;
-- null for Shorts made by hosts.
alter table shorts add column if not exists author_id text;
alter table shorts add column if not exists description text not null default '';
alter table shorts add column if not exists cover_sec double precision;
-- Why a host didn't approve it, shown to the uploader.
alter table shorts add column if not exists review_note text;
-- Episodes can be posted by anyone from the website too, and wait in_review
-- the same way. null author for episodes hosts made.
alter table episodes add column if not exists author_id text;
alter table episodes add column if not exists review_note text;

-- Reports of episodes and Shorts by viewers. A reported post from the app or
-- website is hidden (back in review) until a host looks at it; a host's own
-- episode or Short stays up but is flagged for them. Approving clears them.
create table if not exists content_reports (
  item_type text not null check (item_type in ('episode', 'short')),
  item_id text not null,
  user_id text not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (item_type, item_id, user_id)
);

-- Seconds each person talked with the voice assistant each day, for the daily limit.
create table if not exists voice_usage (
  user_id text not null,
  day date not null,
  seconds int not null,
  primary key (user_id, day)
);

-- Pictures an uploader adds to their Short, drawn into the video with
-- ffmpeg (edit.js): [{ pictureId, kind, startSec, endSec, x, y, w }], kind
-- 'overlay' (on top) or 'full' (filling it). edit_status: none, queued
-- (to make), rendering, ready (in the video), failed.
alter table videos add column if not exists pictures jsonb not null default '[]';
alter table videos add column if not exists edit_status text not null default 'none';
alter table videos add column if not exists edit_started_at timestamptz;
alter table videos add column if not exists edit_error text;
-- The video without the pictures, kept to make it again when they change,
-- until the Short goes live.
alter table videos add column if not exists unedited_asset_id text;
alter table videos add column if not exists unedited_playback_id text;
-- The picture files, sent in pieces (status uploading), then checked and
-- made a sensible size (ready). Deleted once a Short goes live, and when
-- nothing has used them for a day.
create table if not exists pictures (
  id text primary key,
  owner_id text not null,
  status text not null default 'uploading',
  data bytea not null default '',
  mime text,
  width int,
  height int,
  created_at timestamptz not null default now()
);

-- Editing an episode's video on the website (episode-edit.js): edit_plan is
-- the wave-edit plan, in the times of the original upload (kept as
-- unedited_asset_id); edit_status as for pictures. edit_segments are the
-- parts of the original the current video is made of (null: all of it), to
-- move times between versions. The original's transcript is kept too, by
-- line (original_cues) and, from the speech-to-text service, by word
-- (transcript_words), both in the original's times. pauses: quiet stretches
-- of the original, found once.
alter table videos add column if not exists edit_plan jsonb;
alter table videos add column if not exists edit_segments jsonb;
alter table videos add column if not exists original_cues jsonb;
alter table videos add column if not exists transcript_words jsonb;
alter table videos add column if not exists pauses jsonb;
-- The plan the current video was made from, to tell whether there are changes to make.
alter table videos add column if not exists edit_rendered jsonb;
`;

// Creates the tables if needed, and fills an empty database from
// data/episodes.json so the existing sample episodes and clips carry over.
async function migrate(db, seedPath = SEED_PATH) {
  await db.exec(SCHEMA);
  const { rows } = await db.query('select count(*)::int as n from episodes');
  if (rows[0].n > 0) return;

  const episodes = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  for (const ep of episodes) {
    await db.query(
      `insert into episodes (id, title, description, status, published_at, duration_sec, artwork_url, audio_url, video_url, chapters, created_by)
       values ($1, $2, $3, 'published', $4, $5, $6, $7, $8, $9, 'seed')`,
      [ep.id, ep.title, ep.description, ep.publishedAt, ep.durationSec, ep.artworkUrl, ep.audioUrl, ep.videoUrl, JSON.stringify(ep.chapters)]
    );
    for (const clip of ep.clips) {
      await db.query(
        `insert into shorts (id, title, status, published_at, source, episode_id, start_sec, end_sec, video_url, created_by)
         values ($1, $2, 'published', $3, 'episode', $4, $5, $6, $7, 'seed')`,
        [clip.id, clip.title, ep.publishedAt, ep.id, clip.startSec, clip.endSec, clip.videoUrl]
      );
    }
  }
}

// Postgres from DATABASE_URL (Neon on Vercel). Both pg and PGlite (used in
// tests) expose query(text, params) -> { rows } and exec(sql).
function connect(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const { Pool } = require('pg');
  // Neon drops connections that sit idle, so don't keep them long, and don't
  // let a dropped idle one crash the server.
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000, keepAlive: true });
  pool.on('error', (e) => console.warn('database connection', e.message));
  return {
    query: (text, params) => pool.query(text, params),
    exec: (sql) => pool.query(sql),
    end: () => pool.end(),
  };
}

module.exports = { STATUSES, ITEM_TYPES, migrate, connect };
