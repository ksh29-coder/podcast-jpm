import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Episode } from '../lib/api';
import { formatDate, formatDuration } from '../lib/format';
import { colors } from '../lib/theme';

type Props = {
  episode: Episode;
  positionSec?: number;
  onPress: () => void;
  right?: React.ReactNode;
};

export function EpisodeRow({ episode, positionSec = 0, onPress, right }: Props) {
  const fraction = Math.min(1, positionSec / episode.durationSec);
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Image source={{ uri: episode.artworkUrl }} style={styles.art} />
      <View style={styles.body}>
        <Text style={styles.meta}>
          {formatDate(episode.publishedAt)} · {formatDuration(episode.durationSec)}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {episode.title}
        </Text>
        <Text style={styles.desc} numberOfLines={2}>
          {episode.description}
        </Text>
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
    gap: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  art: { width: 76, height: 76, borderRadius: 10, backgroundColor: colors.cardHigh },
  body: { flex: 1, gap: 4 },
  meta: { color: colors.textMuted, fontSize: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  desc: { color: colors.textMuted, fontSize: 13 },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.border, marginTop: 4 },
  fill: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
});
