import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '../../components/Icon';
import { colors, radius, spacing, type } from '../../theme';

// The ＋ tab. On the phone, tapping it opens the camera over everything
// (see the tab layout) and this screen isn't shown; it's here for the web
// and for links.
export default function CreateTab() {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.screen}>
        <Text style={[type.subhead, { textAlign: 'center' }]}>Post Shorts from the AI Dev Wave app on your phone.</Text>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <Pressable style={styles.button} onPress={() => router.push('/post')} accessibilityRole="button">
        <Icon name="plus" size={18} color={colors.accentText} />
        <Text style={styles.buttonText}>Record or upload a Short</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, backgroundColor: colors.bg },
  button: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.full, backgroundColor: colors.accent },
  buttonText: { color: colors.accentText, fontWeight: '700', fontSize: 16 },
});
