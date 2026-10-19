import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { EpisodeRow } from '../../../components/EpisodeRow';
import { ErrorState } from '../../../components/ErrorState';
import { Icon } from '../../../components/Icon';
import { api, type Episode } from '../../../lib/api';
import { formatDate, formatDuration } from '../../../lib/format';
import { usePlayer } from '../../../lib/player';
import { useFetch } from '../../../lib/useFetch';
import { colors, radius, spacing, tintWash, type, withAlpha } from '../../../theme';

export default function EpisodesScreen() {
  const { data, error, loading, reload } = useFetch(api.episodes);
  const { progress } = usePlayer();

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.text} />;

  const [latest, ...rest] = data;
  return (
    // The newest episode's color washes down from the top of the screen.
    // collapsable={false} keeps iOS's automatic insets on the list inside.
    <View collapsable={false} style={{ flex: 1, backgroundColor: colors.bg, experimental_backgroundImage: tintWash(latest?.tint) }}>
      <FlatList
        data={rest}
        keyExtractor={(ep) => ep.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: spacing.huge }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.text} />}
        ListHeaderComponent={
          latest ? (
            <>
              <Featured episode={latest} positionSec={progress[latest.id]?.positionSec ?? 0} />
              {rest.length > 0 && <Text style={[type.eyebrow, styles.section]}>Earlier episodes</Text>}
            </>
          ) : null
        }
        ListEmptyComponent={
          latest ? null : <Text style={[type.subhead, styles.empty]}>No episodes yet. New episodes appear here once a host publishes them.</Text>
        }
        renderItem={({ item }) => (
          <EpisodeRow episode={item} positionSec={progress[item.id]?.positionSec} onPress={() => router.push(`/episode/${item.id}`)} />
        )}
      />
    </View>
  );
}

// The newest episode, shown large: cover art with a glow in its own color,
// then Play (or Resume) and Watch.
function Featured({ episode, positionSec }: { episode: Episode; positionSec: number }) {
  const player = usePlayer();
  const { width } = useWindowDimensions();
  const art = Math.min(width - spacing.xxxl * 2, 300);
  const isCurrent = player.episode?.id === episode.id;
  const playing = isCurrent && player.status.playing;
  const started = positionSec > 5 && positionSec < episode.durationSec - 5;
  const hasAudio = !!episode.audioUrl;
  const glow = withAlpha(episode.tint || colors.tintFallback, 0.9);

  const play = () => {
    if (!hasAudio) return router.push(`/episode/${episode.id}`);
    if (playing) player.pause();
    else player.playEpisode(episode);
  };

  return (
    <View style={styles.featured}>
      <Pressable onPress={() => router.push(`/episode/${episode.id}`)} accessibilityRole="button" accessibilityLabel={`Open ${episode.title}`}>
        <View style={[styles.featuredArt, { width: art, height: art, boxShadow: `0 18px 48px ${glow}` }]}>
          <Image source={{ uri: episode.artworkUrl }} style={[styles.featuredArt, { width: art, height: art }]} />
        </View>
      </Pressable>
      <View style={styles.featuredText}>
        <Text style={[type.eyebrow, { color: colors.highlight }]}>
          New episode · {formatDate(episode.publishedAt)}
        </Text>
        <Text style={[type.display, { textAlign: 'center' }]} numberOfLines={3}>
          {episode.title}
        </Text>
        {!!episode.description && (
          <Text style={[type.subhead, { textAlign: 'center' }]} numberOfLines={3}>
            {episode.description}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={play}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : started ? 'Resume' : hasAudio ? 'Play' : 'Watch'}
        >
          <Icon name={playing ? 'pause' : hasAudio ? 'play' : 'video'} size={18} color={colors.accentText} />
          <Text style={[type.headline, { color: colors.accentText }]}>
            {playing ? 'Pause' : started ? `Resume · ${formatDuration(episode.durationSec - positionSec)} left` : hasAudio ? 'Play' : 'Watch'}
          </Text>
        </Pressable>
        {hasAudio && (
          <Pressable
            onPress={() => router.push(`/episode/${episode.id}?mode=video`)}
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Watch the video"
          >
            <Icon name="video" size={18} />
            <Text style={type.headline}>Watch</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  featured: { alignItems: 'center', gap: spacing.xxl, paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, paddingBottom: spacing.xxxl },
  featuredArt: { borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.cardHigh },
  featuredText: { alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap', justifyContent: 'center' },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.cardHigh,
  },
  section: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  empty: { textAlign: 'center', paddingHorizontal: spacing.xxxl, paddingTop: spacing.huge },
});
