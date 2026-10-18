import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ErrorState } from '../../components/ErrorState';
import { api, type Episode } from '../../lib/api';
import { formatDate, formatTime } from '../../lib/format';
import { usePlayer } from '../../lib/player';
import { colors } from '../../lib/theme';
import { useFetch } from '../../lib/useFetch';

const RATES = [1, 1.25, 1.5, 2, 0.75];

export default function EpisodeScreen() {
  // `t` comes from a Short: start the full episode at that clip.
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  const { data: episode, error, reload } = useFetch(() => api.episode(id), [id]);

  if (error && !episode) return <ErrorState message={error} onRetry={reload} />;
  if (!episode) return <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
  return <EpisodeDetail episode={episode} startAt={t !== undefined ? Number(t) : undefined} />;
}

function EpisodeDetail({ episode, startAt }: { episode: Episode; startAt?: number }) {
  const player = usePlayer();
  const [mode, setMode] = useState<'audio' | 'video'>('audio');
  const videoStart = useRef(0);
  const videoTime = useRef(0);

  const isCurrent = player.episode?.id === episode.id;
  const position = isCurrent ? player.status.currentTime : player.progress[episode.id]?.positionSec ?? 0;
  const duration = isCurrent && player.status.duration > 0 ? player.status.duration : episode.durationSec;
  const playing = isCurrent && player.status.playing;
  const currentChapter = [...episode.chapters].reverse().find((c) => c.startSec <= position);

  useEffect(() => {
    if (startAt !== undefined && !Number.isNaN(startAt)) player.playEpisode(episode, startAt);
    // Only on arrival from a Short.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Audio and video share one position: switching hands it across.
  const switchMode = (next: 'audio' | 'video') => {
    if (next === mode) return;
    if (next === 'video') {
      videoStart.current = position;
      if (isCurrent) player.pause();
    } else {
      player.playEpisode(episode, videoTime.current);
    }
    setMode(next);
  };

  const jumpTo = (sec: number) => {
    if (mode === 'video') {
      videoStart.current = sec;
      setMode('audio');
      setTimeout(() => setMode('video'));
    } else {
      player.playEpisode(episode, sec);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.toggle}>
        {(['audio', 'video'] as const).map((m) => (
          <Pressable key={m} style={[styles.toggleItem, mode === m && styles.toggleActive]} onPress={() => switchMode(m)}>
            <Ionicons name={m === 'audio' ? 'headset' : 'videocam'} size={16} color={mode === m ? colors.accentText : colors.text} />
            <Text style={[styles.toggleText, mode === m && { color: colors.accentText }]}>{m === 'audio' ? 'Audio' : 'Video'}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'video' ? (
        <VideoPane uri={episode.videoUrl} startAt={videoStart.current} onTime={(s) => (videoTime.current = s)} />
      ) : (
        <Image source={{ uri: episode.artworkUrl }} style={styles.art} />
      )}

      <Text style={styles.meta}>{formatDate(episode.publishedAt)}</Text>
      <Text style={styles.title}>{episode.title}</Text>
      {currentChapter && mode === 'audio' && <Text style={styles.chapterNow}>{currentChapter.title}</Text>}

      {mode === 'audio' && (
        <>
          <Scrubber position={position} duration={duration} onSeek={(s) => (isCurrent ? player.seekTo(s) : player.playEpisode(episode, s))} />
          <View style={styles.controls}>
            <Pressable onPress={() => isCurrent && player.setRate(nextRate(player.status.playbackRate))} style={styles.rate}>
              <Text style={styles.rateText}>{isCurrent ? `${player.status.playbackRate}×` : '1×'}</Text>
            </Pressable>
            <Pressable onPress={() => isCurrent && player.seekBy(-15)} accessibilityLabel="Back 15 seconds">
              <Ionicons name="play-back" size={30} color={colors.text} />
              <Text style={styles.skipLabel}>15</Text>
            </Pressable>
            <Pressable
              style={styles.playButton}
              onPress={() => (playing ? player.pause() : player.playEpisode(episode))}
              accessibilityLabel={playing ? 'Pause' : 'Play'}
            >
              <Ionicons name={playing ? 'pause' : 'play'} size={34} color={colors.accentText} />
            </Pressable>
            <Pressable onPress={() => isCurrent && player.seekBy(30)} accessibilityLabel="Forward 30 seconds">
              <Ionicons name="play-forward" size={30} color={colors.text} />
              <Text style={styles.skipLabel}>30</Text>
            </Pressable>
            <View style={styles.rate} />
          </View>
        </>
      )}

      <Text style={styles.desc}>{episode.description}</Text>

      <Text style={styles.section}>Chapters</Text>
      {episode.chapters.map((c) => {
        const active = c === currentChapter && isCurrent;
        return (
          <Pressable key={c.startSec} style={styles.chapter} onPress={() => jumpTo(c.startSec)}>
            <Text style={[styles.chapterTime, active && { color: colors.accent }]}>{formatTime(c.startSec)}</Text>
            <Text style={[styles.chapterTitle, active && { color: colors.accent }]}>{c.title}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function nextRate(rate: number) {
  return RATES[(RATES.indexOf(rate) + 1) % RATES.length];
}

function VideoPane({ uri, startAt, onTime }: { uri: string; startAt: number; onTime: (sec: number) => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 1;
    p.currentTime = startAt;
    p.play();
  });
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => onTime(currentTime));
    return () => sub.remove();
  }, [player, onTime]);
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />;
}

function Scrubber({ position, duration, onSeek }: { position: number; duration: number; onSeek: (sec: number) => void }) {
  const [width, setWidth] = useState(0);
  const fraction = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <View>
      <Pressable
        style={styles.scrubHit}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => width > 0 && onSeek((e.nativeEvent.locationX / width) * duration)}
      >
        <View style={styles.scrubTrack}>
          <View style={[styles.scrubFill, { width: `${fraction * 100}%` }]} />
        </View>
      </Pressable>
      <View style={styles.times}>
        <Text style={styles.time}>{formatTime(position)}</Text>
        <Text style={styles.time}>-{formatTime(duration - position)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 48 },
  toggle: { flexDirection: 'row', alignSelf: 'center', backgroundColor: colors.card, borderRadius: 20, padding: 3, marginBottom: 16 },
  toggleItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 17 },
  toggleActive: { backgroundColor: colors.accent },
  toggleText: { color: colors.text, fontWeight: '600' },
  art: { width: '70%', aspectRatio: 1, alignSelf: 'center', borderRadius: 16, backgroundColor: colors.card, marginBottom: 20 },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 12, marginBottom: 20 },
  meta: { color: colors.textMuted, fontSize: 13 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  chapterNow: { color: colors.accent, fontSize: 14, marginTop: 6, fontWeight: '600' },
  scrubHit: { paddingVertical: 12, marginTop: 12 },
  scrubTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  scrubFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 16 },
  playButton: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  skipLabel: { color: colors.textMuted, fontSize: 10, textAlign: 'center' },
  rate: { width: 48, alignItems: 'center' },
  rateText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  desc: { color: colors.textMuted, fontSize: 15, lineHeight: 21, marginTop: 4 },
  section: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 24, marginBottom: 8 },
  chapter: { flexDirection: 'row', gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  chapterTime: { color: colors.textMuted, fontVariant: ['tabular-nums'], width: 48 },
  chapterTitle: { color: colors.text, flex: 1 },
});
