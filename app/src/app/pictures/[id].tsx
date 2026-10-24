import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PictureEditor } from '../../components/post/PictureEditor';
import { api, type PlacedPicture, type ShortPictures } from '../../lib/api';
import { colors, radius, spacing, type } from '../../theme';

// Change a Short's pictures while it waits for review (from its page in Me).
// Saving makes the video again with them, from the copy without pictures.
// Full screen, like the ＋ flow's pictures step, so the editor has the room.
export default function EditPictures() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<ShortPictures | null>(null);
  const [pictures, setPictures] = useState<PlacedPicture[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.myShortPictures(id).then(
      (d) => {
        setData(d);
        setPictures(d.pictures);
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  }, [id]);

  const busy = data?.edit.status === 'rendering';
  const ready = data && data.editable && data.videoUrl && !busy;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveMyShortPictures(
        id,
        pictures.map(({ picture, ...placement }) => placement)
      );
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  let body;
  if (!data) body = error ? <Text style={[styles.error, styles.message]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color="#fff" />;
  else if (!ready)
    body = (
      <Text style={[type.subhead, styles.message, { color: '#fff' }]}>
        {busy ? 'Your last change is still being added to the video. Come back in a minute.' : 'Pictures can’t be changed once the Short is live.'}
      </Text>
    );
  else
    body = (
      <View style={styles.editor}>
        <PictureEditor uri={data.videoUrl!} durationSec={data.durationSec ?? 0} aspect={parseAspect(data.aspectRatio)} pictures={pictures} onChange={setPictures} />
      </View>
    );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.header}>
        <Pressable style={styles.cancel} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.headline, { color: '#fff' }]}>Pictures</Text>
          {ready && <Text style={[type.footnote, { color: 'rgba(255,255,255,0.75)' }]}>Saving makes the video again; that takes a minute or two.</Text>}
        </View>
        {ready && (
          <Pressable style={[styles.save, saving && { opacity: 0.4 }]} disabled={saving} onPress={save} accessibilityRole="button">
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        )}
      </View>
      {ready && error && <Text style={[styles.error, { paddingHorizontal: spacing.lg }]}>{error}</Text>}
      {body}
    </View>
  );
}

// "9:16" -> 0.5625.
function parseAspect(ratio: string | null) {
  const [w, h] = (ratio ?? '').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
  cancel: { paddingVertical: spacing.sm },
  cancelText: { color: '#fff', fontSize: 16 },
  save: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  saveText: { color: colors.accentText, fontWeight: '700', fontSize: 16 },
  editor: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  message: { padding: spacing.xl },
  error: { color: colors.danger, fontSize: 14 },
});
