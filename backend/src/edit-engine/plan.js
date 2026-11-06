const crypto = require('crypto');

// The edit plan: a JSON description of how to edit one recording. The
// recording itself is never changed; rendering turns the plan into a video.
//
// Every time in a plan is in seconds of the *source* recording, so a cut
// never moves the times of anything else. The timeline works out where each
// moment ends up in the edited video.
//
// {
//   version: 1,
//   source: { video, durationSec, width, height, hasAudio },
//   cuts:     [{ id, from, to, reason }],
//   texts:    [{ id, from, to, style, text, subtitle, x, y }],
//   chapters: [{ id, at, title }]
// }

const VERSION = 1;

// How each kind of text looks. x and y (0 to 1, of the video's width and
// height) say where its anchor goes; `align` is the anchor, as on a phone
// keypad (1 bottom-left … 5 middle … 9 top-right). size is a fraction of the
// video's height.
const TEXT_STYLES = {
  'lower-third': { x: 0.05, y: 0.86, align: 1, size: 0.05, subtitleSize: 0.034, box: true },
  title: { x: 0.5, y: 0.5, align: 5, size: 0.09, subtitleSize: 0.045, box: true },
  caption: { x: 0.5, y: 0.92, align: 2, size: 0.045, box: true },
  label: { x: 0.05, y: 0.06, align: 7, size: 0.04, box: true },
};

const MAX_TEXT_CHARS = 200;

class PlanError extends Error {}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(3).toString('hex')}`;
const round = (n) => Math.round(n * 1000) / 1000;

function emptyPlan(source) {
  return { version: VERSION, source, cuts: [], texts: [], chapters: [] };
}

// The parts of the source that are kept: [{ from, to }] in source time,
// in order, with overlapping or touching cuts joined up.
function keptSegments(plan) {
  const duration = plan.source.durationSec;
  const cuts = plan.cuts
    .map((c) => ({ from: Math.max(0, c.from), to: Math.min(duration, c.to) }))
    .filter((c) => c.to > c.from)
    .sort((a, b) => a.from - b.from);
  const kept = [];
  let at = 0;
  for (const c of cuts) {
    if (c.from > at) kept.push({ from: at, to: c.from });
    at = Math.max(at, c.to);
  }
  if (at < duration) kept.push({ from: at, to: duration });
  return kept;
}

// Where source time t ends up in the edited video. A time inside a cut moves
// to where the video carries on after the cut (`cut: true` says so); a time
// after the end is null.
function toOutputTime(segments, t) {
  let out = 0;
  for (const s of segments) {
    if (t < s.from) return { time: round(out), cut: true };
    if (t <= s.to) return { time: round(out + t - s.from), cut: false };
    out += s.to - s.from;
  }
  return null;
}

// The edited video's length, and every text and chapter at its edited time.
// Texts that are wholly cut out are left out.
function timeline(plan) {
  const segments = keptSegments(plan);
  const durationSec = round(segments.reduce((sum, s) => sum + s.to - s.from, 0));
  const texts = [];
  for (const t of plan.texts) {
    const from = toOutputTime(segments, t.from);
    const to = toOutputTime(segments, t.to);
    const start = from ? from.time : durationSec;
    const end = to ? to.time : durationSec;
    if (end > start) texts.push({ ...t, outFrom: start, outTo: end });
  }
  const chapters = plan.chapters
    .map((c) => ({ ...c, outAt: toOutputTime(segments, c.at)?.time ?? null }))
    .filter((c) => c.outAt !== null && c.outAt < durationSec)
    .sort((a, b) => a.outAt - b.outAt);
  return { durationSec, segments, texts, chapters };
}

// Problems that stop a render (errors) and things worth a look (warnings).
function validate(plan) {
  const errors = [];
  const warnings = [];
  if (plan.version !== VERSION) errors.push(`Unknown plan version ${plan.version}`);
  const src = plan.source || {};
  if (!src.video) errors.push('The plan has no source video');
  if (!(src.durationSec > 0)) errors.push('The source video’s length is unknown');
  if (errors.length) return { ok: false, errors, warnings };

  const duration = src.durationSec;
  const ids = new Set();
  const checkId = (item) => {
    if (ids.has(item.id)) errors.push(`${item.id}: the same id is used twice`);
    ids.add(item.id);
  };
  const checkRange = (item, what) => {
    if (!(Number.isFinite(item.from) && Number.isFinite(item.to))) return errors.push(`${item.id}: ${what} needs from and to`);
    if (item.to <= item.from) errors.push(`${item.id}: ${what} ends before it starts`);
    if (item.from < 0 || item.to > duration + 0.05) errors.push(`${item.id}: ${what} is outside the recording (0–${round(duration)}s)`);
  };

  for (const c of plan.cuts) {
    checkId(c);
    checkRange(c, 'cut');
  }
  const segments = keptSegments(plan);
  if (!segments.length) errors.push('Everything is cut');

  for (const t of plan.texts) {
    checkId(t);
    checkRange(t, 'text');
    const style = TEXT_STYLES[t.style];
    if (!style) errors.push(`${t.id}: unknown style "${t.style}" (use ${Object.keys(TEXT_STYLES).join(', ')})`);
    if (!t.text || !String(t.text).trim()) errors.push(`${t.id}: the text is empty`);
    if (String(t.text || '').length + String(t.subtitle || '').length > MAX_TEXT_CHARS) errors.push(`${t.id}: keep text under ${MAX_TEXT_CHARS} characters`);
    for (const k of ['x', 'y']) {
      if (t[k] !== undefined && !(t[k] >= 0 && t[k] <= 1)) errors.push(`${t.id}: ${k} must be between 0 and 1`);
    }
    if (!style || !src.width || !src.height) continue;
    // Rough width of the longest line: Inter averages about 0.55 of its size.
    const fits = (line, size) => line.length * size * src.height * 0.55 <= src.width * 0.9;
    const longest = (s) => String(s || '').split('\n').reduce((a, b) => (b.length > a.length ? b : a), '');
    if (!fits(longest(t.text), style.size) || (t.subtitle && !fits(longest(t.subtitle), style.subtitleSize || style.size))) {
      warnings.push(`${t.id}: the text may be too wide for the video; shorten it or split it over lines`);
    }
    const from = toOutputTime(segments, t.from);
    const to = toOutputTime(segments, t.to);
    if (from && to && to.time <= from.time) warnings.push(`${t.id}: the text is wholly inside a cut, so it won’t be seen`);
    else if (from?.cut) warnings.push(`${t.id}: the text starts inside a cut; it will appear when the video carries on`);
  }

  for (const c of plan.chapters) {
    checkId(c);
    if (!Number.isFinite(c.at) || c.at < 0 || c.at > duration) errors.push(`${c.id}: chapter time is outside the recording`);
    if (!c.title || !String(c.title).trim()) errors.push(`${c.id}: the chapter has no title`);
    const at = Number.isFinite(c.at) ? toOutputTime(segments, c.at) : null;
    if (at?.cut) warnings.push(`${c.id}: the chapter starts inside a cut; it moves to where the video carries on`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

// Changes. Each takes a plan and returns { plan, change } without touching
// the plan it was given, so a caller can show the change before saving it.

const num = (v, name) => {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n)) throw new PlanError(`${name} must be a number of seconds`);
  return round(n);
};

function addCut(plan, { from, to, reason = '' }) {
  const cut = { id: newId('cut'), from: num(from, 'from'), to: num(to, 'to'), reason: String(reason) };
  if (cut.to <= cut.from) throw new PlanError('The cut ends before it starts');
  return { plan: { ...plan, cuts: [...plan.cuts, cut] }, change: { op: 'add', kind: 'cut', item: cut } };
}

function addText(plan, { from, to, text, subtitle, style = 'caption', x, y }) {
  if (!TEXT_STYLES[style]) throw new PlanError(`Unknown style "${style}" (use ${Object.keys(TEXT_STYLES).join(', ')})`);
  if (!text || !String(text).trim()) throw new PlanError('The text is empty');
  const item = { id: newId('text'), from: num(from, 'from'), to: num(to, 'to'), style, text: String(text) };
  if (item.to <= item.from) throw new PlanError('The text ends before it starts');
  if (subtitle) item.subtitle = String(subtitle);
  if (x !== undefined) item.x = num(x, 'x');
  if (y !== undefined) item.y = num(y, 'y');
  return { plan: { ...plan, texts: [...plan.texts, item] }, change: { op: 'add', kind: 'text', item } };
}

function addChapter(plan, { at, title }) {
  if (!title || !String(title).trim()) throw new PlanError('The chapter needs a title');
  const item = { id: newId('chapter'), at: num(at, 'at'), title: String(title) };
  return { plan: { ...plan, chapters: [...plan.chapters, item] }, change: { op: 'add', kind: 'chapter', item } };
}

// Takes away any cut, text or chapter by its id.
function removeItem(plan, id) {
  for (const kind of ['cuts', 'texts', 'chapters']) {
    const item = plan[kind].find((i) => i.id === id);
    if (item) return { plan: { ...plan, [kind]: plan[kind].filter((i) => i.id !== id) }, change: { op: 'remove', kind: kind.slice(0, -1), item } };
  }
  throw new PlanError(`Nothing in the plan has the id ${id}`);
}

module.exports = { VERSION, TEXT_STYLES, PlanError, emptyPlan, keptSegments, toOutputTime, timeline, validate, addCut, addText, addChapter, removeItem };
