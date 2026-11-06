---
name: wave-edit
description: Edit a podcast recording (cuts, on-screen text, chapters) with the backend's wave-edit command line, and check the result by looking at rendered frames. Use when asked to edit, tidy, trim, caption, title or chapter an episode recording.
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
2. Find candidates: `silences ep.json --min 1.5` for dead air. (Transcript and
   filler-word commands are coming; until then, use a transcript if one is
   given.)
3. Make the changes: `cut`, `text` (styles `lower-third`, `title`, `caption`,
   `label`), `chapter`.
4. Check: run `validate`, and act on every error and warning. Then
   `frame ep.json --at <s> --out /tmp/f.jpg` at each text and just after each
   cut, and **look at the frame**: is the text readable, inside the picture,
   not covering a face or what's being shown?
5. When everything checks out, `render ep.json --out <file>.mp4` (`--low` for
   a quick look), and report what you changed and why, cut by cut.
