const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'data', 'episodes.json');

// Every episode and Short moves through these. Hosts can publish directly;
// uploads from other people will stop at in_review until a host approves them.
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

-- Comments stay pending until a host approves them (like Spotify's).
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
  const pool = new Pool({ connectionString: url, max: 3 });
  return {
    query: (text, params) => pool.query(text, params),
    exec: (sql) => pool.query(sql),
    end: () => pool.end(),
  };
}

module.exports = { STATUSES, ITEM_TYPES, migrate, connect };
