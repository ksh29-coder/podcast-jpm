import { useEffect, useState } from 'react';
import type { HostApi, VideoState } from '../../lib/host';

// Checks an uploaded video every few seconds until it can be published (or
// fails). `needsAudio` also waits for an episode's audio-only file.
export function useVideoState(api: HostApi, videoId: string | null, { needsAudio = false, uploaded = false } = {}) {
  const [state, setState] = useState<VideoState | null>(null);

  useEffect(() => {
    // Only once the file is actually in; before that there's nothing to ask.
    if (!videoId || !uploaded) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const v = await api.video(videoId);
        if (stopped) return;
        setState(v);
        const done = v.status === 'errored' || (v.status === 'ready' && (!needsAudio || v.audioReady || v.hasAudio === false));
        if (done) return;
      } catch {
        // A blip; try again on the next tick.
      }
      if (!stopped) timer = setTimeout(tick, 4000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, videoId, needsAudio, uploaded]);

  const ready = !!state && state.status === 'ready' && (!needsAudio || !!state.audioReady || state.hasAudio === false);
  return { state, ready };
}
