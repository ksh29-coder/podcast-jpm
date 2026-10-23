import { useEffect, useState } from 'react';
import { api, type Captions, type Cue } from './api';
import { getItem, setItem } from './storage';

// Captions over Shorts: the viewer's on/off choice (on unless they turn it
// off, remembered on the device), each Short's lines, and the short pieces
// they're shown in.

let on: boolean | null = null;
const listeners = new Set<(v: boolean) => void>();

export function useCaptionsOn(): [boolean, () => void] {
  const [value, setValue] = useState(on ?? true);
  useEffect(() => {
    listeners.add(setValue);
    if (on === null) {
      getItem('captions-on').then((saved) => {
        on = saved !== 'off';
        listeners.forEach((l) => l(on!));
      });
    }
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  const toggle = () => {
    on = !(on ?? true);
    setItem('captions-on', on ? 'on' : 'off');
    listeners.forEach((l) => l(on!));
  };
  return [value, toggle];
}

// Fetched once per Short and kept for a few minutes (a host may fix them).
const cache = new Map<string, { at: number; chunks: Cue[] }>();
const KEEP_MS = 5 * 60_000;

export function useShortCaptions(id: string, enabled: boolean): Cue[] {
  const [chunks, setChunks] = useState<Cue[]>(() => cache.get(id)?.chunks ?? []);
  useEffect(() => {
    if (!enabled) return;
    const hit = cache.get(id);
    let live = true;
    const load = hit && Date.now() - hit.at < KEEP_MS ? Promise.resolve(hit.chunks) : api.shortCaptions(id).then(chunksOf);
    load.then(
      (c) => {
        if (!hit || hit.chunks !== c) cache.set(id, { at: Date.now(), chunks: c });
        if (live) setChunks(c);
      },
      () => {}
    );
    return () => {
      live = false;
    };
  }, [id, enabled]);
  return chunks;
}

const chunksOf = (c: Captions) => (c.status === 'ready' ? captionChunks(c.cues) : []);

// Generated lines are whole sentences; Shorts show a few words at a time, so
// each line is split at about maxChars (preferring the end of a phrase) and
// its time shared out by length.
export function captionChunks(cues: Cue[], maxChars = 32): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const groups: string[] = [];
    let cur = '';
    for (const w of c.text.split(/\s+/).filter(Boolean)) {
      if (cur && cur.length + 1 + w.length > maxChars) {
        groups.push(cur);
        cur = '';
      }
      cur = cur ? `${cur} ${w}` : w;
      if (/[.?!,;:]$/.test(w) && cur.length >= maxChars / 2) {
        groups.push(cur);
        cur = '';
      }
    }
    if (cur) groups.push(cur);
    const total = groups.reduce((n, g) => n + g.length, 0) || 1;
    let t = c.startSec;
    for (const text of groups) {
      const d = ((c.endSec - c.startSec) * text.length) / total;
      out.push({ startSec: t, endSec: t + d, text });
      t += d;
    }
  }
  return out;
}

export const captionAt = (chunks: Cue[], sec: number) => chunks.find((c) => sec >= c.startSec && sec < c.endSec)?.text ?? null;
