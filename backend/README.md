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

Edits a podcast recording without changing it: an **edit plan** (JSON) lists the cuts, layouts,
zooms, on-screen texts and chapters, and rendering turns the plan into a new video with ffmpeg.
It's made for **AI editors first**, with the host deciding: every change can be a suggestion with
a reason and who made it, which shows in previews but only reaches the final video once accepted.
The command line prints one JSON object per command and exits 1 with `{ ok: false, error }`
saying what to fix. The Claude Code skill `.claude/skills/wave-edit` runs it as an editing team.

```sh
# Set up: Zoom's speaker video, its shared-screen video, and an AI transcript
npm run edit -- init ep.json --video speaker.mp4
npm run edit -- add-source ep.json --name screen --video shared-screen.mp4   # --offset if it starts later
npm run edit -- transcribe ep.json                   # word by word, with speakers
npm run edit -- speaker ep.json 0 --name "Alice Chen"

# Find
npm run edit -- transcript ep.json --from 0 --to 300  # lines, speakers, and what's cut
npm run edit -- search ep.json --text "kubernetes"
npm run edit -- fillers ep.json                       # um/uh still in the edit
npm run edit -- silences ep.json --min 1.5            # quiet stretches
npm run edit -- activity ep.json                      # when the screen share is blank or changes
npm run edit -- look ep.json --source screen --at 600 --out look.jpg   # the screen, with a grid

# Change (AI editors add: --suggest --by rough-cut --reason "small talk before the show")
npm run edit -- cut ep.json --from 0 --to 94.2
npm run edit -- cut ep.json --text "can you see my screen"
npm run edit -- scene ep.json --from 310 --to 845 --layout screen+speaker
npm run edit -- zoom ep.json --from 400 --to 460 --rect 0.5,0,0.5,0.5
npm run edit -- text ep.json --from 95 --to 100 --style lower-third --text "Alice Chen" --subtitle "Platform Engineering"
npm run edit -- chapter ep.json --at 95 --title "Intro"
npm run edit -- remove ep.json <id>…

# Review and make
npm run edit -- suggestions ep.json                   # each in plain words, with why and who
npm run edit -- accept ep.json <id>… --by host        # or --all; reject the same way
npm run edit -- frame ep.json --at 96 --out check.jpg # one frame of the edit, suggestions included
npm run edit -- render ep.json --low --suggestions --out preview.mp4
npm run edit -- render ep.json --out final.mp4        # accepted changes only
```

- **Times are seconds of the main (speaker) recording**, for every recording, so a cut never moves
  anything else; `show` gives where everything lands in the edited video.
- Changes take `--dry-run`, and a change that would break the plan (a cut past the end, two scenes
  at once) is refused. Every saved change goes in the plan's `log` with who made it.
- **Layouts** (`scene`): `speaker` (the default everywhere), `screen`, `screen+speaker` (the speaker
  small in a corner, `--pip`) and `side-by-side`. The screen share keeps its shape inside the
  picture. **Zooms** ease in and out over half a second; the rect zooms by its bigger side.
- Text styles: `lower-third`, `title`, `caption`, `label`, with optional `--x`/`--y` (0–1). Text is
  drawn by libass in Inter (in `assets/fonts`, SIL Open Font License), so it looks the same anywhere.
- Chapters are written into the MP4, at their edited times.
- **Transcripts** come from `transcribe` (MAI-Transcribe through OpenRouter, `OPENROUTER_API_KEY`),
  which times every word, keeps fillers like "um", and tells speakers apart. They're kept in
  `<plan>.transcript.json` next to the plan (`import-transcript` reuses one); `transcribe` won't
  run (and charge) again without `--force`. Audio is transcribed in 40-minute pieces, and each
  piece numbers its speakers afresh, so in longer recordings speakers are per piece ("1:0" is
  the first speaker of the second piece) and each needs naming with `speaker`.
- `cut --text` only cuts words said once in what's left of the edit; otherwise it lists each place
  so you can pick one with `--from`/`--to`. `fillers` looks for um/uh/erm…; add phrases that are
  often meant, like "you know", with `--also`.
- **For AI models in the app**: `wave-edit tools` (or `tools()` from `bin/wave-edit.js`) gives every
  command as a tool definition (name, description, JSON schema), and `call(name, input)` runs one.
- Code: `src/edit-engine/plan.js` (the plan, timeline, checks and suggestions; no ffmpeg),
  `src/edit-engine/ffmpeg.js` (probe, silences, activity, look, frame, render),
  `src/edit-engine/transcript.js` (transcripts, search, fillers) and `bin/wave-edit.js`.

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
