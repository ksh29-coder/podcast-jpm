import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Episode } from '../lib/api';
import { formatDate, formatDuration } from '../lib/format';
import { colors, radius, spacing, type } from '../theme';

type Props = {
  episode: Episode;
  positionSec?: number;
  onPress: () => void;
  right?: React.ReactNode;
};

// One episode in a list: artwork, date and length, title, and how far you got.
// Rows sit on the page with hairline separators rather than in cards.
export function EpisodeRow({ episode, positionSec = 0, onPress, right }: Props) {
  const fraction = episode.durationSec > 0 ? Math.min(1, positionSec / episode.durationSec) : 0;
  const left = Math.max(0, episode.durationSec - positionSec);
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.card }]} onPress={onPress} accessibilityRole="button">
      <Image source={{ uri: episode.artworkUrl }} style={styles.art} />
      <View style={styles.body}>
        <Text style={type.footnote}>
          {formatDate(episode.publishedAt)} · {fraction > 0 && fraction < 0.98 ? `${formatDuration(left)} left` : formatDuration(episode.durationSec)}
          {!episode.audioUrl ? ' · Video' : ''}
        </Text>
        <Text style={type.headline} numberOfLines={2}>
          {episode.title}
        </Text>
        {!!episode.description && (
          <Text style={type.footnote} numberOfLines={2}>
            {episode.description}
          </Text>
        )}
        {fraction > 0 && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
          </View>
        )}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  art: { width: 72, height: 72, borderRadius: radius.md, borderCurve: 'continuous', backgroundColor: colors.cardHigh },
  body: { flex: 1, gap: spacing.xxs },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.cardHigh, marginTop: spacing.xs, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: colors.text },
});
