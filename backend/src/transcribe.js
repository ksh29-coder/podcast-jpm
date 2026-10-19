const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const run = promisify(execFile);

// Speech-to-text with Microsoft MAI-Transcribe 2 through OpenRouter: about
// half the errors of the Whisper captions Mux makes, plus speaker labels.
//
// The model takes inline audio up to ~25 MB and not Mux's .m4a, so the
// episode audio is converted to small mono MP3s first, in pieces of up to
// 40 minutes (about 14 MB each), and the pieces' timings joined back up.

const PIECE_SEC = 40 * 60;

function openRouterTranscriber({ apiKey = process.env.OPENROUTER_API_KEY, model = process.env.TRANSCRIBE_MODEL || 'microsoft/mai-transcribe-2' } = {}) {
  if (!apiKey) return null;

  async function transcribePiece(mp3) {
    const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input_audio: { data: mp3.toString('base64'), format: 'mp3' },
        response_format: 'verbose_json',
        timestamp_granularities: ['segment', 'word'],
        diarize: true,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw Object.assign(new Error(`Transcription failed: ${json.error?.message || res.status}`), { status: 502 });
    return json;
  }

  return {
    model,
    // Audio URL -> { cues: [{ startSec, endSec, text, speaker }], cost }
    async transcribe(audioUrl) {
      const ffmpeg = require('ffmpeg-static');
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stt-'));
      try {
        const res = await fetch(audioUrl);
        if (!res.ok) throw Object.assign(new Error(`Couldn’t download the audio (${res.status})`), { status: 502 });
        await fs.writeFile(path.join(dir, 'in'), Buffer.from(await res.arrayBuffer()));
        await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', path.join(dir, 'in'), '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'segment', '-segment_time', String(PIECE_SEC), path.join(dir, 'piece-%03d.mp3')]);
        const pieces = (await fs.readdir(dir)).filter((f) => f.startsWith('piece-')).sort();

        const words = [];
        let cost = 0;
        for (let i = 0; i < pieces.length; i++) {
          const out = await transcribePiece(await fs.readFile(path.join(dir, pieces[i])));
          cost += out.usage?.cost || 0;
          const offset = i * PIECE_SEC;
          for (const w of out.words || []) words.push({ ...w, start: w.start + offset, end: w.end + offset });
          // Some providers return only segments; treat each as one "word".
          if (!out.words?.length) for (const s of out.segments || []) words.push({ word: s.text, start: s.start + offset, end: s.end + offset, speaker: s.speaker });
        }
        return { cues: wordsToCues(words), cost };
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  };
}

// Words -> read-along lines: a new line at the end of a sentence, when the
// speaker changes, or after ~10 seconds, so the highlight moves steadily.
function wordsToCues(words, { maxSec = 10 } = {}) {
  const cues = [];
  let cur = null;
  for (const w of words) {
    const text = String(w.word ?? '').trim();
    if (!text) continue;
    const speaker = Number.isInteger(w.speaker) ? w.speaker : null;
    if (cur && (cur.speaker !== speaker || w.start - cur.startSec > maxSec)) {
      cues.push(cur);
      cur = null;
    }
    if (!cur) cur = { startSec: w.start, endSec: w.end, text, speaker };
    else {
      cur.text += /^[,.!?;:%)]/.test(text) ? text : ` ${text}`;
      cur.endSec = w.end;
    }
    if (/[.!?]["')\]]?$/.test(text)) {
      cues.push(cur);
      cur = null;
    }
  }
  if (cur) cues.push(cur);
  return cues.map((c) => ({ ...c, startSec: round(c.startSec), endSec: round(c.endSec) }));
}

const round = (n) => Math.round(n * 100) / 100;

// Cues -> WebVTT, so the better transcript can also be the video's captions.
function cuesToVtt(cues) {
  const stamp = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(3).padStart(6, '0');
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
  };
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.startSec)} --> ${stamp(c.endSec)}\n${c.text}`).join('\n\n')}\n`;
}

module.exports = { openRouterTranscriber, wordsToCues, cuesToVtt };
