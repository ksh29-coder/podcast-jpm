# Podcast backend

Small Express service for the Internal AI Dev Podcast app (build step 1 of the project brief).
It serves the episode catalogue, the Shorts feed, listening progress, and media files.

## Run

```sh
npm install
npm run media   # regenerate placeholder audio/video/artwork in public/media/ (needs ffmpeg)
npm start       # http://localhost:3000  (PORT to override)
npm test
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness check (no auth) |
| GET | `/api/episodes` | All episodes, newest first, with chapters and clips |
| GET | `/api/episodes/:id` | One episode |
| GET | `/api/shorts` | All clips flattened into one feed; each has `episodeId` and `startSec` to jump into the full episode |
| GET | `/api/progress` | The user's saved positions, keyed by episode id |
| PUT | `/api/progress/:episodeId` | Body `{ "positionSec": 42 }`; saves the position so playback resumes on another device |
| GET | `/media/*` | Media files, with HTTP Range support for seeking |

Media paths in `data/episodes.json` are server-relative; the API returns them as absolute URLs
(based on the request host, or `PUBLIC_BASE_URL` if set, e.g. behind a gateway).

## Deploy to Vercel

The project's **Root Directory** must be `backend`. `api/index.js` runs the Express app as a
serverless function for `/api/*` and `/health` (see `vercel.json`); `public/media/` is served by
Vercel's CDN, which supports Range requests.

## Not done yet

- **Auth:** `AUTH_MODE=none` (the default) treats every request as `dev-user`. OIDC token validation
  goes in `src/auth.js` (build step 6).
- **Progress** is kept in memory and lost on restart; on Vercel it can reset between requests.
- **Media on Vercel** is public CDN content; once auth exists it needs to move behind it.
