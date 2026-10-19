import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePlayer } from '../lib/player';
import { colors, radius, spacing, type } from '../theme';
import { Icon, skipIcon } from './Icon';

// Now-playing bar in the tab bar's accessory slot. iOS draws the glass behind
// it and shows it in two placements: 'regular' above the tab bar, and
// 'inline' squeezed into the bar once it shrinks on scroll. Both copies render
// at once, so all state comes from the shared player.
export function MiniPlayer() {
  const { episode, status, togglePlay, seekBy, prefs } = usePlayer();
  const placement = NativeTabs.BottomAccessory.usePlacement();
  if (!episode) return null;

  const open = () => router.push(`/episode/${episode.id}`);
  const playPause = (
    <Pressable onPress={togglePlay} hitSlop={10} accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause' : 'Play'}>
      <Icon name={status.playing ? 'pause' : 'play'} size={placement === 'inline' ? 18 : 22} />
    </Pressable>
  );

  if (placement === 'inline') {
    return (
      <View style={styles.inline}>
        <Pressable onPress={open} style={styles.inlineInfo} accessibilityRole="button" accessibilityLabel={`Now playing: ${episode.title}`}>
          <Image source={{ uri: episode.artworkUrl }} style={styles.inlineArt} />
          <Text style={[type.footnote, { color: colors.text, flex: 1 }]} numberOfLines={1}>
            {episode.title}
          </Text>
        </Pressable>
        {playPause}
      </View>
    );
  }

  return (
    <View style={styles.regular}>
      <Pressable onPress={open} style={styles.info} accessibilityRole="button" accessibilityLabel={`Now playing: ${episode.title}. Open player`}>
        <Image source={{ uri: episode.artworkUrl }} style={styles.art} />
        <Text style={[type.subhead, { color: colors.text, flex: 1, fontWeight: '600' }]} numberOfLines={1}>
          {episode.title}
        </Text>
      </Pressable>
      {playPause}
      <Pressable onPress={() => seekBy(prefs.skipForward)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Forward ${prefs.skipForward} seconds`}>
        <Icon name={skipIcon('forward', prefs.skipForward)} size={22} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  regular: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.md },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  art: { width: 34, height: 34, borderRadius: radius.sm, borderCurve: 'continuous', backgroundColor: colors.cardHigh },
  inline: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  inlineInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inlineArt: { width: 24, height: 24, borderRadius: 6, borderCurve: 'continuous', backgroundColor: colors.cardHigh },
});
