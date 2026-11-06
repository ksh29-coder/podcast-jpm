import { useEventListener } from 'expo';
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useListeningTracker } from '../lib/listening';

// The episode's video with the system player controls (full screen, AirPlay).
// Starts where audio left off and reports its position so switching back to
// audio carries on from the same spot. Watching counts as listening (for
// hosts' stats, listening.ts).
export function EpisodeVideo({ episodeId, uri, startAt, onTime, style }: { episodeId: string; uri: string; startAt: number; onTime: (sec: number) => void; style?: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 1;
    p.currentTime = startAt;
    p.play();
  });
  const tracker = useListeningTracker();
  const report = (position: number, playing: boolean) => tracker.update({ episodeId, mode: 'video', position, playing, rate: player.playbackRate || 1 });
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => onTime(currentTime));
    return () => sub.remove();
  }, [player, onTime]);
  useEventListener(player, 'timeUpdate', ({ currentTime }) => report(currentTime, player.playing));
  useEventListener(player, 'playingChange', ({ isPlaying }) => report(player.currentTime, isPlaying));
  return <VideoView player={player} style={style} nativeControls contentFit="contain" />;
}
