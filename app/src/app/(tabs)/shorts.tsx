import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View, type ViewToken } from 'react-native';
import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorState } from '../../components/ErrorState';
import { Glass } from '../../components/Glass';
import { Icon, type IconName } from '../../components/Icon';
import { ShortVideo, type ShortVideoHandle } from '../../components/ShortVideo';
import { Scrubber } from '../../components/Scrubber';
import { shareItem } from '../../components/engage/share';
import { CcButton, ShortCaptions } from '../../components/engage/Captions';
import { ShortInfo } from '../../components/engage/ShortInfo';
import { PostMenu } from '../../components/engage/PostMenu';
import { useLike } from '../../components/engage/useLike';
import { api, type Short } from '../../lib/api';
import { isBlocked, useBlocked } from '../../lib/blocked';
import { usePlayer } from '../../lib/player';
import { colors, spacing, type } from '../../theme';
import { useFetch } from '../../lib/useFetch';

export default function ShortsScreen() {
  const { data: all, error, reload } = useFetch(api.shorts);
  // Without anything from people this person hid.
  const blocked = useBlocked();
  const data = all && all.filter((s) => !isBlocked(blocked, s));
  // Coming back after a while picks up Shorts approved since.
  const loadedAt = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      // The first focus is the first load.
      if (!loadedAt.current) loadedAt.current = now;
      if (now - loadedAt.current < 60_000) return;
      loadedAt.current = now;
      reload();
    }, [reload])
  );
  const [height, setHeight] = useState(0);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const focused = useIsFocused();
  const { pause } = usePlayer();

  // Clips have their own sound, so pause the episode while watching.
  useEffect(() => {
    if (focused) pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  // FlatList needs the same callback for its whole life.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]) setVisibleId((viewableItems[0].item as Short).id);
  });

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
  const { episode: nowPlaying } = usePlayer();
  const [paused, setPaused] = useState(false);
  const video = useRef<ShortVideoHandle>(null);
  const [time, setTime] = useState({ position: 0, duration: 0 });

  // Scrolling away clears a pause, so it plays when you come back.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setPaused(false);
  }

  // Counts as a view after two seconds on screen (the server counts each device once).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => api.view('short', short.id).catch(() => {}), 2000);
    return () => clearTimeout(t);
  }, [active, short.id]);

  const like = useLike('short', short.id, short);
  const [menu, setMenu] = useState(false);

  const { width } = useWindowDimensions();
  // A wide video fills the tall screen by cropping its sides; focusX picks
  // which part stays in view (0.5 = centre, the same as plain "cover").
  const videoAspect = parseAspect(short.aspectRatio);
  const videoWidth = videoAspect ? height * videoAspect : 0;
  const videoStyle =
    videoWidth > width
      ? { position: 'absolute' as const, top: 0, height, width: videoWidth, left: -(videoWidth - width) * short.focusX }
      : StyleSheet.absoluteFill;

  // The video runs under the floating iOS tab bar (and the now-playing bar
  // above it); keep text and controls clear of both.
  const chrome = process.env.EXPO_OS === 'ios' ? insets.bottom + 54 + (nowPlaying ? 56 : 0) : nowPlaying ? 56 : 0;

  return (
    <View style={{ height, overflow: 'hidden' }}>
      <ShortVideo ref={video} uri={short.videoUrl} playing={active && !paused} style={videoStyle} focusX={short.focusX} onTime={(position, duration) => setTime({ position, duration })} />
      {/* Fade at the bottom so white text stays readable on bright video. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { experimental_backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.65) 100%)' }]} />
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setPaused((p) => !p)} accessibilityRole="button" accessibilityLabel={paused ? 'Play' : 'Pause'}>
        {paused && (
          <View style={styles.pausedIcon}>
            <Icon name="play" size={64} color="rgba(255,255,255,0.85)" />
          </View>
        )}
      </Pressable>
      <View style={[styles.cc, { top: insets.top + spacing.md - 2 }]}>
        <CcButton />
      </View>
      <Text style={[styles.counter, { top: insets.top + spacing.md }]}>
        {index + 1} / {total}
      </Text>
      <View style={[styles.actions, { bottom: chrome + 128 }]}>
        <Action icon={like.liked ? 'heartFill' : 'heart'} color={like.liked ? colors.liked : '#fff'} label={String(like.likes)} a11y={like.liked ? 'Unlike' : 'Like'} onPress={like.toggle} />
        <Action icon="comment" label={String(short.comments)} a11y="Comments" onPress={() => router.push(`/comments/short/${short.id}`)} />
        <Action
          icon="share"
          label="Share"
          a11y="Share"
          onPress={() => shareItem({ title: short.title, path: short.episodeId ? `/episode/${short.episodeId}` : '/shorts' })}
        />
        <Action icon="eye" label={String(short.views)} a11y={`${short.views} views`} />
        <Action icon="more" label="" a11y="More: report or hide" onPress={() => setMenu(true)} />
      </View>
      <PostMenu visible={menu} onClose={() => setMenu(false)} itemType="short" id={short.id} author={short.author} />
      <View style={[styles.overlay, { bottom: chrome + 44 }]} pointerEvents="box-none">
        <ShortCaptions id={short.id} position={time.position} />
        <ShortInfo short={short} />
      </View>
      {time.duration > 0 && (
        <View style={[styles.progress, { bottom: chrome }]}>
          <Scrubber variant="overlay" position={time.position} duration={time.duration} onSeek={(sec) => video.current?.seekTo(sec)} />
        </View>
      )}
    </View>
  );
}

function Action({ icon, label, a11y, onPress, color = '#fff' }: { icon: IconName; label: string; a11y: string; onPress?: () => void; color?: string }) {
  return (
    <Pressable style={styles.action} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={a11y} hitSlop={6}>
      <Glass style={styles.actionGlass} interactive={!!onPress}>
        <Icon name={icon} size={24} color={color} />
      </Glass>
      <Text style={[styles.actionLabel, styles.shadowed]}>{label}</Text>
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
  cc: { position: 'absolute', left: spacing.lg },
  counter: { position: 'absolute', right: spacing.lg, ...type.caption, color: 'rgba(255,255,255,0.8)', fontVariant: ['tabular-nums'] },
  // Leaves room on the right for the like/comment/share column.
  overlay: { position: 'absolute', left: spacing.lg, right: 76, gap: spacing.sm },
  actions: { position: 'absolute', right: spacing.md, alignItems: 'center', gap: spacing.lg },
  action: { alignItems: 'center', gap: spacing.xs, minWidth: 48 },
  actionGlass: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...type.caption, color: '#fff', fontWeight: '700', fontVariant: ['tabular-nums'] },
  shadowed: { textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 6 },
  progress: { position: 'absolute', left: 0, right: 0 },
});
