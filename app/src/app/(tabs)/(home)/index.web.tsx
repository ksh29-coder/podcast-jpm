import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { ErrorState } from '../../../components/ErrorState';
import { Icon } from '../../../components/Icon';
import { Grid, Page, Section } from '../../../components/web/Page';
import { api, type Episode, type Short } from '../../../lib/api';
import { isBlocked, useBlocked } from '../../../lib/blocked';
import { formatDate, formatDuration } from '../../../lib/format';
import { usePlayer } from '../../../lib/player';
import { useFetch } from '../../../lib/useFetch';
import { colors, radius, spacing, tintWash, type, withAlpha } from '../../../theme';
import { hovered } from '../../../components/web/hover';

// The website's home: the newest episode large, then every episode as a grid
// and the latest Shorts in a row.
export default function HomeWeb() {
  const episodes = useFetch(api.episodes);
  const shorts = useFetch(api.shorts);
  const { progress } = usePlayer();
  // Without anything from people this person hid.
  const blocked = useBlocked();
  const shortList = shorts.data?.filter((s) => !isBlocked(blocked, s));

  if (episodes.error && !episodes.data) return <ErrorState message={episodes.error} onRetry={episodes.reload} />;
  if (!episodes.data) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.text} />;
  const [latest, ...rest] = episodes.data.filter((ep) => !isBlocked(blocked, ep));

  return (
    <Page>
      {latest ? (
        <Hero episode={latest} positionSec={progress[latest.id]?.positionSec ?? 0} />
      ) : (
        <Text style={type.subhead}>No episodes yet. New episodes appear here once a host publishes them.</Text>
      )}

      {!!shortList?.length && (
        <Section
          title="Shorts"
          action={
            <Pressable onPress={() => router.push('/shorts')} accessibilityRole="link">
              <Text style={styles.link}>Watch all</Text>
            </Pressable>
          }
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.lg }}>
            {shortList.slice(0, 12).map((s) => (
              <ShortCard key={s.id} short={s} />
            ))}
          </ScrollView>
        </Section>
      )}

      {rest.length > 0 && (
        <Section title="Earlier episodes">
          <Grid items={rest} min={220} render={(ep, w) => <EpisodeCard key={ep.id} episode={ep} width={w} positionSec={progress[ep.id]?.positionSec ?? 0} />} />
        </Section>
      )}
    </Page>
  );
}

function Hero({ episode, positionSec }: { episode: Episode; positionSec: number }) {
  const player = usePlayer();
  const playing = player.episode?.id === episode.id && player.status.playing;
  const started = positionSec > 5 && positionSec < episode.durationSec - 5;
  const hasAudio = !!episode.audioUrl;
  const glow = withAlpha(episode.tint || colors.tintFallback, 0.8);
  // Stacked in a phone-sized window.
  const narrow = useWindowDimensions().width < 700;
  const play = () => {
    if (!hasAudio) return router.push(`/episode/${episode.id}?mode=video`);
    if (playing) player.pause();
    else player.playEpisode(episode);
  };
  return (
    <View style={[styles.hero, narrow && styles.heroNarrow, { experimental_backgroundImage: tintWash(episode.tint) }]}>
      <Pressable onPress={() => router.push(`/episode/${episode.id}`)} accessibilityRole="link" accessibilityLabel={`Open ${episode.title}`}>
        <View style={[styles.heroArtWrap, { boxShadow: `0 20px 50px ${glow}` }]}>
          <Image source={{ uri: episode.artworkUrl }} style={styles.heroArt} />
        </View>
      </Pressable>
      <View style={styles.heroText}>
        <Text style={[type.eyebrow, { color: colors.highlight }]}>
          New episode · {formatDate(episode.publishedAt)} · {formatDuration(episode.durationSec)}
        </Text>
        <Pressable onPress={() => router.push(`/episode/${episode.id}`)} accessibilityRole="link">
          <Text style={[type.display, !narrow && { fontSize: 40, lineHeight: 46 }]} numberOfLines={2}>
            {episode.title}
          </Text>
        </Pressable>
        {episode.author && <Text style={type.subhead}>by {episode.author.name}</Text>}
        {!!(episode.summary || episode.description) && (
          <Text style={[type.body, { color: colors.textMuted }]} numberOfLines={3}>
            {episode.summary || episode.description}
          </Text>
        )}
        <View style={styles.heroActions}>
          <Pressable onPress={play} style={(s) => [styles.primary, hovered(s) && { opacity: 0.88 }]} accessibilityRole="button">
            <Icon name={playing ? 'pause' : hasAudio ? 'play' : 'video'} size={18} color={colors.accentText} />
            <Text style={[type.headline, { color: colors.accentText }]}>
              {playing ? 'Pause' : started ? `Resume · ${formatDuration(episode.durationSec - positionSec)} left` : hasAudio ? 'Play' : 'Watch'}
            </Text>
          </Pressable>
          {hasAudio && (
            <Pressable onPress={() => router.push(`/episode/${episode.id}?mode=video`)} style={(s) => [styles.secondary, hovered(s) && { backgroundColor: colors.border }]} accessibilityRole="button">
              <Icon name="video" size={18} />
              <Text style={type.headline}>Watch</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function EpisodeCard({ episode, width, positionSec }: { episode: Episode; width: number; positionSec: number }) {
  const fraction = episode.durationSec > 0 ? Math.min(1, positionSec / episode.durationSec) : 0;
  return (
    <Pressable
      onPress={() => router.push(`/episode/${episode.id}`)}
      style={(s) => [{ width, gap: spacing.sm }, hovered(s) && { opacity: 0.85 }]}
      accessibilityRole="link"
      accessibilityLabel={episode.title}
    >
      <View>
        <Image source={{ uri: episode.artworkUrl }} style={[styles.cardArt, { width, height: width }]} />
        {fraction > 0.01 && (
          <View style={styles.cardTrack}>
            <View style={[styles.cardFill, { width: `${fraction * 100}%` }]} />
          </View>
        )}
      </View>
      <Text style={type.headline} numberOfLines={2}>
        {episode.title}
      </Text>
      <Text style={type.footnote}>
        {formatDate(episode.publishedAt)} · {formatDuration(episode.durationSec)}
        {episode.author ? ` · ${episode.author.name}` : ''}
      </Text>
    </Pressable>
  );
}

function ShortCard({ short }: { short: Short }) {
  return (
    <Pressable onPress={() => router.push(`/shorts?id=${short.id}`)} style={(s) => [styles.short, hovered(s) && { opacity: 0.85 }]} accessibilityRole="link" accessibilityLabel={short.title}>
      {short.artworkUrl ? <Image source={{ uri: short.artworkUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.85) 100%)' }]} />
      <View style={styles.shortText}>
        <Text style={[type.headline, { color: '#fff' }]} numberOfLines={3}>
          {short.title}
        </Text>
        <Text style={[type.caption, { color: 'rgba(255,255,255,0.8)' }]} numberOfLines={1}>
          {[short.author?.name ?? short.episodeTitle, `${short.views} views`].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxxl, padding: spacing.xxxl, borderRadius: radius.xl, overflow: 'hidden' },
  heroNarrow: { flexDirection: 'column', alignItems: 'stretch', padding: spacing.xl, gap: spacing.xl },
  heroArtWrap: { borderRadius: radius.xl },
  heroArt: { width: 260, height: 260, borderRadius: radius.xl, backgroundColor: colors.cardHigh },
  heroText: { flexShrink: 1, flexGrow: 1, gap: spacing.md, minWidth: 0 },
  heroActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  primary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md, borderRadius: radius.full, backgroundColor: colors.accent },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md, borderRadius: radius.full, backgroundColor: colors.cardHigh },
  link: { ...type.subhead, color: colors.highlight, fontWeight: '700' },
  cardArt: { borderRadius: radius.lg, backgroundColor: colors.cardHigh },
  cardTrack: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  cardFill: { height: 4, backgroundColor: colors.highlight },
  short: { width: 180, height: 320, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.cardHigh, justifyContent: 'flex-end' },
  shortText: { padding: spacing.md, gap: spacing.xs },
});
