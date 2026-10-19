import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

// The episode's video with the system player controls (full screen, AirPlay).
// Starts where audio left off and reports its position so switching back to
// audio carries on from the same spot.
export function EpisodeVideo({ uri, startAt, onTime, style }: { uri: string; startAt: number; onTime: (sec: number) => void; style?: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 1;
    p.currentTime = startAt;
    p.play();
  });
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => onTime(currentTime));
    return () => sub.remove();
  }, [player, onTime]);
  return <VideoView player={player} style={style} nativeControls contentFit="contain" />;
}
