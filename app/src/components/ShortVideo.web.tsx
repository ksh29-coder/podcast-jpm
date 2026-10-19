import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { attachHls } from './hls.web';
import type { ShortVideoHandle } from './ShortVideo';

type Props = {
  uri: string;
  playing: boolean;
  style: StyleProp<ViewStyle>;
  focusX: number;
  onTime: (position: number, duration: number) => void;
  ref?: Ref<ShortVideoHandle>;
};

// Web version: a <video> with HLS support. The browser crops to fill
// (object-fit) and focusX picks which part of a wide video stays in view.
export function ShortVideo({ uri, playing, focusX, onTime, ref }: Props) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = video.current;
    return v ? attachHls(v, uri) : undefined;
  }, [uri]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (!playing) return v.pause();
    // Browsers block autoplay with sound until the viewer has interacted;
    // fall back to muted rather than not playing at all.
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => {});
    });
  }, [playing]);

  useImperativeHandle(ref, () => ({
    seekTo: (sec) => {
      if (video.current) video.current.currentTime = sec;
    },
  }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <video
        ref={video}
        loop
        playsInline
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime, e.currentTarget.duration || 0)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${focusX * 100}% 50%`, background: '#000' }}
      />
    </View>
  );
}
