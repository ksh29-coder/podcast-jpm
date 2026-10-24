import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useImperativeHandle, type Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type PreviewControls = { play: () => void; pause: () => void; seekTo: (sec: number) => void };

export type PreviewVideoProps = {
  uri: string;
  controls: Ref<PreviewControls>;
  onTime: (sec: number) => void;
  onPlaying: (playing: boolean) => void;
  // Width / height as it's shown, once known.
  onAspect: (aspect: number) => void;
  style: StyleProp<ViewStyle>;
};

// A video for an editor to play, pause and move through, looping. The web
// version (PreviewVideo.web.tsx) also plays our HLS streams.
export function PreviewVideo({ uri, controls, onTime, onPlaying, onAspect, style }: PreviewVideoProps) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.1;
    p.play();
  });
  useImperativeHandle(controls, () => ({ play: () => player.play(), pause: () => player.pause(), seekTo: (sec) => player.seekBy(sec - player.currentTime) }), [player]);
  // The size from a frame: the file's own can be sideways for phone recordings.
  useEventListener(player, 'sourceLoad', () => {
    player.generateThumbnailsAsync([0]).then(([frame]) => frame && frame.height > 0 && onAspect(frame.width / frame.height), () => {});
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => onPlaying(isPlaying));
  useEventListener(player, 'timeUpdate', ({ currentTime }) => onTime(currentTime));
  // No Live Text button over the paused frame: it sits on top of the pictures.
  return <VideoView player={player} style={style} contentFit="contain" nativeControls={false} allowsVideoFrameAnalysis={false} />;
}
