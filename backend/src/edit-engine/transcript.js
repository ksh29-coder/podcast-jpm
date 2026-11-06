const { parseVtt } = require('../vtt');
const { wordsToCues } = require('../transcribe');
const { keptSegments } = require('./plan');

// An edit plan's transcript: what was said, word by word, in source time.
// Kept in its own file next to the plan (plan.source.transcript) because a
// long episode has thousands of words.
//
// { words: [{ text, start, end, speaker }], speakers: { [id]: name }, approx }
//
// approx is true when word times were spread evenly over each line (Zoom's
// transcript only times whole lines), so cuts on single words are rough.

class TranscriptError extends Error {}

const round = (n) => Math.round(n * 1000) / 1000;

// Lines -> words, sharing out each line's time by the words' lengths.
function linesToWords(lines) {
  const words = [];
  for (const line of lines) {
    const parts = line.text.split(/\s+/).filter(Boolean);
    const total = parts.reduce((n, p) => n + p.length + 1, 0);
    let at = line.startSec;
    for (const p of parts) {
      const len = ((line.endSec - line.startSec) * (p.length + 1)) / total;
      words.push({ text: p, start: round(at), end: round(at + len), speaker: line.speaker });
      at += len;
    }
  }
  return words;
}

// Zoom writes each line as "Name: what they said". Only read names that way
// when most lines have one, so a line like "Note: …" isn't taken for a name.
function splitSpeakers(cues) {
  const named = cues.map((c) => /^([^:]{1,60}):\s+(.+)$/.exec(c.text));
  if (named.filter(Boolean).length < cues.length * 0.6) return { lines: cues.map((c) => ({ ...c, speaker: null })), speakers: {} };
  const ids = new Map();
  const lines = cues.map((c, i) => {
    const m = named[i];
    if (!m) return { ...c, speaker: null };
    if (!ids.has(m[1])) ids.set(m[1], ids.size);
    return { ...c, text: m[2], speaker: ids.get(m[1]) };
  });
  return { lines, speakers: Object.fromEntries([...ids].map(([name, id]) => [id, name])) };
}

// A transcript from a file's contents: Zoom's (or any) WebVTT, or JSON with
// words ({ word|text, start, end, speaker }, as the app's transcriber gives).
function parseTranscript(name, content) {
  if (/\.vtt$/i.test(name) || content.startsWith('WEBVTT')) {
    const cues = parseVtt(content);
    if (!cues.length) throw new TranscriptError(`${name} has no lines`);
    const { lines, speakers } = splitSpeakers(cues);
    return { words: linesToWords(lines), speakers, approx: true };
  }
  let json;
  try {
    json = JSON.parse(content);
  } catch {
    throw new TranscriptError(`${name} isn’t WebVTT or JSON`);
  }
  const raw = Array.isArray(json) ? json : json.words;
  if (!Array.isArray(raw) || !raw.length) throw new TranscriptError(`${name} has no words (expected { words: [{ word, start, end }] })`);
  const words = raw
    .map((w) => ({ text: String(w.text ?? w.word ?? '').trim(), start: Number(w.start), end: Number(w.end), speaker: Number.isInteger(w.speaker) ? w.speaker : null }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end))
    .sort((a, b) => a.start - b.start);
  return { words, speakers: json.speakers || {}, approx: Boolean(json.approx) };
}

// How much of from–to the plan keeps: 'kept', 'cut' or 'partly cut'.
function status(segments, from, to) {
  const kept = segments.reduce((sum, s) => sum + Math.max(0, Math.min(to, s.to) - Math.max(from, s.from)), 0);
  if (kept >= to - from - 0.01) return 'kept';
  return kept <= 0.01 ? 'cut' : 'partly cut';
}

const speakerName = (transcript, id) => (id === null || id === undefined ? null : transcript.speakers[id] ?? `Speaker ${Number(id) + 1}`);

// The transcript as lines with their times, speakers and whether the plan
// keeps them, optionally only from–to (source time).
function lines(plan, transcript, { from = 0, to = Infinity } = {}) {
  const segments = keptSegments(plan);
  return wordsToCues(transcript.words.filter((w) => w.end > from && w.start < to).map((w) => ({ word: w.text, start: w.start, end: w.end, speaker: w.speaker })))
    .map((c) => ({ from: c.startSec, to: c.endSec, speaker: speakerName(transcript, c.speaker), text: c.text, status: status(segments, c.startSec, c.endSec) }));
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

module.exports = { TranscriptError, FILLERS, parseTranscript, linesToWords, splitSpeakers, lines, search, fillers, status };
