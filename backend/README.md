# Podcast backend

Small Express service for the Internal AI Wave app (build step 1 of the project brief).
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
| GET/PUT | `/api/me` | Your name and whether you've agreed to the posting guidelines |
| POST | `/api/me/uploads` | Upload URL. `{ kind: "short" }` (default) can keep only `{ startSec, endSec }` (cut by the video service); `{ kind: "episode" }` is kept whole |
| GET/DELETE | `/api/me/uploads/:videoId` | Processing state, AI suggestions and cover frames; or throw an unposted upload away |
| GET/POST | `/api/me/shorts` | Your Shorts with review status; post one (it waits `in_review` for a host) |
| PATCH/DELETE | `/api/me/shorts/:id` | Edit while in review; delete any time |
| GET/POST, PATCH/DELETE | `/api/me/episodes`, `/api/me/episodes/:id` | The same for episodes (posted from the website) |
| POST | `/api/assistant/session` | A short-lived key for one voice conversation (OpenAI Realtime, `OPENAI_API_KEY`), within the daily limit |
| POST | `/api/assistant/usage`, `/api/assistant/tools/:name` | How long it lasted; the assistant's tools (search, episode details, latest) |
| * | `/api/host/*` | Host mode (passcode): uploads, publishing, the review queue for posted Shorts and comments |
| GET | `/media/*` | Media files, with HTTP Range support for seeking |

Rejected Shorts and episodes, and uploads nobody posted, are deleted with their videos after 7 days.

Media paths in `data/episodes.json` are server-relative; the API returns them as absolute URLs
(based on the request host, or `PUBLIC_BASE_URL` if set, e.g. behind a gateway).

## Edit engine (`wave-edit`)

Edits a long recording without changing it: an **edit plan** (JSON) lists the cuts, on-screen texts
and chapters, and rendering turns the plan into a new video with ffmpeg. The same engine is meant
to sit behind the Host Studio editor and AI editing agents, so the command line prints one JSON
object per command and exits 1 with `{ ok: false, error }` when something is wrong.

```sh
npm run edit -- init ep.json --video recording.mp4
npm run edit -- silences ep.json --min 1.5            # quiet stretches worth cutting
npm run edit -- cut ep.json --from 0 --to 94.2 --reason "pre-show chatter"
npm run edit -- text ep.json --from 95 --to 100 --style lower-third --text "Alice Chen" --subtitle "Platform Engineering"
npm run edit -- chapter ep.json --at 95 --title "Intro"
npm run edit -- show ep.json                         # the plan and the edited timeline
npm run edit -- frame ep.json --at 96 --out check.jpg # one frame of the edit, texts included
npm run edit -- render ep.json --out final.mp4        # --low for a quick small version
npm run edit -- remove ep.json <id>                   # undo any cut, text or chapter

# Editing by what was said
npm run edit -- import-transcript ep.json --file zoom-transcript.vtt   # or: transcribe ep.json
npm run edit -- speaker ep.json 0 --name "Alice Chen"
npm run edit -- transcript ep.json --from 0 --to 300  # lines, speakers, and what's cut
npm run edit -- search ep.json --text "kubernetes"
npm run edit -- cut ep.json --text "can you see my screen"
npm run edit -- fillers ep.json --apply               # cut every um/uh still in the edit
```

- **Times are seconds of the original recording**, so a cut never moves anything else; `show`
  gives where each text and chapter lands in the edited video.
- Changes take `--dry-run` to see them without saving, and a change that would break the plan
  (say, a cut past the end) is refused.
- Text styles: `lower-third`, `title`, `caption`, `label`, with optional `--x`/`--y` (0–1). Text is
  drawn by libass in Inter (in `assets/fonts`, SIL Open Font License), so it looks the same anywhere.
- Chapters are written into the MP4, at their edited times.
- **Transcripts** are kept word by word in `<plan>.transcript.json` next to the plan. Zoom's
  transcript (WebVTT, "Name: what they said") gives speakers by name but only times whole lines,
  so its word times are shared out over each line and single-word cuts are rough; `transcribe`
  (MAI-Transcribe through OpenRouter, `OPENROUTER_API_KEY`) times every word.
- `cut --text` only cuts words said once in what's left of the edit; otherwise it lists each place
  so you can pick one with `--from`/`--to`. `fillers` looks for um/uh/erm…; add phrases that are
  often meant, like "you know", with `--also`.
- Code: `src/edit-engine/plan.js` (the plan, its timeline and checks, no ffmpeg),
  `src/edit-engine/ffmpeg.js` (probe, silences, frame, render) and
  `src/edit-engine/transcript.js` (reading transcripts, search, fillers).

Long renders don't fit in a Vercel function; they're meant for a background worker.

## Deploy to Vercel

The project's **Root Directory** must be `backend`. `api/index.js` runs the Express app as a
serverless function for `/api/*` and `/health` (see `vercel.json`); `public/media/` is served by
Vercel's CDN, which supports Range requests.

## Not done yet

- **Auth:** `AUTH_MODE=none` (the default) treats every request as `dev-user`. OIDC token validation
  goes in `src/auth.js` (build step 6).
- **Progress** is kept in memory and lost on restart; on Vercel it can reset between requests.
- **Media on Vercel** is public CDN content; once auth exists it needs to move behind it.
