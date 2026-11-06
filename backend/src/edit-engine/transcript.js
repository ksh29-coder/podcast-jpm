const { wordsToCues, PIECE_SEC } = require('../transcribe');
const { keptSegments } = require('./plan');

// An edit plan's transcript: what was said, word by word, in source time,
// from the AI transcriber. Kept in its own file next to the plan
// (plan.source.transcript) because a long episode has thousands of words.
//
// { words: [{ text, start, end, speaker }], speakers: { [speaker]: name } }
//
// The transcriber works on pieces of PIECE_SEC (40 minutes) and numbers the
// speakers of each piece on its own, so in a longer recording speaker 0 of
// one piece needn't be speaker 0 of the next. There, speakers are "piece:n"
// (like "1:0") so they're never mixed up, and each gets named once.

class TranscriptError extends Error {}

const SPEAKER = /^\d+:\d+$/;
const speakerOf = (v) => (Number.isInteger(v) || SPEAKER.test(v) ? v : null);

// Transcriber words ({ word, start, end, speaker }) as a transcript of a
// recording durationSec long.
function fromWords(words, { durationSec, pieceSec = PIECE_SEC } = {}) {
  const pieces = durationSec > pieceSec;
  return {
    words: words
      .map((w) => ({
        text: String(w.word ?? w.text ?? '').trim(),
        start: Number(w.start),
        end: Number(w.end),
        speaker: Number.isInteger(w.speaker) && pieces ? `${Math.floor(w.start / pieceSec)}:${w.speaker}` : speakerOf(w.speaker),
      }))
      .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end))
      .sort((a, b) => a.start - b.start),
    speakers: {},
  };
}

// A transcript saved earlier (or words JSON from another tool).
function parseTranscript(name, content) {
  let json;
  try {
    json = JSON.parse(content);
  } catch {
    throw new TranscriptError(`${name} isn’t JSON`);
  }
  const raw = Array.isArray(json) ? json : json.words;
  if (!Array.isArray(raw) || !raw.length) throw new TranscriptError(`${name} has no words (expected { words: [{ word, start, end, speaker }] })`);
  const transcript = fromWords(raw, { durationSec: 0 });
  return { ...transcript, speakers: json.speakers || {} };
}

// How much of from–to the plan keeps: 'kept', 'cut' or 'partly cut'.
function status(segments, from, to) {
  const kept = segments.reduce((sum, s) => sum + Math.max(0, Math.min(to, s.to) - Math.max(from, s.from)), 0);
  if (kept >= to - from - 0.01) return 'kept';
  return kept <= 0.01 ? 'cut' : 'partly cut';
}

// A speaker's name, or "Speaker 2" ("Speaker 2, part 3" when per piece).
function speakerName(transcript, id) {
  if (id === null || id === undefined) return null;
  if (transcript.speakers[id]) return transcript.speakers[id];
  const [piece, n] = String(id).includes(':') ? String(id).split(':').map(Number) : [null, Number(id)];
  return `Speaker ${n + 1}${piece === null ? '' : `, part ${piece + 1}`}`;
}

// The transcript as lines with their times, speakers and whether the plan
// keeps them, optionally only from–to (source time).
function lines(plan, transcript, { from = 0, to = Infinity } = {}) {
  const segments = keptSegments(plan);
  // wordsToCues wants speakers as numbers, so number them for it.
  const keys = [...new Set(transcript.words.map((w) => w.speaker))];
  return wordsToCues(transcript.words.filter((w) => w.end > from && w.start < to).map((w) => ({ word: w.text, start: w.start, end: w.end, speaker: keys.indexOf(w.speaker) })))
    .map((c) => ({ from: c.startSec, to: c.endSec, speakerId: keys[c.speaker] ?? null, speaker: speakerName(transcript, keys[c.speaker]), text: c.text, status: status(segments, c.startSec, c.endSec) }));
}

// Words as plain lowercase tokens, so "Kubernetes," matches "kubernetes".
const token = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}'’]+/gu, '').replace(/’/g, "'");

// Every place the phrase is said: [{ from, to, said, context, status }].
function search(plan, transcript, phrase) {
  const want = phrase.split(/\s+/).map(token).filter(Boolean);
  if (!want.length) throw new TranscriptError('Say what to look for');
  const words = transcript.words;
  const tokens = words.map((w) => token(w.text));
  const segments = keptSegments(plan);
  const found = [];
  for (let i = 0; i + want.length <= tokens.length; i++) {
    if (!want.every((t, j) => tokens[i + j] === t)) continue;
    const last = i + want.length - 1;
    const around = (a, b) => words.slice(Math.max(0, a), Math.min(words.length, b)).map((w) => w.text).join(' ');
    found.push({
      from: words[i].start,
      to: words[last].end,
      said: around(i, last + 1),
      context: around(i - 8, last + 9),
      speakerId: words[i].speaker,
      speaker: speakerName(transcript, words[i].speaker),
      status: status(segments, words[i].start, words[last].end),
    });
  }
  return found;
}

// Sounds people make while thinking. Phrases like "you know" or "like" are
// often meant, so they're only looked for when asked (`also`).
const FILLERS = ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm'];

// Filler words still in the edit: [{ from, to, said, context }].
function fillers(plan, transcript, { also = [] } = {}) {
  const found = [];
  const seen = new Set();
  for (const phrase of [...FILLERS, ...also]) {
    for (const hit of search(plan, transcript, phrase)) {
      if (hit.status === 'cut' || seen.has(hit.from)) continue;
      seen.add(hit.from);
      found.push({ from: hit.from, to: hit.to, said: hit.said, context: hit.context });
    }
  }
  return found.sort((a, b) => a.from - b.from);
}

module.exports = { TranscriptError, FILLERS, fromWords, parseTranscript, speakerName, lines, search, fillers, status };
