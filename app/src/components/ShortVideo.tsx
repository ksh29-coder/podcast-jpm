import { useEventListener } from 'expo';
import { useEffect, useImperativeHandle, type Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

export type ShortVideoHandle = { seekTo: (sec: number) => void };

type Props = {
  uri: string;
  playing: boolean;
  // Wide videos are laid out wider than the screen and shifted (see the Shorts
  // screen); the web version uses focusX instead.
  style: StyleProp<ViewStyle>;
  focusX: number;
  onTime: (position: number, duration: number) => void;
  // 'contain' shows the whole frame (e.g. a wide episode in review).
  fit?: 'cover' | 'contain';
  ref?: Ref<ShortVideoHandle>;
};

// A looping, chrome-less video for the Shorts feed.
export function ShortVideo({ uri, playing, style, onTime, fit = 'cover', ref }: Props) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => onTime(currentTime, player.duration));
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  useImperativeHandle(ref, () => ({ seekTo: (sec) => player.seekBy(sec - player.currentTime) }), [player]);
  return <VideoView player={player} style={style} contentFit={fit} nativeControls={false} />;
}
