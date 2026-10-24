import { useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { attachHls } from '../hls.web';
import type { PreviewVideoProps } from './PreviewVideo';

export type { PreviewControls } from './PreviewVideo';

// In the browser: a <video>, with hls.js for our .m3u8 streams (see hls.web.ts).
export function PreviewVideo({ uri, controls, onTime, onPlaying, onAspect, style }: PreviewVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    return el ? attachHls(el, uri) : undefined;
  }, [uri]);
  useImperativeHandle(
    controls,
    () => ({
      play: () => ref.current?.play().catch(() => {}),
      pause: () => ref.current?.pause(),
      seekTo: (sec) => {
        if (ref.current) ref.current.currentTime = sec;
      },
    }),
    []
  );
  return (
    <video
      ref={ref}
      style={{ ...(StyleSheet.flatten(style) as object), width: '100%', height: '100%', objectFit: 'contain' }}
      autoPlay
      loop
      playsInline
      onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
      onPlay={() => onPlaying(true)}
      onPause={() => onPlaying(false)}
      onLoadedMetadata={(e) => e.currentTarget.videoHeight > 0 && onAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
    />
  );
}
