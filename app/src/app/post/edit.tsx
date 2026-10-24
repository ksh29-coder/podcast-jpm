import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PictureEditor } from '../../components/post/PictureEditor';
import { NoVideo, usePost } from '../../components/post/PostContext';
import { colors, radius, spacing, type } from '../../theme';

// Pictures for the Short, while it uploads (optional). Reached from trim,
// or from the details to change them (from=details).
export default function PostEdit() {
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { picked, upload, kept, pictures, setPictures } = usePost();

  if (!picked || !upload || !kept) return <NoVideo />;

  const next = () => (from === 'details' ? router.back() : router.replace('/post/details'));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[type.headline, { color: '#fff' }]}>Add pictures</Text>
          <Text style={[type.footnote, { color: 'rgba(255,255,255,0.75)' }]}>Optional. The sound keeps playing under them.</Text>
        </View>
        <Pressable style={styles.next} onPress={next} accessibilityRole="button">
          <Text style={styles.nextText}>{from === 'details' ? 'Back' : pictures.length ? 'Next' : 'Skip'}</Text>
        </Pressable>
      </View>
      <View style={styles.editor}>
        <PictureEditor uri={picked.uri} startSec={kept.startSec} durationSec={kept.durationSec} pictures={pictures} onChange={setPictures} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
  next: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  nextText: { color: colors.accentText, fontWeight: '700', fontSize: 16 },
  editor: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
});
