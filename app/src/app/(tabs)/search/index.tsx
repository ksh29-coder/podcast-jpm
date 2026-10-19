import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { EpisodeRow } from '../../../components/EpisodeRow';
import { api, type SearchResults } from '../../../lib/api';
import { formatTime } from '../../../lib/format';
import { usePlayer } from '../../../lib/player';
import { colors, radius, spacing, type } from '../../../theme';

// Search episodes, Shorts and what was said in them (transcripts), from the
// iOS 26 search tab.
export default function SearchScreen() {
  const { progress } = usePlayer();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ q: string; data: SearchResults } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();

  // Search a moment after typing stops.
  useEffect(() => {
    if (q.length < 2) return;
    const t = setTimeout(() => {
      api.search(q).then(
        (data) => {
          setResults({ q, data });
          setError(null);
        },
        (e) => setError(e instanceof Error ? e.message : String(e))
      );
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const data = q.length >= 2 && results?.q === q ? results.data : null;
  const loading = q.length >= 2 && results?.q !== q && !error;
  const empty = data && !data.episodes.length && !data.shorts.length && !data.moments.length;

  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      <Stack.SearchBar
        placement="automatic"
        placeholder="Episodes, Shorts, things people said"
        onChangeText={(e) => setQuery(e.nativeEvent.text)}
        textColor={colors.text}
        tintColor={colors.text}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
        {q.length < 2 && <Text style={[type.subhead, styles.hint]}>Search titles, tags, and everything said in episodes.</Text>}
        {loading && <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xxxl }} />}
        {error && <Text style={[type.subhead, styles.hint, { color: colors.danger }]}>Search failed: {error}</Text>}
        {empty && <Text style={[type.subhead, styles.hint]}>Nothing found for “{q}”.</Text>}

        {!!data?.moments.length && (
          <View style={styles.section}>
            <Text style={[type.eyebrow, styles.sectionTitle]}>Said in episodes</Text>
            {data.moments.map((m, i) => (
              <Pressable
                key={`${m.episodeId}-${m.startSec}-${i}`}
                onPress={() => router.push(`/episode/${m.episodeId}?t=${m.startSec}`)}
                style={({ pressed }) => [styles.moment, pressed && { backgroundColor: colors.card }]}
                accessibilityRole="button"
                accessibilityLabel={`Play ${m.episodeTitle} from ${formatTime(m.startSec)}: ${m.text}`}
              >
                <Text style={[type.footnote, { color: colors.highlight, fontVariant: ['tabular-nums'] }]}>
                  {m.episodeTitle} · {formatTime(m.startSec)}
                </Text>
                <Text style={type.body}>
                  <Highlighted text={m.text} q={q} />
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {!!data?.episodes.length && (
          <View style={styles.section}>
            <Text style={[type.eyebrow, styles.sectionTitle]}>Episodes</Text>
            {data.episodes.map((ep) => (
              <EpisodeRow key={ep.id} episode={ep} positionSec={progress[ep.id]?.positionSec} onPress={() => router.push(`/episode/${ep.id}`)} />
            ))}
          </View>
        )}

        {!!data?.shorts.length && (
          <View style={styles.section}>
            <Text style={[type.eyebrow, styles.sectionTitle]}>Shorts</Text>
            {data.shorts.map((s) => (
              <Pressable
                key={s.id}
                onPress={() =>
                  s.episodeId ? router.push(s.startSec != null ? `/episode/${s.episodeId}?t=${s.startSec}` : `/episode/${s.episodeId}`) : router.push('/shorts')
                }
                style={({ pressed }) => [styles.short, pressed && { backgroundColor: colors.card }]}
                accessibilityRole="button"
              >
                {s.artworkUrl ? <Image source={{ uri: s.artworkUrl }} style={styles.shortArt} /> : <View style={styles.shortArt} />}
                <View style={{ flex: 1, gap: spacing.xxs }}>
                  <Text style={type.headline} numberOfLines={2}>
                    {s.title}
                  </Text>
                  {s.episodeTitle && <Text style={type.footnote}>From “{s.episodeTitle}”</Text>}
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

// The matching part of a line, in the highlight color.
function Highlighted({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <Text style={{ color: colors.highlight, fontWeight: '700' }}>{text.slice(i, i + q.length)}</Text>
      {text.slice(i + q.length)}
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: spacing.huge },
  hint: { textAlign: 'center', paddingHorizontal: spacing.xxxl, paddingTop: spacing.xxxl },
  section: { paddingTop: spacing.lg },
  sectionTitle: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  moment: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  short: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  shortArt: { width: 44, height: 78, borderRadius: radius.sm, borderCurve: 'continuous', backgroundColor: colors.cardHigh },
});
