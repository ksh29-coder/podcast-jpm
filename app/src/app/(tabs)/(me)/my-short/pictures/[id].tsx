import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PictureEditor } from '../../../../../components/post/PictureEditor';
import { api, type PlacedPicture, type ShortPictures } from '../../../../../lib/api';
import { colors, radius, spacing, type } from '../../../../../theme';

// Change a Short's pictures while it waits for review. Saving makes the video
// again with them, from the copy without pictures.
export default function EditPictures() {
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

  if (!data) return error ? <Text style={[styles.error, { padding: spacing.xl }]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.text} />;

  const busy = data.edit.status === 'rendering';
  if (!data.editable || !data.videoUrl || busy) {
    return (
      <Text style={[type.subhead, { padding: spacing.xl }]}>
        {busy ? 'Your last change is still being added to the video. Come back in a minute.' : 'Pictures can’t be changed once the Short is live.'}
      </Text>
    );
  }

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

  return (
    <View style={styles.screen}>
      <PictureEditor uri={data.videoUrl} durationSec={data.durationSec ?? 0} aspect={parseAspect(data.aspectRatio)} pictures={pictures} onChange={setPictures} />
      <View style={styles.bottom}>
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={[styles.button, saving && { opacity: 0.4 }]} disabled={saving} onPress={save} accessibilityRole="button">
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save pictures'}</Text>
        </Pressable>
        <Text style={[type.footnote, { textAlign: 'center' }]}>The video is made again with them; that takes a minute or two.</Text>
      </View>
    </View>
  );
}

// "9:16" -> 0.5625.
function parseAspect(ratio: string | null) {
  const [w, h] = (ratio ?? '').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', paddingTop: spacing.md, gap: spacing.md },
  bottom: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, width: '100%', maxWidth: 760, alignSelf: 'center' },
  error: { color: colors.danger, fontSize: 14 },
  button: { alignItems: 'center', paddingVertical: spacing.md + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  buttonText: { color: colors.accentText, fontWeight: '700', fontSize: 17 },
});
