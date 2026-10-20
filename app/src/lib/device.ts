import { getItem, setItem } from './storage';

// Until sign-in exists, each install gets a random id so likes and views count
// once per device, and commenters type a display name that's remembered here.

let deviceId: Promise<string> | null = null;

export function getDeviceId(): Promise<string> {
  deviceId ??= (async () => {
    const saved = await getItem('device-id');
    if (saved) return saved;
    // Not a secret, just a stable anonymous id.
    const id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    await setItem('device-id', id);
    return id;
  })();
  return deviceId;
}

export const getDisplayName = () => getItem('display-name');
export const saveDisplayName = (name: string) => setItem('display-name', name);

// Commenters this person has blocked (anonymous author keys), kept on the device.
export async function getBlocked(): Promise<string[]> {
  try {
    return JSON.parse((await getItem('blocked-authors')) || '[]');
  } catch {
    return [];
  }
}
export const saveBlocked = (keys: string[]) => setItem('blocked-authors', JSON.stringify(keys));
