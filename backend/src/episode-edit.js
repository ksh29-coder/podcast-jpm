const crypto = require('crypto');
const plans = require('./edit-engine/plan');
const { wordsToCues } = require('./transcribe');

// Editing an episode's video on the website: the website sends the whole
// edit plan (the wave-edit format, see edit-engine/plan.js); this turns it
// into one safe to keep, and moves times (chapters, the cover frame, the
// transcript) between versions of the edited video.
//
// The plan's times are in the *original* upload, which is kept, so every
// edit is made from the original and nothing cut is ever lost.

// What the website may change in a plan, per kind; the plan's source and
// sources are ours.
const FIELDS = {
  cuts: { from: 'num', to: 'num' },
  texts: { from: 'num', to: 'num', style: 'str', text: 'str', subtitle: 'str', x: 'num', y: 'num' },
  scenes: { from: 'num', to: 'num', layout: 'str', source: 'str', pip: 'str' },
  zooms: { from: 'num', to: 'num', source: 'str', rect: 'rect' },
};
const MAX_ITEMS = { cuts: 3000, texts: 300, scenes: 500, zooms: 300 };
const ID = /^[a-z]+_[0-9a-z]{1,24}$/;

class EditError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}

// One item as sent, cleaned: known fields of the right type, a usable id,
// and why / who / suggested if given.
function cleanItem(kind, raw, used) {
  if (!raw || typeof raw !== 'object') throw new EditError(`${kind} must be a list of objects`);
  const prefix = kind.slice(0, -1);
  let id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : `${prefix}_${crypto.randomBytes(3).toString('hex')}`;
  while (used.has(id)) id = `${prefix}_${crypto.randomBytes(3).toString('hex')}`;
  used.add(id);
  const item = { id };
  for (const [key, type] of Object.entries(FIELDS[kind])) {
    const v = raw[key];
    if (v === undefined || v === null || v === '') continue;
    if (type === 'num') {
      if (!Number.isFinite(Number(v))) throw new EditError(`${id}: ${key} must be a number`);
      item[key] = Math.round(Number(v) * 1000) / 1000;
    } else if (type === 'str') item[key] = String(v).slice(0, 300);
    else if (type === 'rect') {
      if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => Number.isFinite(Number(n)))) throw new EditError(`${id}: rect must be [x, y, w, h]`);
      item[key] = v.map((n) => Math.round(Number(n) * 1000) / 1000);
    }
  }
  if (raw.reason) item.reason = String(raw.reason).slice(0, 300);
  if (raw.by) item.by = String(raw.by).slice(0, 60);
  if (raw.state === 'suggested') item.state = 'suggested';
  return item;
}

// The plan the website sent, on our source: { plan, warnings }, or an
// EditError saying what's wrong.
function fromWebsite(input, base) {
  if (!input || typeof input !== 'object') throw new EditError('Send the edit plan');
  const plan = { ...plans.withDefaults(base), chapters: [] };
  const used = new Set();
  for (const kind of Object.keys(FIELDS)) {
    const list = input[kind] ?? [];
    if (!Array.isArray(list)) throw new EditError(`${kind} must be a list`);
    if (list.length > MAX_ITEMS[kind]) throw new EditError(`Too many ${kind} (at most ${MAX_ITEMS[kind]})`);
    plan[kind] = list.map((raw) => cleanItem(kind, raw, used));
  }
  const { errors, warnings } = plans.validate(plan);
  if (errors.length) throw new EditError(errors.join('\n'));
  return { plan, warnings };
}

// Whether the plan changes anything, leaving out suggestions nobody accepted.
function changesVideo(plan) {
  const p = plans.included(plans.withDefaults(plan), { suggestions: false });
  return ['cuts', 'texts', 'scenes', 'zooms'].some((kind) => p[kind].length > 0);
}

// The kept parts of the original a plan makes, or null for the whole thing.
function segmentsOf(plan) {
  const p = plans.included(plans.withDefaults(plan), { suggestions: false });
  return p.cuts.length ? plans.keptSegments(p) : null;
}

// Moves a time in the current video (made from the original's segments
// `from`, or the original itself when null) to the video made with segments
// `to`: a time in a cut part moves to where the video carries on; past the
// end is null.
function retimer(from, to) {
  return (t) => {
    const original = from ? plans.toSourceTime(from, t) : t;
    if (!to) return original;
    return plans.toOutputTime(to, original)?.time ?? null;
  };
}

// The transcript for the video made with `segments`, from the original's:
// by word when there are words (a cut can take half a line), else by line.
// Words: [{ word, start, end, speaker }]; lines: [{ startSec, endSec, text, speaker }].
function transcriptFor(segments, { words, lines }) {
  if (!segments) return words?.length ? wordsToCues(words) : lines;
  const at = (t) => plans.toOutputTime(segments, t);
  if (words?.length) {
    const kept = words.filter((w) => segments.some((s) => w.start >= s.from - 0.02 && w.end <= s.to + 0.02));
    return wordsToCues(kept.map((w) => ({ ...w, start: at(w.start)?.time ?? 0, end: at(w.end)?.time ?? 0 })));
  }
  // A line running past the end of what's kept stops there.
  const length = segments.reduce((sum, s) => sum + s.to - s.from, 0);
  return lines
    .map((c) => ({ ...c, startSec: at(c.startSec)?.time, endSec: at(c.endSec)?.time ?? length }))
    .filter((c) => c.startSec !== undefined && c.endSec - c.startSec > 0.05);
}

// Times in the current video back in the original's (for a transcript made
// from an edited video). keys: [start key, end key].
function toOriginal(segments, list, [startKey, endKey]) {
  if (!segments) return list;
  return list.map((item) => ({
    ...item,
    [startKey]: plans.toSourceTime(segments, item[startKey]),
    [endKey]: plans.toSourceTime(segments, item[endKey], { end: true }),
  }));
}

module.exports = { EditError, fromWebsite, changesVideo, segmentsOf, retimer, transcriptFor, toOriginal };
