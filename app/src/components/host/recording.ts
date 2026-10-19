// Hands a finished camera recording back to the upload screen, which picks it
// up when it comes back into view.
export type Recording = { uri: string; durationSec: number };

let pending: Recording | null = null;

export function setRecording(r: Recording) {
  pending = r;
}

export function takeRecording(): Recording | null {
  const r = pending;
  pending = null;
  return r;
}
