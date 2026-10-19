import { useEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { attachHls } from './hls.web';

// Web version: a plain <video> with HLS support, since expo-video's web
// player can't play our .m3u8 streams in Chrome.
export function EpisodeVideo({ uri, startAt, onTime, style }: { uri: string; startAt: number; onTime: (sec: number) => void; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<HTMLVideoElement>(null);
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
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000' }}
      />
    </View>
  );
}
