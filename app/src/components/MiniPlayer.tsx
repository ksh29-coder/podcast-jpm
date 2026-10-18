import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { usePlayer } from '../lib/player';
import { colors } from '../lib/theme';

export function MiniPlayer() {
  const { episode, status, togglePlay } = usePlayer();
  if (!episode) return null;

  const fraction = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <Pressable style={styles.bar} onPress={() => router.push(`/episode/${episode.id}`)}>
      <View style={[styles.progress, { width: `${fraction * 100}%` }]} />
      <Image source={{ uri: episode.artworkUrl }} style={styles.art} />
      <Text style={styles.title} numberOfLines={1}>
        {episode.title}
      </Text>
      <Pressable onPress={togglePlay} hitSlop={12} accessibilityLabel={status.playing ? 'Pause' : 'Play'}>
        <Ionicons name={status.playing ? 'pause' : 'play'} size={26} color={colors.text} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.cardHigh,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  progress: { position: 'absolute', top: 0, left: 0, height: 2, backgroundColor: colors.accent },
  art: { width: 40, height: 40, borderRadius: 6, backgroundColor: colors.card },
  title: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
});
