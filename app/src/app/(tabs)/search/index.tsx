import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { EpisodeRow } from '../../../components/EpisodeRow';
import { Icon } from '../../../components/Icon';
import { api, type SearchResults } from '../../../lib/api';
import { isBlocked, useBlocked } from '../../../lib/blocked';
import { formatTime } from '../../../lib/format';
import { usePlayer } from '../../../lib/player';
import { colors, radius, spacing, type } from '../../../theme';
import { openEpisode } from '../../../lib/openEpisode';

// Search episodes, Shorts and what was said in them (transcripts), from the
// iOS 26 search tab, or a search box at the top of the page on the website.
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

  const blocked = useBlocked();
  const found = q.length >= 2 && results?.q === q ? results.data : null;
  // Without anything from people this person hid.
  const data = found && { ...found, episodes: found.episodes.filter((e) => !isBlocked(blocked, e)), shorts: found.shorts.filter((s) => !isBlocked(blocked, s)) };
  const loading = q.length >= 2 && results?.q !== q && !error;
  const empty = data && !data.episodes.length && !data.shorts.length && !data.moments.length;

  return (
    <>
      <Stack.Screen options={{ title: 'Search', headerShown: !web }} />
      {!web && (
        <Stack.SearchBar
          placement="automatic"
          placeholder="Episodes, Shorts, things people said"
          onChangeText={(e) => setQuery(e.nativeEvent.text)}
          textColor={colors.text}
          tintColor={colors.text}
        />
      )}
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.page, web && styles.pageWeb]}>
        {web && (
          <View style={styles.webBox}>
            <Icon name="search" size={20} color={colors.textMuted} />
            <TextInput
              style={styles.webInput}
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder="Search episodes, Shorts, and things people said"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Search"
            />
            <Pressable onPress={() => router.push('/assistant')} style={styles.webMic} accessibilityRole="button" accessibilityLabel="Ask out loud">
              <Icon name="mic" size={18} color={colors.accentText} />
            </Pressable>
          </View>
        )}
        {q.length < 2 && <AskCard />}
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
                onPress={() => openEpisode('search', `/episode/${m.episodeId}?t=${m.startSec}`)}
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
              <EpisodeRow key={ep.id} episode={ep} positionSec={progress[ep.id]?.positionSec} onPress={() => openEpisode('search', `/episode/${ep.id}`)} />
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
                  // The website's Shorts page can open on this one.
                  web
                    ? router.push(`/shorts?id=${s.id}`)
                    : s.episodeId
                      ? openEpisode('search', s.startSec != null ? `/episode/${s.episodeId}?t=${s.startSec}` : `/episode/${s.episodeId}`)
                      : router.push('/shorts')
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

const web = Platform.OS === 'web';

// The way into the voice assistant: talk instead of typing.
function AskCard() {
  return (
    <Pressable onPress={() => router.push('/assistant')} style={({ pressed }) => [styles.ask, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Ask AI Wave out loud">
      <View style={styles.askMic}>
        <Icon name="mic" size={26} color={colors.accentText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.headline}>Ask out loud</Text>
        <Text style={type.footnote}>Talk to find episodes, Shorts and moments, like “what do we have on testing?”</Text>
      </View>
    </Pressable>
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
  pageWeb: { width: '100%', maxWidth: 900, alignSelf: 'center', paddingTop: spacing.xxxl },
  webBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // The rounded box around it shows focus; no browser outline inside it
  // ('none' is web-only, so React Native's types don't list it).
  webMic: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  ask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    margin: spacing.xl,
    marginBottom: 0,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  askMic: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },
  webInput: { flex: 1, color: colors.text, fontSize: 17, paddingVertical: spacing.md, outlineStyle: 'none' as 'solid' },
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
