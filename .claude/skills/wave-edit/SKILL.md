---
name: wave-edit
description: Edit a podcast recording (cuts by time or by what was said, filler words, on-screen text, chapters) with the backend's wave-edit command line, and check the result by looking at rendered frames. Use when asked to edit, tidy, trim, caption, title or chapter an episode recording.
---

# Editing a recording with wave-edit

`backend/bin/wave-edit.js` edits a recording through an edit plan (JSON); the
recording itself is never changed. Run it from `backend/` as
`node bin/wave-edit.js <command> <plan.json> …` (`--help` lists everything).
Every command prints one JSON object; `ok: false` comes with an `error` saying
what to fix.

## Rules

- **All times are seconds of the original recording**, even after cuts. Never
  adjust a time for earlier cuts; `show` reports where things land in the
  edited video (`outFrom`, `outTo`, `outAt`).
- Give every cut a short `--reason`, so the host can see why it's there.
- Try a change with `--dry-run` when unsure; undo any change with
  `remove <plan> <id>`.
- Never render the full-quality video just to check something: use `frame`.

## Working through an edit

1. `init ep.json --video <file>` (or reuse an existing plan), then `show`.
2. Get a transcript with `transcribe ep.json` (unless the plan already has
   one; it costs money). Work out who each speaker is from what they say
   (introductions, names used) and name them with `speaker <plan> <id>`. In
   recordings over 40 minutes speaker ids are per 40-minute piece ("1:0"), so
   the same person has an id in each piece; name every one.
3. Read it with `transcript` (in ranges for long episodes) and find
   candidates:
   - pre-show and after-show chatter ("can you hear me", "let me share my
     screen", "is it recording") and setting-up while a screen share starts;
   - retakes ("let me say that again"): keep the last take;
   - dead air: `silences ep.json --min 1.5`;
   - filler words: `fillers ep.json` (only `--apply` when the user wants all
     of them gone).
   Use `search` to find exact times, and `cut --text` for a phrase said once.
4. Make the changes: `cut`, `text` (styles `lower-third`, `title`, `caption`,
   `label`), `chapter`. Speaker names make good lower thirds the first time
   each person speaks; topic changes make good chapters.
5. Check: run `validate`, and act on every error and warning. Then
   `frame ep.json --at <s> --out /tmp/f.jpg` at each text and just after each
   cut, and **look at the frame**: is the text readable, inside the picture,
   not covering a face or what's being shown?
6. When everything checks out, `render ep.json --out <file>.mp4` (`--low` for
   a quick look), and report what you changed and why, cut by cut.
