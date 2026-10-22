import { useEffect, useState } from 'react';
import { getBlocked, saveBlocked } from './device';

// People this person has hidden (anonymous author keys), kept on the device
// and shared by every screen: hiding someone from a Short also hides their
// episodes and comments. Screens re-render when the list changes.

let cache: string[] | null = null;
const listeners = new Set<(keys: string[]) => void>();

function publish(keys: string[]) {
  cache = keys;
  listeners.forEach((l) => l(keys));
}

export function useBlocked(): string[] {
  const [keys, setKeys] = useState<string[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setKeys);
    if (!cache) getBlocked().then(publish);
    return () => {
      listeners.delete(setKeys);
    };
  }, []);
  return keys;
}

export async function blockAuthor(key: string) {
  const next = [...new Set([...(cache ?? (await getBlocked())), key])];
  await saveBlocked(next);
  publish(next);
}

export async function unblockAll() {
  await saveBlocked([]);
  publish([]);
}

// Whether something is by someone this person hid.
export const isBlocked = (keys: string[], item: { author?: { key?: string } | null }) => !!item.author?.key && keys.includes(item.author.key);
