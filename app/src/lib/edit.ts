import type { EditCut, EditItem, EditPlan, Pause, TextStyleName } from './host';

// The video editor's sums, in the browser: what an edit plan keeps and where
// things end up. They match the backend's edit-engine/plan.js, which makes
// the real video.

export type Range = { from: number; to: number };

const round = (n: number) => Math.round(n * 1000) / 1000;

export const newId = (prefix: string) => `${prefix}_${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;

// Leaves out suggestions nobody accepted (they don't go into the video).
export const accepted = <T extends EditItem>(items: T[]) => items.filter((i) => i.state !== 'suggested');

// The parts of the original that are kept, in order, with overlapping or
// touching cuts joined up.
export function keptSegments(cuts: EditCut[], durationSec: number): Range[] {
  const sorted = accepted(cuts)
    .map((c) => ({ from: Math.max(0, c.from), to: Math.min(durationSec, c.to) }))
    .filter((c) => c.to > c.from)
    .sort((a, b) => a.from - b.from);
  const kept: Range[] = [];
  let at = 0;
  for (const c of sorted) {
    if (c.from > at) kept.push({ from: at, to: c.from });
    at = Math.max(at, c.to);
  }
  if (at < durationSec) kept.push({ from: at, to: durationSec });
  return kept;
}

// Where original time t ends up in the edited video.
export function toEdited(segments: Range[], t: number) {
  let out = 0;
  for (const s of segments) {
    if (t < s.from) return round(out);
    if (t <= s.to) return round(out + t - s.from);
    out += s.to - s.from;
  }
  return round(out);
}

export const editedLength = (segments: Range[]) => round(segments.reduce((sum, s) => sum + s.to - s.from, 0));

// Where playback should carry on from t: t itself, or the end of the cut it's in.
export function playableFrom(segments: Range[], t: number) {
  for (const s of segments) {
    if (t < s.from) return s.from;
    if (t < s.to) return t;
  }
  return null;
}

// How much of from–to is cut out: 'kept', 'cut' or 'partly'.
export function cutState(segments: Range[], from: number, to: number) {
  const kept = segments.reduce((sum, s) => sum + Math.max(0, Math.min(to, s.to) - Math.max(from, s.from)), 0);
  if (kept >= to - from - 0.01) return 'kept';
  return kept <= 0.01 ? 'cut' : 'partly';
}

// Sounds people make while thinking (the backend's FILLERS).
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm']);
const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}']/gu, '');

// Filler words still in the edit: [{ from, to, said }].
export function findFillers(words: [string, number, number][], segments: Range[]) {
  return words
    .filter(([w, from, to]) => FILLERS.has(bare(w)) && cutState(segments, from, to) !== 'cut')
    .map(([said, from, to]) => ({ from, to, said }));
}

// Cuts that shorten each pause of at least minSec to `keep` seconds, leaving
// pauses already cut alone.
export function shortenPauses(pauses: Pause[], segments: Range[], minSec: number, keep = 0.5) {
  return pauses
    .filter((p) => p.durationSec >= minSec && cutState(segments, p.from, p.to) === 'kept')
    .map((p) => ({ from: round(p.from + keep / 2), to: round(p.to - keep / 2), durationSec: p.durationSec }));
}

// How each kind of text looks (the backend's TEXT_STYLES): x, y place its
// anchor (as on a phone keypad: 1 bottom-left, 2 bottom-middle, 5 middle,
// 7 top-left), size is a share of the picture's height.
export const TEXT_STYLES: Record<TextStyleName, { label: string; x: number; y: number; align: 1 | 2 | 5 | 7; size: number; subtitleSize?: number }> = {
  'lower-third': { label: 'Name tag', x: 0.05, y: 0.86, align: 1, size: 0.05, subtitleSize: 0.034 },
  title: { label: 'Title card', x: 0.5, y: 0.5, align: 5, size: 0.09, subtitleSize: 0.045 },
  caption: { label: 'Caption', x: 0.5, y: 0.92, align: 2, size: 0.045 },
  label: { label: 'Corner label', x: 0.05, y: 0.06, align: 7, size: 0.04 },
};

// "12:03.4", for times that need tenths.
export function clock(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

export const sameRange = (a: Range | null, b: Range | null) => a?.from === b?.from && a?.to === b?.to;

// A plan with an item swapped in (by id) or added.
export function withItem<K extends 'cuts' | 'texts'>(plan: EditPlan, kind: K, item: EditPlan[K][number]): EditPlan {
  const list = plan[kind] as EditItem[];
  const at = list.findIndex((i) => i.id === item.id);
  return { ...plan, [kind]: at === -1 ? [...list, item] : list.map((i) => (i.id === item.id ? item : i)) };
}

// A layout (or zoom) placed over from–to: ones it covers go, ones it
// overlaps are trimmed, and one it falls inside is split around it, since
// only one can be on at a time.
export function placeRange<T extends EditItem>(items: T[], item: T): T[] {
  const out: T[] = [];
  for (const s of items) {
    if (s.to <= item.from || s.from >= item.to) out.push(s);
    else if (s.from < item.from && s.to > item.to) out.push({ ...s, to: item.from }, { ...s, id: newId(s.id.split('_')[0]), from: item.to });
    else if (s.from < item.from) out.push({ ...s, to: item.from });
    else if (s.to > item.to) out.push({ ...s, from: item.to });
  }
  return [...out, item].sort((a, b) => a.from - b.from);
}

// The stretches a screen recording shows something: from its start to its
// end on the original's clock, less its blank parts, at least minSec long.
export function sharedRanges(blank: Range[], offsetSec: number, durationSec: number, minSec = 5): Range[] {
  const out: Range[] = [];
  let at = Math.max(0, offsetSec);
  const end = offsetSec + durationSec;
  for (const b of [...blank].sort((x, y) => x.from - y.from)) {
    if (b.from > at) out.push({ from: at, to: Math.min(b.from, end) });
    at = Math.max(at, b.to);
  }
  if (at < end) out.push({ from: at, to: end });
  return out.filter((r) => r.to - r.from >= minSec).map((r) => ({ from: round(r.from), to: round(r.to) }));
}

// A zoom's rect drawn freely, made the picture's shape (the video keeps its
// shape, so a zoom shows a box like it) and kept inside the picture.
export function zoomRect(drawn: { x: number; y: number; w: number; h: number }): [number, number, number, number] {
  const size = Math.min(1, Math.max(0.1, drawn.w, drawn.h));
  const cx = drawn.x + drawn.w / 2;
  const cy = drawn.y + drawn.h / 2;
  const clamp = (c: number) => Math.min(Math.max(c - size / 2, 0), 1 - size);
  return [round(clamp(cx)), round(clamp(cy)), round(size), round(size)];
}

// How far into a zoom it is, 0 (whole picture) to 1 (its rect): it eases in
// and out over half a second, as the edited video does.
export function zoomAmount(zoom: Range, t: number, ease = 0.5) {
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  return clip((t - zoom.from) / ease) * clip((zoom.to - t) / ease);
}
