import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Icon } from '../../components/Icon';
import { api, type Cue } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { usePlayer } from '../../lib/player';
import { useFetch } from '../../lib/useFetch';
import { colors, radius, spacing, type } from '../../theme';

// Read-along transcript, like Apple Podcasts: the line being said is
// highlighted and kept in view; tap any line to play from there.
export default function TranscriptSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, reload } = useFetch(() => Promise.all([api.transcript(id), api.episode(id)]), [id]);
  const player = usePlayer();
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const list = useRef<FlatList<Cue>>(null);

  const transcript = data?.[0];
  const episode = data?.[1];
  const cues = useMemo(() => transcript?.cues ?? [], [transcript]);
  const isCurrent = !!episode && player.episode?.id === episode.id;
  const now = isCurrent ? player.status.currentTime : -1;
  const active = isCurrent ? cues.findIndex((c) => now >= c.startSec && now < c.endSec) : -1;
  const q = query.trim().toLowerCase();
  const matches = q.length > 1 ? cues.filter((c) => c.text.toLowerCase().includes(q)).length : 0;

  // Keep the current line in view while following along.
  useEffect(() => {
    if (follow && active >= 0 && !q) list.current?.scrollToIndex({ index: active, viewPosition: 0.3, animated: true });
  }, [active, follow, q]);

  // Captions take a few minutes after publishing; check back while they're made.
  useEffect(() => {
    if (transcript?.status !== 'generating') return;
    const t = setTimeout(reload, 8000);
    return () => clearTimeout(t);
  }, [transcript?.status, reload]);

  const playFrom = (c: Cue) => {
    if (!episode) return;
    if (isCurrent) player.seekTo(c.startSec);
    else player.playEpisode(episode, c.startSec);
    setFollow(true);
  };

  if (error && !data) return <Message text={`Couldn’t load the transcript: ${error}`} />;
  if (!transcript || !episode) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.text} />;
  if (transcript.status === 'unavailable' || (transcript.status === 'none' && !episode.audioUrl)) {
    return <Message text="This episode has no transcript. Transcripts are made from spoken audio, and this video has no sound." />;
  }
  if (transcript.status !== 'ready') {
    return <Message text="The transcript is being prepared. It usually takes a few minutes after an episode is published." busy />;
  }

  return (
    <View style={styles.screen}>
      <Text style={[type.headline, styles.heading]} accessibilityRole="header">
        Transcript
      </Text>
      <View style={styles.searchRow}>
        <Icon name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search this episode"
          placeholderTextColor={colors.textFaint}
          style={styles.search}
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search the transcript"
        />
        {q.length > 1 && <Text style={type.caption}>{matches} found</Text>}
      </View>
      <FlatList
        ref={list}
        data={cues}
        keyExtractor={(c, i) => `${i}-${c.startSec}`}
        contentContainerStyle={styles.list}
        onScrollBeginDrag={() => setFollow(false)}
        onScrollToIndexFailed={({ index }) => setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.3 }), 300)}
        renderItem={({ item, index }) => {
          const hit = q.length > 1 && item.text.toLowerCase().includes(q);
          const current = index === active;
          return (
            <Pressable
              onPress={() => playFrom(item)}
              style={({ pressed }) => [styles.cue, hit && styles.hit, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={`${formatTime(item.startSec)}: ${item.text}`}
            >
              <Text style={[type.caption, styles.time, current && { color: colors.highlight }]}>{formatTime(item.startSec)}</Text>
              <Text style={[styles.text, current ? styles.textNow : active >= 0 && index < active ? styles.textPast : null]}>{item.text}</Text>
            </Pressable>
          );
        }}
      />
      {!follow && isCurrent && (
        <Pressable onPress={() => setFollow(true)} style={styles.followButton} accessibilityRole="button">
          <Text style={[type.footnote, { color: colors.accentText, fontWeight: '700' }]}>Follow along</Text>
        </Pressable>
      )}
    </View>
  );
}

function Message({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, gap: spacing.lg }]}>
      {busy && <ActivityIndicator color={colors.text} />}
      <Text style={[type.subhead, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: { textAlign: 'center', paddingTop: spacing.xl, paddingBottom: spacing.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  search: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: spacing.sm + 2 },
  list: { padding: spacing.xl, paddingBottom: 120, gap: spacing.xs },
  cue: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  hit: { backgroundColor: 'rgba(255,181,71,0.16)' },
  time: { width: 44, paddingTop: 4, fontVariant: ['tabular-nums'] },
  text: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: '700', color: colors.textMuted },
  textNow: { color: colors.text },
  textPast: { color: colors.textFaint },
  followButton: {
    position: 'absolute',
    bottom: spacing.xxxl,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});
