import { useEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { attachHls } from './hls.web';
import { useListeningTracker } from '../lib/listening';

// Web version: a plain <video> with HLS support, since expo-video's web
// player can't play our .m3u8 streams in Chrome. Watching counts as
// listening (for hosts' stats, listening.ts).
export function EpisodeVideo({ episodeId, uri, startAt, onTime, style }: { episodeId: string; uri: string; startAt: number; onTime: (sec: number) => void; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<HTMLVideoElement>(null);
  const tracker = useListeningTracker();
  const report = (v: HTMLVideoElement) => tracker.update({ episodeId, mode: 'video', position: v.currentTime, playing: !v.paused && !v.ended, rate: v.playbackRate || 1 });
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const detach = attachHls(v, uri);
    const start = () => {
      v.currentTime = startAt;
      v.play().catch(() => {});
    };
    v.addEventListener('loadedmetadata', start, { once: true });
    return detach;
    // startAt is only for the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);
  return (
    <View style={[style, { overflow: 'hidden' }]}>
      <video
        ref={ref}
        controls
        playsInline
        onTimeUpdate={(e) => {
          onTime(e.currentTarget.currentTime);
          report(e.currentTarget);
        }}
        onPlay={(e) => report(e.currentTarget)}
        onPause={(e) => report(e.currentTarget)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000' }}
      />
    </View>
  );
}
