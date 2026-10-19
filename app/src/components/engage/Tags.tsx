import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../lib/theme';

// "#ai #testing" chips. `light` is for text over video.
export function Tags({ tags, light = false }: { tags: string[]; light?: boolean }) {
  if (!tags.length) return null;
  return (
    <View style={styles.row}>
      {tags.map((t) => (
        <Text key={t} style={[styles.tag, light && styles.light]}>
          #{t}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  light: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
});
