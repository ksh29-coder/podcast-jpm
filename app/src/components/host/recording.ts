// Hands a finished camera recording back to the upload screen, which picks it
// up when it comes back into view.
// `blob`: the recording itself, from the website's recorder.
export type Recording = { uri: string; durationSec: number; blob?: Blob };

let pending: Recording | null = null;

export function setRecording(r: Recording) {
  pending = r;
}

export function takeRecording(): Recording | null {
  const r = pending;
  pending = null;
  return r;
}
