import Ionicons from '@expo/vector-icons/Ionicons';
import { useEventListener } from 'expo';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View, type ViewToken } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ErrorState } from '../../components/ErrorState';
import { Scrubber } from '../../components/Scrubber';
import { shareItem } from '../../components/engage/share';
import { Tags } from '../../components/engage/Tags';
import { useLike } from '../../components/engage/useLike';
import { api, type Short } from '../../lib/api';
import { usePlayer } from '../../lib/player';
import { colors } from '../../lib/theme';
import { useFetch } from '../../lib/useFetch';

export default function ShortsScreen() {
  const { data, error, reload } = useFetch(api.shorts);
  const [height, setHeight] = useState(0);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const focused = useIsFocused();
  const { pause } = usePlayer();

  // Clips have their own sound, so pause the episode while watching.
  useEffect(() => {
    if (focused) pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]) setVisibleId((viewableItems[0].item as Short).id);
  }).current;

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;

  return (
    <View style={styles.screen} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {height > 0 && (
        <FlatList
          data={data}
          keyExtractor={(s) => s.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          windowSize={3}
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          renderItem={({ item, index }) => (
            <ShortItem
              short={item}
              height={height}
              active={focused && (visibleId ?? data[0]?.id) === item.id}
              index={index}
              total={data.length}
            />
          )}
        />
      )}
    </View>
  );
}

function ShortItem({ short, height, active, index, total }: { short: Short; height: number; active: boolean; index: number; total: number }) {
  const insets = useSafeAreaInsets();
  const [paused, setPaused] = useState(false);
  const player = useVideoPlayer(short.videoUrl, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
  });
  const [time, setTime] = useState({ position: 0, duration: 0 });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => setTime({ position: currentTime, duration: player.duration }));

  useEffect(() => {
    if (active && !paused) player.play();
    else player.pause();
  }, [active, paused, player]);

  useEffect(() => {
    if (!active) setPaused(false);
  }, [active]);

  // Counts as a view after two seconds on screen (the server counts each device once).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => api.view('short', short.id).catch(() => {}), 2000);
    return () => clearTimeout(t);
  }, [active, short.id]);

  const like = useLike('short', short.id, short);

  const { width } = useWindowDimensions();
  // A wide video fills the tall screen by cropping its sides; focusX picks
  // which part stays in view (0.5 = centre, the same as plain "cover").
  const videoAspect = parseAspect(short.aspectRatio);
  const videoWidth = videoAspect ? height * videoAspect : 0;
  const videoStyle =
    videoWidth > width
      ? { position: 'absolute' as const, top: 0, height, width: videoWidth, left: -(videoWidth - width) * short.focusX }
      : StyleSheet.absoluteFill;

  return (
    <View style={{ height, overflow: 'hidden' }}>
      <VideoView player={player} style={videoStyle} contentFit="cover" nativeControls={false} />
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setPaused((p) => !p)}>
        {paused && (
          <View style={styles.pausedIcon}>
            <Ionicons name="play" size={64} color="rgba(255,255,255,0.85)" />
          </View>
        )}
      </Pressable>
      <Text style={[styles.counter, { top: insets.top + 12 }]}>
        {index + 1} / {total}
      </Text>
      <View style={[styles.actions, { bottom: 140 }]}>
        <Action icon={like.liked ? 'heart' : 'heart-outline'} color={like.liked ? '#ff4d6d' : '#fff'} label={String(like.likes)} a11y={like.liked ? 'Unlike' : 'Like'} onPress={like.toggle} />
        <Action icon="chatbubble-ellipses-outline" label={String(short.comments)} a11y="Comments" onPress={() => router.push(`/comments/short/${short.id}`)} />
        <Action
          icon="arrow-redo-outline"
          label="Share"
          a11y="Share"
          onPress={() => shareItem({ title: short.title, path: short.episodeId ? `/episode/${short.episodeId}` : '/shorts' })}
        />
        <Action icon="eye-outline" label={String(short.views)} a11y={`${short.views} views`} />
      </View>
      <View style={[styles.overlay, { bottom: 56 }]} pointerEvents="box-none">
        {short.episodeTitle && (
          <Text style={styles.episode} numberOfLines={1}>
            {short.episodeTitle}
          </Text>
        )}
        <Text style={styles.title}>{short.title}</Text>
        <Tags tags={short.tags} light />
        {short.episodeId && (
          <Pressable
            style={styles.cta}
            onPress={() => router.push(short.startSec != null ? `/episode/${short.episodeId}?t=${short.startSec}` : `/episode/${short.episodeId}`)}
          >
            <Ionicons name="headset" size={16} color={colors.accentText} />
            <Text style={styles.ctaText}>{short.startSec != null ? 'Play full episode from here' : 'Play the full episode'}</Text>
          </Pressable>
        )}
      </View>
      {time.duration > 0 && (
        <View style={styles.progress}>
          <Scrubber variant="overlay" position={time.position} duration={time.duration} onSeek={(sec) => player.seekBy(sec - player.currentTime)} />
        </View>
      )}
    </View>
  );
}

function Action({
  icon,
  label,
  a11y,
  onPress,
  color = '#fff',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  a11y: string;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <Pressable style={styles.action} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={a11y} hitSlop={6}>
      <Ionicons name={icon} size={30} color={color} style={styles.actionIcon} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

// "16:9" -> 1.777…; null when unknown or malformed.
function parseAspect(ratio: string | null) {
  const [w, h] = (ratio || '').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  pausedIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  counter: { position: 'absolute', right: 16, color: '#fff', fontSize: 13, opacity: 0.8 },
  // Leaves room on the right for the like/comment/share column.
  overlay: { position: 'absolute', left: 16, right: 72, gap: 6 },
  actions: { position: 'absolute', right: 10, alignItems: 'center', gap: 18 },
  action: { alignItems: 'center', gap: 2, minWidth: 48 },
  actionIcon: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  actionLabel: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  progress: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  episode: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: colors.accent,
  },
  ctaText: { color: colors.accentText, fontWeight: '700' },
});
