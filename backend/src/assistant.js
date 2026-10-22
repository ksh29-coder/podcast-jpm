const express = require('express');
const { httpError } = require('./store');
const { VOICES } = require('./voice');

// The voice assistant in Search: a live conversation about what's on
// AI Dev Wave. It finds things with the tools below (run by the app, which
// calls us), says what it found, and shows them as cards.
//
// Each person gets DAILY_SEC of talking a day, at most SESSION_SEC at a time.

const DAILY_SEC = 10 * 60;
const SESSION_SEC = 3 * 60;

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const INSTRUCTIONS = `You are the voice guide for AI Dev Wave, an internal app where colleagues share podcast episodes and short videos ("Shorts") about AI and software-engineering best practices.

- Help people find and understand what's on AI Dev Wave. Before answering about any topic, call search_content. Use episode_details to summarize an episode, and latest for what's new.
- Only talk about what the tools return. If nothing matches, say AI Dev Wave doesn't have anything on that yet, and suggest something close that it does have. Don't answer general questions from your own knowledge.
- Whenever you mention specific episodes, Shorts or moments, call show_cards with them so they appear on the person's screen.
- Speak briefly and warmly: one to three short sentences, then let them talk. Never read out ids, links or timestamps in seconds; say "about five minutes in" instead.
- Recommend by length or topic when asked ("I have ten minutes").
- Reply in the language the person speaks.`;

const TOOLS = [
  {
    type: 'function',
    name: 'search_content',
    description: 'Search episodes, Shorts and everything said in episodes (transcripts). Returns matching episodes, Shorts, and moments with the time they are said.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'A few keywords, e.g. "prompt caching"' } }, required: ['query'] },
  },
  {
    type: 'function',
    name: 'episode_details',
    description: "An episode's summary, chapters, things mentioned and length.",
    parameters: { type: 'object', properties: { episode_id: { type: 'string' } }, required: ['episode_id'] },
  },
  {
    type: 'function',
    name: 'latest',
    description: 'The newest episodes and Shorts.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'show_cards',
    description: 'Show these items as tappable cards on the screen. Use the ids from other tools.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['episode', 'short', 'moment'] },
              id: { type: 'string', description: 'Episode or Short id (for a moment, its episode id)' },
              start_sec: { type: 'number', description: 'For a moment: when it is said' },
            },
            required: ['kind', 'id'],
          },
        },
      },
      required: ['items'],
    },
  },
];

const minutes = (sec) => Math.max(1, Math.round((sec || 0) / 60));
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

// Compact descriptions for the model; the app turns them into cards too.
const episodeInfo = (e) => ({
  kind: 'episode',
  id: e.id,
  title: e.title,
  about: clip(e.summary || e.description, 300),
  minutes: minutes(e.durationSec),
  by: e.author?.name ?? null,
  published: e.publishedAt?.slice(0, 10),
  artworkUrl: e.artworkUrl,
});
const shortInfo = (s) => ({
  kind: 'short',
  id: s.id,
  title: s.title,
  about: clip(s.description, 200),
  by: s.author?.name ?? null,
  fromEpisode: s.episodeTitle ?? null,
  artworkUrl: s.artworkUrl,
});

function assistantRouter({ db, store, voice, baseUrl }) {
  const r = express.Router();

  r.use((req, res, next) => (req.user.id === 'dev-user' ? next(httpError(400, 'This app version can’t use the voice assistant')) : next()));

  async function usedToday(userId) {
    const { rows } = await db.query('select seconds from voice_usage where user_id = $1 and day = current_date', [userId]);
    return rows[0]?.seconds ?? 0;
  }

  // Start a conversation: a short-lived key for the voice service, and how
  // long this one may last. `voice` picks how it sounds (one of VOICES).
  r.post(
    '/session',
    ah(async (req, res) => {
      if (!voice) throw httpError(503, 'The voice assistant isn’t set up on this server');
      const picked = req.body?.voice;
      if (picked !== undefined && !VOICES.includes(picked)) throw httpError(400, `voice must be one of ${VOICES.join(', ')}`);
      const left = DAILY_SEC - (await usedToday(req.user.id));
      if (left < 15) throw httpError(429, 'You’ve used today’s 10 minutes with the assistant. It resets tomorrow.');
      const session = await voice.createSession({ instructions: INSTRUCTIONS, tools: TOOLS, ...(picked && { voice: picked }) });
      res.json({ ...session, maxSec: Math.min(SESSION_SEC, left), leftTodaySec: left });
    })
  );

  // How long a conversation lasted, counted against today's minutes.
  r.post(
    '/usage',
    ah(async (req, res) => {
      const sec = Number(req.body?.seconds);
      if (!Number.isFinite(sec) || sec < 0) throw httpError(400, 'seconds must be a number');
      await db.query(
        `insert into voice_usage (user_id, day, seconds) values ($1, current_date, $2)
         on conflict (user_id, day) do update set seconds = voice_usage.seconds + excluded.seconds`,
        [req.user.id, Math.round(Math.min(sec, SESSION_SEC + 10))]
      );
      res.json({ leftTodaySec: Math.max(0, DAILY_SEC - (await usedToday(req.user.id))) });
    })
  );

  // The assistant's tools (show_cards is handled by the app).
  r.post(
    '/tools/:name',
    ah(async (req, res) => {
      const args = req.body || {};
      const base = baseUrl(req);
      switch (req.params.name) {
        case 'search_content': {
          const q = String(args.query || '').trim().slice(0, 100);
          if (q.length < 2) return res.json({ episodes: [], shorts: [], moments: [] });
          // Each word on its own too, so "testing with AI" finds "testing".
          const words = [...new Set([q, ...q.split(/\s+/).filter((w) => w.length > 3)])].slice(0, 4);
          const found = await Promise.all(words.map((w) => store.search(w, base)));
          const uniq = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];
          const episodes = uniq(found.flatMap((f) => f.episodes), (e) => e.id).slice(0, 5);
          const shorts = uniq(found.flatMap((f) => f.shorts), (s) => s.id).slice(0, 5);
          const moments = uniq(found.flatMap((f) => f.moments), (m) => `${m.episodeId}-${m.startSec}`).slice(0, 6);
          return res.json({
            episodes: episodes.map(episodeInfo),
            shorts: shorts.map(shortInfo),
            moments: moments.map((m) => ({ kind: 'moment', id: m.episodeId, episodeTitle: m.episodeTitle, startSec: m.startSec, minutesIn: Math.round(m.startSec / 60), said: clip(m.text, 200) })),
          });
        }
        case 'episode_details': {
          const ep = await store.getEpisode(String(args.episode_id || ''), base);
          if (!ep) return res.json({ error: 'No episode with that id' });
          return res.json({
            ...episodeInfo(ep),
            description: clip(ep.description, 600),
            chapters: ep.chapters.map((c) => ({ minutesIn: Math.round(c.startSec / 60), title: c.title })),
            mentioned: ep.mentions.map((m) => m.name),
            tags: ep.tags,
          });
        }
        case 'latest': {
          const [episodes, shorts] = await Promise.all([store.listEpisodes(base), store.listShorts(base)]);
          return res.json({ episodes: episodes.slice(0, 5).map(episodeInfo), shorts: shorts.slice(0, 5).map(shortInfo) });
        }
        default:
          throw httpError(404, 'Unknown tool');
      }
    })
  );

  return r;
}

module.exports = { assistantRouter, DAILY_SEC, SESSION_SEC };
