import { getItem, setItem } from '../../lib/storage';

// The assistant's voices (the backend's VOICES), in the order shown. The
// first is the default.
export const VOICES = [
  { id: 'marin', label: 'Marin' },
  { id: 'cedar', label: 'Cedar' },
  { id: 'coral', label: 'Coral' },
  { id: 'ash', label: 'Ash' },
  { id: 'sage', label: 'Sage' },
  { id: 'verse', label: 'Verse' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'echo', label: 'Echo' },
  { id: 'ballad', label: 'Ballad' },
  { id: 'alloy', label: 'Alloy' },
] as const;

const KEY = 'assistant-voice';

// The voice this person picked last (kept on the device).
export async function loadVoice(): Promise<string> {
  const saved = await getItem(KEY);
  return VOICES.some((v) => v.id === saved) ? saved! : VOICES[0].id;
}
export const saveVoice = (id: string) => setItem(KEY, id);
