import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { EpisodeVideo } from '../../components/EpisodeVideo';
import { ErrorState } from '../../components/ErrorState';
import { Glass } from '../../components/Glass';
import { Icon, skipIcon } from '../../components/Icon';
import { Scrubber } from '../../components/Scrubber';
import { shareItem } from '../../components/engage/share';
import { Tags } from '../../components/engage/Tags';
import { useLike } from '../../components/engage/useLike';
import { api, type Episode } from '../../lib/api';
import { formatDate, formatDuration, formatTime } from '../../lib/format';
import { usePlayer } from '../../lib/player';
import { useFetch } from '../../lib/useFetch';
import { colors, radius, spacing, tintWash, type, withAlpha } from '../../theme';

export default function EpisodeScreen() {
  // `t` comes from a Short: start the full episode at that clip.
  // `mode=video` comes from a "Watch" button.
  const { id, t, mode } = useLocalSearchParams<{ id: string; t?: string; mode?: string }>();
  const { data: episode, error, reload } = useFetch(() => api.episode(id), [id]);

  if (error && !episode) return <ErrorState message={error} onRetry={reload} />;
  if (!episode) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.text} />;
  return <NowPlaying episode={episode} startAt={t !== undefined ? Number(t) : undefined} startInVideo={mode === 'video'} />;
}

function NowPlaying({ episode, startAt, startInVideo }: { episode: Episode; startAt?: number; startInVideo: boolean }) {
  const player = usePlayer();
  const { width } = useWindowDimensions();
  // Episodes whose video has no sound have no audio version: video only.
  const hasAudio = !!episode.audioUrl;
  const validStart = startAt !== undefined && !Number.isNaN(startAt) ? startAt : undefined;

  const isCurrent = player.episode?.id === episode.id;
  const position = isCurrent ? player.status.currentTime : player.progress[episode.id]?.positionSec ?? 0;
  const duration = isCurrent && player.status.duration > 0 ? player.status.duration : episode.durationSec;
  const playing = isCurrent && player.status.playing;
  const currentChapter = [...episode.chapters].reverse().find((c) => c.startSec <= position);

  const [mode, setMode] = useState<'audio' | 'video'>(!hasAudio || startInVideo ? 'video' : 'audio');
  // Where the video starts; `n` remounts the player to start somewhere new.
  const [videoStart, setVideoStart] = useState({ sec: validStart ?? (startInVideo ? position : 0), n: 0 });
  const videoTime = useRef(0);

  useEffect(() => {
    if (validStart !== undefined && hasAudio && !startInVideo) player.playEpisode(episode, validStart);
    else if (startInVideo && isCurrent) player.pause();
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening an episode counts as a view (the server counts each device once).
  useEffect(() => {
    api.view('episode', episode.id).catch(() => {});
  }, [episode.id]);

  const like = useLike('episode', episode.id, episode);

  // Audio and video share one position: switching hands it across.
  const switchMode = (next: 'audio' | 'video') => {
    if (next === mode) return;
    if (next === 'video') {
      setVideoStart((v) => ({ sec: position, n: v.n + 1 }));
      if (isCurrent) player.pause();
    } else {
      player.playEpisode(episode, videoTime.current);
    }
    setMode(next);
  };

  const jumpTo = (sec: number) => {
    if (mode === 'video') {
      setVideoStart((v) => ({ sec, n: v.n + 1 }));
    } else {
      player.playEpisode(episode, sec);
    }
  };

  const sleep = player.sleep;
  const sleepLabel = !sleep ? null : sleep.kind === 'time' ? formatTime(player.sleepLeftSec ?? 0) : 'End of chapter';

  const artSize = Math.min(width - spacing.xxxl * 2, 340);
  const glow = withAlpha(episode.tint || colors.tintFallback, 0.85);

  return (
    <View collapsable={false} style={{ flex: 1, backgroundColor: colors.bg, experimental_backgroundImage: tintWash(episode.tint) }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
        {hasAudio && (
          <Glass style={styles.toggle}>
            {(['audio', 'video'] as const).map((m) => (
              <Pressable
                key={m}
                style={[styles.toggleItem, mode === m && styles.toggleActive]}
                onPress={() => switchMode(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === m }}
              >
                <Icon name={m === 'audio' ? 'headphones' : 'video'} size={15} color={mode === m ? colors.accentText : colors.text} />
                <Text style={[type.footnote, { color: mode === m ? colors.accentText : colors.text, fontWeight: '700' }]}>{m === 'audio' ? 'Listen' : 'Watch'}</Text>
              </Pressable>
            ))}
          </Glass>
        )}

        {mode === 'video' ? (
          <EpisodeVideo key={videoStart.n} uri={episode.videoUrl} startAt={videoStart.sec} onTime={(s) => (videoTime.current = s)} style={styles.video} />
        ) : (
          <View style={[styles.artWrap, { width: artSize, height: artSize, boxShadow: `0 24px 60px ${glow}` }]}>
            <Image source={{ uri: episode.artworkUrl }} style={[styles.art, { width: artSize, height: artSize }]} />
          </View>
        )}

        <View style={styles.titleBlock}>
          <Text style={type.eyebrow}>
            {formatDate(episode.publishedAt)} · {formatDuration(episode.durationSec)}
          </Text>
          <Text style={type.title}>{episode.title}</Text>
          {currentChapter && mode === 'audio' && (
            <Text style={[type.subhead, { color: colors.highlight, fontWeight: '700' }]} numberOfLines={1}>
              {currentChapter.title}
            </Text>
          )}
        </View>

        {mode === 'audio' && (
          <>
            <Scrubber position={position} duration={duration} onSeek={(s) => (isCurrent ? player.seekTo(s) : player.playEpisode(episode, s))} />
            <View style={styles.controls}>
              <Pressable
                onPress={() => router.push('/playback')}
                style={styles.side}
                accessibilityRole="button"
                accessibilityLabel={`Playback speed ${player.prefs.rate} times. Change speed, sleep timer and skip lengths`}
              >
                <Text style={[type.headline, { fontVariant: ['tabular-nums'] }]}>{player.prefs.rate}×</Text>
              </Pressable>
              <Pressable
                onPress={() => isCurrent && player.seekBy(-player.prefs.skipBack)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Back ${player.prefs.skipBack} seconds`}
              >
                <Icon name={skipIcon('back', player.prefs.skipBack)} size={32} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.playButton, pressed && { transform: [{ scale: 0.96 }] }]}
                onPress={() => (playing ? player.pause() : player.playEpisode(episode))}
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Pause' : 'Play'}
              >
                <Icon name={playing ? 'pause' : 'play'} size={32} color={colors.accentText} />
              </Pressable>
              <Pressable
                onPress={() => isCurrent && player.seekBy(player.prefs.skipForward)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Forward ${player.prefs.skipForward} seconds`}
              >
                <Icon name={skipIcon('forward', player.prefs.skipForward)} size={32} />
              </Pressable>
              <Pressable
                onPress={() => shareItem({ title: episode.title, path: `/episode/${episode.id}` })}
                style={styles.side}
                accessibilityRole="button"
                accessibilityLabel="Share"
              >
                <Icon name="share" size={22} />
              </Pressable>
            </View>
            <View style={styles.secondary}>
              <Glass style={styles.pill} interactive>
                <Pressable style={styles.pillInner} onPress={() => router.push(`/transcript/${episode.id}`)} accessibilityRole="button">
                  <Icon name="transcript" size={17} />
                  <Text style={styles.pillText}>Transcript</Text>
                </Pressable>
              </Glass>
              {isCurrent && (
                <Glass style={styles.pill} interactive>
                  <Pressable
                    style={styles.pillInner}
                    onPress={() => router.push('/playback')}
                    accessibilityRole="button"
                    accessibilityLabel={sleepLabel ? `Sleep timer: ${sleepLabel}` : 'Sleep timer'}
                  >
                    <Icon name={player.sleep ? 'moonFill' : 'moon'} size={17} color={player.sleep ? colors.highlight : colors.text} />
                    <Text style={[styles.pillText, player.sleep && { color: colors.highlight }]}>{sleepLabel ?? 'Sleep'}</Text>
                  </Pressable>
                </Glass>
              )}
            </View>
          </>
        )}

        <View style={styles.engage}>
          <Glass style={styles.pill} interactive>
            <Pressable style={styles.pillInner} onPress={like.toggle} accessibilityRole="button" accessibilityLabel={like.liked ? 'Unlike' : 'Like'}>
              <Icon name={like.liked ? 'heartFill' : 'heart'} size={18} color={like.liked ? colors.liked : colors.text} />
              <Text style={styles.pillText}>{like.likes}</Text>
            </Pressable>
          </Glass>
          <Glass style={styles.pill} interactive>
            <Pressable style={styles.pillInner} onPress={() => router.push(`/comments/episode/${episode.id}`)} accessibilityRole="button" accessibilityLabel="Comments">
              <Icon name="comment" size={18} />
              <Text style={styles.pillText}>{episode.comments}</Text>
            </Pressable>
          </Glass>
          {mode === 'video' && (
            <Glass style={styles.pill} interactive>
              <Pressable
                style={styles.pillInner}
                onPress={() => shareItem({ title: episode.title, path: `/episode/${episode.id}` })}
                accessibilityRole="button"
                accessibilityLabel="Share"
              >
                <Icon name="share" size={18} />
              </Pressable>
            </Glass>
          )}
          <Text style={[type.footnote, { marginLeft: 'auto', fontVariant: ['tabular-nums'] }]}>
            {episode.views} {episode.views === 1 ? 'view' : 'views'}
          </Text>
        </View>

        <Tags tags={episode.tags} />
        {!!episode.summary && (
          <View style={{ gap: spacing.xs }}>
            <Text style={type.eyebrow}>In this episode</Text>
            <Text style={type.body}>{episode.summary}</Text>
          </View>
        )}
        {!!episode.description && <Text style={[type.body, { color: colors.textMuted }]}>{episode.description}</Text>}

        {episode.mentions.length > 0 && (
          <View>
            <Text style={[type.eyebrow, { marginBottom: spacing.xs }]}>Mentioned in this episode</Text>
            {episode.mentions.map((m) => (
              <View key={`${m.startSec}-${m.name}`} style={styles.chapter}>
                <Pressable
                  onPress={() => jumpTo(m.startSec)}
                  style={({ pressed }) => [{ flex: 1, flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.name}, mentioned at ${formatTime(m.startSec)}`}
                >
                  <Text style={[type.footnote, styles.chapterTime]}>{formatTime(m.startSec)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={type.body}>{m.name}</Text>
                    <Text style={type.caption}>{m.kind}</Text>
                  </View>
                </Pressable>
                {m.url?.startsWith('https://') && (
                  <Pressable onPress={() => Linking.openURL(m.url!)} hitSlop={10} accessibilityRole="link" accessibilityLabel={`Open ${m.name} website`}>
                    <Icon name="link" size={20} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}

        {episode.chapters.length > 0 && (
          <View>
            <Text style={[type.eyebrow, { marginBottom: spacing.xs }]}>Chapters</Text>
            {episode.chapters.map((c) => {
              const active = c === currentChapter && isCurrent;
              return (
                <Pressable
                  key={c.startSec}
                  style={({ pressed }) => [styles.chapter, pressed && { opacity: 0.6 }]}
                  onPress={() => jumpTo(c.startSec)}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.title}, at ${formatTime(c.startSec)}${active ? ', playing now' : ''}`}
                >
                  <Text style={[type.footnote, styles.chapterTime, active && { color: colors.highlight }]}>{formatTime(c.startSec)}</Text>
                  <Text style={[type.body, { flex: 1 }, active && { color: colors.highlight, fontWeight: '700' }]}>{c.title}</Text>
                  {active && <Text style={[type.caption, { color: colors.highlight }]}>NOW</Text>}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.huge, gap: spacing.xxl },
  toggle: { flexDirection: 'row', alignSelf: 'center', borderRadius: radius.full, padding: 3 },
  toggleItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full },
  toggleActive: { backgroundColor: colors.accent },
  artWrap: { alignSelf: 'center', borderRadius: radius.xl, borderCurve: 'continuous' },
  art: { borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.cardHigh },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: radius.lg, borderCurve: 'continuous' },
  titleBlock: { gap: spacing.xs },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -spacing.sm },
  side: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  playButton: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  engage: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  secondary: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginTop: -spacing.sm },
  pill: { borderRadius: radius.full },
  pillInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm },
  pillText: { ...type.subhead, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  chapter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chapterTime: { width: 52, fontVariant: ['tabular-nums'] },
});
