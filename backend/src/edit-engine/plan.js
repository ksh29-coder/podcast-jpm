const crypto = require('crypto');

// The edit plan: a JSON description of how to edit one recording. The
// recordings themselves are never changed; rendering turns the plan into a
// video.
//
// Every time in a plan is in seconds of the *main* recording (the speaker
// video from Zoom), so a cut never moves the times of anything else. The
// timeline works out where each moment ends up in the edited video.
//
// {
//   version: 1,
//   source:   { video, durationSec, width, height, fps, hasAudio, transcript },
//   sources:  { screen: { video, durationSec, width, height, offsetSec } },
//   cuts:     [{ id, from, to }],
//   texts:    [{ id, from, to, style, text, subtitle, x, y }],
//   chapters: [{ id, at, title }],
//   scenes:   [{ id, from, to, layout, source, pip }],
//   zooms:    [{ id, from, to, source, rect: [x, y, w, h] }],
//   log:      [{ at, by, op, kind, id, what }]
// }
//
// Any item can also have `reason` (why), `by` (who: a person or an agent)
// and `state: 'suggested'`: an AI editor's proposal, which shows in previews
// but only goes into the final video once someone accepts it.
//
// The main recording is the source called "speaker"; other recordings, such
// as Zoom's shared-screen video, are added under sources. offsetSec says
// where a source starts on the main recording's clock.

const VERSION = 1;

// The kinds of change, by their list in the plan.
const KINDS = { cuts: 'cut', texts: 'text', chapters: 'chapter', scenes: 'scene', zooms: 'zoom' };

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

// What fills the picture during a scene. Outside scenes it's the speaker.
//   speaker         the main recording (Zoom's active speaker)
//   screen          the screen share, whole
//   screen+speaker  the screen share, with the speaker small in a corner
//   side-by-side    the screen share on the left, the speaker on the right
const LAYOUTS = ['speaker', 'screen', 'screen+speaker', 'side-by-side'];
const PIP_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const MAIN = 'speaker';

// A zoom eases in and out over this long, so it needs at least twice it.
const ZOOM_EASE_SEC = 0.5;
const MAX_TEXT_CHARS = 200;

class PlanError extends Error {}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(3).toString('hex')}`;
const round = (n) => Math.round(n * 1000) / 1000;

function emptyPlan(source) {
  return { version: VERSION, source, sources: {}, cuts: [], texts: [], chapters: [], scenes: [], zooms: [], log: [] };
}

// A plan as saved by an older version, with the lists it didn't have yet.
function withDefaults(plan) {
  const p = { sources: {}, log: [], ...plan };
  for (const kind of Object.keys(KINDS)) p[kind] = p[kind] || [];
  return p;
}

const isSuggested = (item) => item.state === 'suggested';

// The plan as it would be rendered: with or without the suggestions.
function included(plan, { suggestions }) {
  if (suggestions) return plan;
  const p = { ...plan };
  for (const kind of Object.keys(KINDS)) p[kind] = plan[kind].filter((i) => !isSuggested(i));
  return p;
}

// The parts of the main recording that are kept: [{ from, to }], in order,
// with overlapping or touching cuts joined up.
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

// Where time t ends up in the edited video. A time inside a cut moves to
// where the video carries on after the cut (`cut: true` says so); a time
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

// The other way: where edited time t came from in the main recording. Where
// two kept parts join, t is the end of one and the start of the next: the
// start (where something begins, like a chapter) unless `end` is set (where
// something stops, like a line of the transcript).
function toSourceTime(segments, t, { end = false } = {}) {
  let out = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const len = s.to - s.from;
    if (t < out + len || (t === out + len && (end || i === segments.length - 1))) return round(s.from + Math.max(0, t - out));
    out += len;
  }
  return segments.length ? segments[segments.length - 1].to : 0;
}

// from–to in edited time, or null when it's all cut.
function mapRange(segments, durationSec, from, to) {
  const a = toOutputTime(segments, from)?.time ?? durationSec;
  const b = toOutputTime(segments, to)?.time ?? durationSec;
  return b > a ? { outFrom: a, outTo: b } : null;
}

// The edited video's length, and everything in it at its edited time.
// Things that are wholly cut out are left out.
function timeline(plan) {
  const segments = keptSegments(plan);
  const durationSec = round(segments.reduce((sum, s) => sum + s.to - s.from, 0));
  const ranged = (items) =>
    items.flatMap((i) => {
      const r = mapRange(segments, durationSec, i.from, i.to);
      return r ? [{ ...i, ...r }] : [];
    });
  const chapters = plan.chapters
    .map((c) => ({ ...c, outAt: toOutputTime(segments, c.at)?.time ?? null }))
    .filter((c) => c.outAt !== null && c.outAt < durationSec)
    .sort((a, b) => a.outAt - b.outAt);
  return { durationSec, segments, texts: ranged(plan.texts), scenes: ranged(plan.scenes), zooms: ranged(plan.zooms), chapters };
}

// The sources a layout shows besides the speaker.
const layoutSources = (scene) => (scene.layout === MAIN ? [] : [scene.source || 'screen']);

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
  const sources = plan.sources || {};
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
  const checkSource = (item, name) => {
    if (name !== MAIN && !sources[name]) errors.push(`${item.id}: there's no "${name}" recording; add it with add-source`);
  };
  // Items of one kind that are on at the same time (suggested or not).
  const checkOverlaps = (items, what) => {
    const sorted = [...items].filter((i) => i.to > i.from).sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].from < sorted[i - 1].to) errors.push(`${sorted[i].id}: overlaps ${what} ${sorted[i - 1].id}; only one can be on at a time`);
    }
  };

  for (const [name, s] of Object.entries(sources)) {
    if (!s.video || !(s.durationSec > 0) || !s.width || !s.height) errors.push(`source "${name}" is missing its video or details`);
  }
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

  for (const s of plan.scenes) {
    checkId(s);
    checkRange(s, 'scene');
    if (!LAYOUTS.includes(s.layout)) errors.push(`${s.id}: unknown layout "${s.layout}" (use ${LAYOUTS.join(', ')})`);
    if (s.pip !== undefined && !PIP_CORNERS.includes(s.pip)) errors.push(`${s.id}: unknown corner "${s.pip}" (use ${PIP_CORNERS.join(', ')})`);
    for (const name of layoutSources(s)) checkSource(s, name);
  }
  checkOverlaps(plan.scenes, 'scene');

  for (const z of plan.zooms) {
    checkId(z);
    checkRange(z, 'zoom');
    checkSource(z, z.source);
    const r = z.rect;
    if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isFinite)) errors.push(`${z.id}: rect must be x,y,w,h`);
    else if (r[2] < 0.1 || r[3] < 0.1 || r[0] < 0 || r[1] < 0 || r[0] + r[2] > 1.001 || r[1] + r[3] > 1.001) {
      errors.push(`${z.id}: rect must be inside the picture (x,y,w,h from 0 to 1) and at least 0.1 wide and high`);
    }
    // The picture keeps its shape, so the zoom is set by the rect's bigger side.
    else if (1 / Math.max(r[2], r[3]) < 1.2) warnings.push(`${z.id}: this hardly zooms in (${(1 / Math.max(r[2], r[3])).toFixed(2)}x): the rect's width and height must both be small, as the picture keeps its shape`);
    if (Number.isFinite(z.from) && z.to - z.from < ZOOM_EASE_SEC * 2) warnings.push(`${z.id}: a zoom this short will look jumpy; make it at least ${ZOOM_EASE_SEC * 2}s`);
    // A zoom on the screen share only shows while a scene shows the screen.
    if (z.source !== MAIN && !plan.scenes.some((s) => layoutSources(s).includes(z.source) && s.from < z.to && s.to > z.from)) {
      warnings.push(`${z.id}: no scene shows "${z.source}" then, so the zoom won’t be seen`);
    }
  }
  for (const name of new Set(plan.zooms.map((z) => z.source))) checkOverlaps(plan.zooms.filter((z) => z.source === name), 'zoom');

  return { ok: errors.length === 0, errors, warnings };
}

// Changes. Each takes a plan and returns { plan, change } without touching
// the plan it was given, so a caller can show the change before saving it.
// Every add takes reason, by and suggest (true: an AI editor's proposal).

const num = (v, name) => {
  const n = Number(v);
  if (v === undefined || v === '' || v === null || !Number.isFinite(n)) throw new PlanError(`${name} must be a number`);
  return round(n);
};

function meta({ reason, by, suggest }) {
  return { ...(reason ? { reason: String(reason) } : {}), ...(by ? { by: String(by) } : {}), ...(suggest ? { state: 'suggested' } : {}) };
}

function add(plan, kind, item) {
  return { plan: { ...plan, [kind]: [...plan[kind], item] }, change: { op: 'add', kind: KINDS[kind], item } };
}

function range(o, what) {
  const r = { from: num(o.from, 'from'), to: num(o.to, 'to') };
  if (r.to <= r.from) throw new PlanError(`The ${what} ends before it starts`);
  return r;
}

function addCut(plan, o) {
  return add(plan, 'cuts', { id: newId('cut'), ...range(o, 'cut'), ...meta(o) });
}

function addText(plan, o) {
  const style = o.style || 'caption';
  if (!TEXT_STYLES[style]) throw new PlanError(`Unknown style "${style}" (use ${Object.keys(TEXT_STYLES).join(', ')})`);
  if (!o.text || !String(o.text).trim()) throw new PlanError('The text is empty');
  const item = { id: newId('text'), ...range(o, 'text'), style, text: String(o.text) };
  if (o.subtitle) item.subtitle = String(o.subtitle);
  if (o.x !== undefined) item.x = num(o.x, 'x');
  if (o.y !== undefined) item.y = num(o.y, 'y');
  return add(plan, 'texts', { ...item, ...meta(o) });
}

function addChapter(plan, o) {
  if (!o.title || !String(o.title).trim()) throw new PlanError('The chapter needs a title');
  return add(plan, 'chapters', { id: newId('chapter'), at: num(o.at, 'at'), title: String(o.title), ...meta(o) });
}

function addScene(plan, o) {
  if (!LAYOUTS.includes(o.layout)) throw new PlanError(`Say which layout: ${LAYOUTS.join(', ')}`);
  const item = { id: newId('scene'), ...range(o, 'scene'), layout: o.layout };
  if (o.layout !== MAIN) item.source = o.source || 'screen';
  if (o.pip) item.pip = String(o.pip);
  return add(plan, 'scenes', { ...item, ...meta(o) });
}

function addZoom(plan, o) {
  const rect = String(o.rect ?? '').split(',').map((v) => num(v.trim(), 'each of x,y,w,h'));
  if (rect.length !== 4) throw new PlanError('rect must be x,y,w,h (fractions of the picture, like 0.5,0,0.5,0.5 for the top-right quarter)');
  const source = o.source || (plan.sources.screen ? 'screen' : MAIN);
  return add(plan, 'zooms', { id: newId('zoom'), ...range(o, 'zoom'), source, rect, ...meta(o) });
}

// Another recording of the same meeting (like Zoom's shared screen), with
// its details from probing it.
function addSource(plan, name, info) {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(name) || name === MAIN) throw new PlanError(`Name the source with lowercase letters, not "${name}" ("${MAIN}" is the main recording)`);
  const source = { ...info, offsetSec: round(info.offsetSec || 0) };
  return { plan: { ...plan, sources: { ...plan.sources, [name]: source } }, change: { op: 'add', kind: 'source', name, item: source } };
}

function find(plan, id) {
  for (const kind of Object.keys(KINDS)) {
    const item = plan[kind].find((i) => i.id === id);
    if (item) return { kind, item };
  }
  throw new PlanError(`Nothing in the plan has the id ${id}`);
}

// Takes away any item by its id.
function removeItem(plan, id) {
  const { kind, item } = find(plan, id);
  return { plan: { ...plan, [kind]: plan[kind].filter((i) => i.id !== id) }, change: { op: 'remove', kind: KINDS[kind], item } };
}

// The suggested items with these ids, or all of them for 'all'.
function pickSuggestions(plan, ids) {
  const all = Object.keys(KINDS).flatMap((kind) => plan[kind].filter(isSuggested).map((item) => ({ kind, item })));
  if (ids === 'all') return all;
  return ids.map((id) => {
    const found = find(plan, id);
    if (!isSuggested(found.item)) throw new PlanError(`${id} isn’t a suggestion`);
    return found;
  });
}

// Suggestions go into the edit for good…
function accept(plan, ids) {
  const picked = pickSuggestions(plan, ids);
  const chosen = new Set(picked.map((p) => p.item.id));
  const next = { ...plan };
  for (const kind of Object.keys(KINDS)) next[kind] = plan[kind].map((i) => (chosen.has(i.id) ? (({ state, ...rest }) => rest)(i) : i));
  return { plan: next, change: { op: 'accept', items: picked.map((p) => ({ kind: KINDS[p.kind], ...p.item })) } };
}

// …or are thrown away.
function reject(plan, ids) {
  const picked = pickSuggestions(plan, ids);
  const chosen = new Set(picked.map((p) => p.item.id));
  const next = { ...plan };
  for (const kind of Object.keys(KINDS)) next[kind] = plan[kind].filter((i) => !chosen.has(i.id));
  return { plan: next, change: { op: 'reject', items: picked.map((p) => ({ kind: KINDS[p.kind], ...p.item })) } };
}

// Every suggestion, in time order: [{ kind, ...item }].
function suggestions(plan) {
  return pickSuggestions(plan, 'all')
    .map(({ kind, item }) => ({ kind: KINDS[kind], ...item }))
    .sort((a, b) => (a.from ?? a.at) - (b.from ?? b.at));
}

module.exports = {
  VERSION, KINDS, TEXT_STYLES, LAYOUTS, PIP_CORNERS, MAIN, ZOOM_EASE_SEC, PlanError,
  emptyPlan, withDefaults, included, keptSegments, toOutputTime, toSourceTime, timeline, layoutSources, validate,
  addCut, addText, addChapter, addScene, addZoom, addSource, removeItem, accept, reject, suggestions,
};
