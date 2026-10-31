import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { api, type Activity, type ActivityItem, type ItemType } from './api';
import { useBlocked } from './blocked';

// This person's Activity (in Me), shared by every screen: the Me tab's badge
// and the list itself. Loaded when the app opens or comes back, and every
// minute while it's open.

// A row in Activity: one thing, or the comments or likes on one post in a day
// ("Mike and 3 others commented").
export type ActivityEntry = {
  key: string;
  kind: ActivityItem['kind'];
  itemType: ItemType;
  itemId: string;
  itemTitle: string;
  at: string;
  // Newest first.
  names: string[];
  count: number;
  body?: string;
  commentId?: string;
  note?: string | null;
};

let cache: Activity | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(a: Activity | null) => void>();

function publish(a: Activity) {
  cache = a;
  listeners.forEach((l) => l(a));
}

export function refreshActivity() {
  loading ??= api
    .activity()
    .then(publish, () => {})
    .finally(() => {
      loading = null;
    });
  return loading;
}

export const lastSeenAt = () => cache?.seenAt ?? null;

// After looking at Activity: nothing is unread any more.
export async function markActivitySeen() {
  await api.markActivitySeen().catch(() => {});
  await refreshActivity();
}

export function useActivity() {
  const [activity, setActivity] = useState(cache);
  const blocked = useBlocked();
  useEffect(() => {
    listeners.add(setActivity);
    if (!cache) refreshActivity();
    return () => {
      listeners.delete(setActivity);
    };
  }, []);
  const entries = useMemo(() => (activity ? group(activity.items.filter((i) => !(i.actorKey && blocked.includes(i.actorKey)))) : null), [activity, blocked]);
  const unread = entries && activity ? entries.filter((e) => e.at > activity.seenAt).length : 0;
  return { entries, seenAt: activity?.seenAt ?? null, unread };
}

// Keeps Activity fresh while the app is open. Used once, by the tabs.
export function useActivityUpdates() {
  useEffect(() => {
    refreshActivity();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refreshActivity();
    }, 60_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshActivity());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
}

function group(items: ActivityItem[]): ActivityEntry[] {
  const byKey = new Map<string, ActivityEntry>();
  // Items come newest first, so each group's first one is its newest.
  for (const i of items) {
    const grouped = i.kind === 'comment' || i.kind === 'like';
    const key = grouped ? `${i.kind}:${i.itemType}:${i.itemId}:${new Date(i.at).toDateString()}` : i.id;
    const entry = byKey.get(key);
    if (entry) {
      entry.count += 1;
      if (i.actorName && !entry.names.includes(i.actorName)) entry.names.push(i.actorName);
      continue;
    }
    byKey.set(key, {
      key,
      kind: i.kind,
      itemType: i.itemType,
      itemId: i.itemId,
      itemTitle: i.itemTitle,
      at: i.at,
      names: i.actorName ? [i.actorName] : [],
      count: 1,
      body: i.body,
      commentId: i.commentId,
      note: i.note,
    });
  }
  return [...byKey.values()];
}

// "Mike", "Mike and Carol", "Mike and 3 others" (people, not comments).
export function whoText(e: ActivityEntry) {
  const [first, second] = e.names;
  const others = e.names.length - 1;
  if (!first) return 'Someone';
  if (others === 0) return first;
  if (others === 1 && second) return `${first} and ${second}`;
  return `${first} and ${others} others`;
}

// What the row says, e.g. "Mike and 3 others commented on your Short “Operators”".
export function activityText(e: ActivityEntry) {
  const what = `your ${e.itemType === 'episode' ? 'episode' : 'Short'} “${e.itemTitle}”`;
  const What = what[0].toUpperCase() + what.slice(1);
  switch (e.kind) {
    case 'reply':
      return `${whoText(e)} replied to your comment on “${e.itemTitle}”`;
    case 'comment':
      return `${whoText(e)} commented on ${what}`;
    case 'like':
      return `${What} got ${e.count === 1 ? 'a like' : `${e.count} likes`}`;
    case 'live':
      return `${What} is live`;
    case 'rejected':
      return `${What} wasn’t approved`;
    case 'episode':
      return `New episode: ${e.itemTitle}`;
  }
}
