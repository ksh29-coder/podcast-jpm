import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { request } from './api';
import { getItem, setItem } from './storage';

// What this device sends about listening, for hosts' stats (totals only; see
// docs/listening-stats.md): listening sessions for episodes, and views of
// Shorts in the feed. Each is sent as it goes, under an id made here, and the
// latest of each is kept on the device until the server has it, so listening
// offline (a download, no signal) is sent later.

export type Source = 'home' | 'search' | 'episode' | 'short' | 'notification' | 'link' | 'continue' | 'downloads' | 'assistant' | 'comments' | 'other';
type Mode = 'audio' | 'video';
type Range = [number, number];

const SEND_EVERY_MS = 30_000;
// A pause longer than this ends the session; playing again starts another.
const SESSION_GAP_MS = 30 * 60_000;
const QUEUE_KEY = 'listening-queue';
const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const round = (n: number) => Math.round(n * 100) / 100;

// ---- Sending, with what's not sent yet kept on the device ----

type Pending = { path: string; body: Record<string, unknown>; ended: boolean };
let queue: Record<string, Pending> = {};
let loaded: Promise<void> | null = null;

function load() {
  loaded ??= getItem(QUEUE_KEY).then((saved) => {
    try {
      queue = { ...JSON.parse(saved || '{}'), ...queue };
    } catch {
      // Unreadable: start again.
    }
  });
  return loaded;
}

const keep = () => setItem(QUEUE_KEY, JSON.stringify(queue));

// Sends the latest of one session or view (and keeps it until it's in).
async function send(key: string, item: Pending) {
  await load();
  queue[key] = item;
  await keep();
  try {
    await request(item.path, { method: 'PUT', body: JSON.stringify(item.body) });
    // Only forget it if nothing newer came in meanwhile, and it's over.
    if (queue[key] === item && item.ended) {
      delete queue[key];
      await keep();
    }
  } catch {
    // Offline or the server's down: it stays queued for later.
  }
}

// Sends everything still waiting (on start, and coming back to the app).
export async function sendWaiting() {
  await load();
  for (const [key, item] of Object.entries(queue)) {
    try {
      await request(item.path, { method: 'PUT', body: JSON.stringify(item.body) });
      if (queue[key] === item && item.ended) delete queue[key];
    } catch {
      break;
    }
  }
  await keep();
}

// ---- Where an episode was started from ----

let noted: { source: Source; at: number } | null = null;
// The screen the app was opened on, to tell a shared link.
let openedOn: string | null = Platform.OS === 'web' ? (globalThis.location?.pathname ?? null) : null;
if (Platform.OS !== 'web') Linking.getInitialURL().then((url) => (openedOn = url), () => {});

// Called by the screen that opens or plays an episode, just before.
export function noteSource(source: Source) {
  noted = { source, at: Date.now() };
}

function takeSource(episodeId: string, resuming: boolean): Source {
  const n = noted;
  noted = null;
  if (n && Date.now() - n.at < 10 * 60_000) return n.source;
  if (openedOn?.includes(`/episode/${episodeId}`)) {
    openedOn = null;
    return 'link';
  }
  return resuming ? 'continue' : 'episode';
}

// ---- Listening sessions ----

// The parts played, overlaps joined.
function joined(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

type Session = {
  id: string;
  key: string;
  episodeId: string;
  mode: Mode;
  source: Source;
  downloaded: boolean;
  startedAt: string;
  ranges: Range[];
  // Playing in the last tick: [position, time, rate].
  last: [number, number, number] | null;
  stopSec: number;
  speed: number;
  lastActive: number;
  lastSent: number;
};

// Follows one player (the audio player, or an episode's video) and turns
// what it reports into listening sessions.
export class ListeningTracker {
  private session: Session | null = null;

  // Called with the player's state whenever it changes (every half second or
  // so while playing). resuming: started from where they left off before.
  update({ episodeId, mode, position, playing, rate = 1, downloaded = false, resuming = false }: {
    episodeId: string | null;
    mode: Mode;
    position: number;
    playing: boolean;
    rate?: number;
    downloaded?: boolean;
    resuming?: boolean;
  }) {
    const now = Date.now();
    let s = this.session;
    const key = `${episodeId}|${mode}`;
    // Another episode, another mode, or back after a long pause: a new session.
    if (s && (s.key !== key || (playing && !s.last && now - s.lastActive > SESSION_GAP_MS))) {
      this.end();
      s = null;
    }
    if (!episodeId) return;
    if (!s) {
      if (!playing) return;
      s = this.session = {
        id: newId('listen'),
        key,
        episodeId,
        mode,
        source: takeSource(episodeId, resuming),
        downloaded,
        startedAt: new Date().toISOString(),
        ranges: [],
        last: null,
        stopSec: position,
        speed: rate,
        lastActive: now,
        lastSent: now,
      };
    }
    const stopped = !playing && s.last !== null;
    if (playing) {
      const prev = s.last;
      const moved = prev ? position - prev[0] : 0;
      // Played on from where it was (allowing for the time since, at its
      // speed): the current part grows. Anything else is a jump: a new part.
      if (prev && moved >= 0 && moved <= ((now - prev[1]) / 1000) * prev[2] + 2) s.ranges[s.ranges.length - 1][1] = round(position);
      else {
        // Endless jumping about: join the parts up (the server takes 2,000).
        if (s.ranges.length >= 1500) s.ranges = joined(s.ranges);
        s.ranges.push([round(position), round(position)]);
      }
      s.last = [position, now, rate];
      s.speed = rate;
      s.lastActive = now;
    } else {
      s.last = null;
    }
    s.stopSec = round(position);
    if (stopped || (playing && now - s.lastSent >= SEND_EVERY_MS)) this.send(false);
  }

  // Sends the session so far (on the timer, on pause, going to the background).
  send(ended: boolean) {
    const s = this.session;
    if (!s) return;
    s.lastSent = Date.now();
    const ranges = s.ranges.filter(([from, to]) => to > from);
    if (!ranges.length) return;
    send(s.id, {
      path: `/api/listening/${s.id}`,
      ended,
      body: { episodeId: s.episodeId, ranges, stopSec: s.stopSec, mode: s.mode, platform, source: s.source, speed: s.speed, downloaded: s.downloaded, startedAt: s.startedAt },
    });
  }

  end() {
    this.send(true);
    this.session = null;
  }
}

// One tracker following a player's state, sending when the app goes to the
// background and ending the session when the player goes away.
export function useListeningTracker() {
  const [tracker] = useState(() => new ListeningTracker());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sendWaiting();
      else tracker.send(false);
    });
    return () => {
      sub.remove();
      tracker.end();
    };
  }, [tracker]);
  return tracker;
}

// ---- Shorts ----

type ShortView = { id: string; shortId: string; shownAt: string; watched: number; loops: number; opened: boolean; last: number | null; lastSent: number };
let currentView: ShortView | null = null;

function sendView(v: ShortView, ended: boolean) {
  v.lastSent = Date.now();
  send(v.id, {
    path: `/api/short-views/${v.id}`,
    ended,
    body: { shortId: v.shortId, watchedSec: round(v.watched), loops: v.loops, openedEpisode: v.opened, platform, shownAt: v.shownAt },
  });
}

// "Play full episode" was tapped on the Short being watched.
export function markShortOpened(shortId: string) {
  if (currentView?.shortId === shortId) {
    currentView.opened = true;
    sendView(currentView, false);
  }
  noteSource('short');
}

// Follows a Short in the feed while it's the one on screen: how long it's
// watched (loops count), and how often it loops.
export function useShortView(shortId: string, active: boolean, position: number, duration: number) {
  const view = useRef<ShortView | null>(null);
  useEffect(() => {
    if (!active) return;
    const v: ShortView = { id: newId('view'), shortId, shownAt: new Date().toISOString(), watched: 0, loops: 0, opened: false, last: null, lastSent: Date.now() };
    view.current = currentView = v;
    const sub = AppState.addEventListener('change', (state) => state !== 'active' && sendView(v, false));
    return () => {
      sub.remove();
      sendView(v, true);
      if (currentView === v) currentView = null;
      view.current = null;
    };
  }, [active, shortId]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (v.last !== null) {
      const moved = position - v.last;
      if (moved > 0 && moved < 1.5) v.watched += moved;
      // Back to the start from the end: it looped.
      else if (moved < 0 && position < 1.5 && duration > 0 && v.last > duration - 1.5) {
        v.loops += 1;
        v.watched += duration - v.last + position;
      }
    }
    v.last = position;
    if (Date.now() - v.lastSent >= SEND_EVERY_MS) sendView(v, false);
  }, [position, duration]);
}
