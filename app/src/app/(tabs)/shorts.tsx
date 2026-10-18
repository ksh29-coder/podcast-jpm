import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type ListViewToken } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ErrorState } from '../../components/ErrorState';
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

  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
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
  });

  useEffect(() => {
    if (active && !paused) player.play();
    else player.pause();
  }, [active, paused, player]);

  useEffect(() => {
    if (!active) setPaused(false);
  }, [active]);

  return (
    <View style={{ height }}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
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
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.episode} numberOfLines={1}>
          {short.episodeTitle}
        </Text>
        <Text style={styles.title}>{short.title}</Text>
        <Pressable style={styles.cta} onPress={() => router.push(`/episode/${short.episodeId}?t=${short.startSec}`)}>
          <Ionicons name="headset" size={16} color={colors.accentText} />
          <Text style={styles.ctaText}>Play full episode from here</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  pausedIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  counter: { position: 'absolute', right: 16, color: '#fff', fontSize: 13, opacity: 0.8 },
  overlay: { position: 'absolute', left: 16, right: 16, bottom: 20, gap: 6 },
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
