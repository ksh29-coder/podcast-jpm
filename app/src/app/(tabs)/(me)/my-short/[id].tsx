import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { CaptionsEditor } from '../../../../components/engage/CaptionsEditor';
import { TagsField } from '../../../../components/post/TagsField';
import { api, type Cue, type MyEpisode, type MyShort, type ShortPictures } from '../../../../lib/api';
import { colors, radius, spacing, type } from '../../../../theme';

// Change a Short's or episode's details while it waits for review.
// Episode ids start with "ep_".
export default function EditMyShort() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isEpisode = id.startsWith('ep_');
  const [short, setShort] = useState<MyShort | MyEpisode | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (isEpisode ? api.myEpisodes() : api.myShorts()).then(
      (all: (MyShort | MyEpisode)[]) => {
        const s = all.find((x) => x.id === id);
        if (!s) return setError('Short not found');
        setShort(s);
        setTitle(s.title);
        setDescription(s.description);
        setTags(s.tags);
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  }, [id, isEpisode]);

  const loadCaptions = useCallback(() => api.myShortCaptions(id), [id]);
  const saveCaptions = useCallback((cues: Cue[]) => api.saveMyShortCaptions(id, cues), [id]);

  if (!short) return error ? <Text style={[styles.error, { padding: spacing.xl }]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.text} />;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const details = { title: title.trim(), description: description.trim(), tags };
      await (isEpisode ? api.updateMyEpisode(short.id, details) : api.updateMyShort(short.id, details));
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={type.eyebrow}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={100} accessibilityLabel="Title" />
      <Text style={type.eyebrow}>Description</Text>
      <TextInput style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]} value={description} onChangeText={setDescription} maxLength={1000} multiline accessibilityLabel="Description" />
      <Text style={type.eyebrow}>Tags</Text>
      <TagsField tags={tags} onChange={setTags} />
      {!isEpisode && <Pictures id={id} />}
      {!isEpisode && <CaptionsEditor load={loadCaptions} save={short.status === 'in_review' ? saveCaptions : undefined} hints={() => ({ title, description, tags })} />}
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.button, (busy || !title.trim()) && { opacity: 0.4 }]} disabled={busy || !title.trim()} onPress={save} accessibilityRole="button">
        <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  );
}

// The Short's pictures: what's in it, whether they're still being added, and
// a way to change them while it's in review.
function Pictures({ id }: { id: string }) {
  const [data, setData] = useState<ShortPictures | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Fresh when coming back from changing them, and every few seconds while
  // they're being added.
  useFocusEffect(
    useCallback(() => {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout>;
      const tick = () =>
        api.myShortPictures(id).then(
          (d) => {
            if (stopped) return;
            setData(d);
            if (d.edit.status === 'queued' || d.edit.status === 'rendering') timer = setTimeout(tick, 5000);
          },
          () => {}
        );
      tick();
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    }, [id])
  );

  // Live Shorts' pictures are part of the video for good.
  if (!data || (!data.editable && !data.pictures.length)) return null;
  const { status, error } = data.edit;
  const n = data.pictures.length;
  let line = n ? `${n} picture${n === 1 ? '' : 's'} in the video.` : 'No pictures.';
  if (status === 'queued' || status === 'rendering') line = 'Adding the pictures to the video… This takes a minute or two.';
  if (status === 'failed') line = `The pictures couldn’t be added: ${error || 'something went wrong'}`;

  const retry = async () => {
    setRetrying(true);
    try {
      setData(await api.saveMyShortPictures(id, data.pictures.map(({ picture, ...placement }) => placement)));
    } catch {
      // The line above still says it failed.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View style={styles.pictures}>
      <Text style={type.eyebrow}>Pictures</Text>
      <View style={styles.line}>
        {data.pictures.map((p, i) => (
          <Image key={i} source={{ uri: p.picture.url }} style={styles.thumb} />
        ))}
        <Text style={[type.footnote, { flex: 1 }, status === 'failed' && styles.error]}>{line}</Text>
      </View>
      {data.editable && (
        <View style={styles.line}>
          {status !== 'rendering' && (
            <Pressable style={styles.small} onPress={() => router.push(`/my-short/pictures/${id}`)} accessibilityRole="button">
              <Text style={styles.smallText}>{n ? 'Change pictures' : 'Add pictures'}</Text>
            </Pressable>
          )}
          {status === 'failed' && (
            <Pressable style={styles.small} disabled={retrying} onPress={retry} accessibilityRole="button">
              <Text style={styles.smallText}>{retrying ? 'Trying…' : 'Try again'}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pictures: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.card },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumb: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.cardHigh },
  small: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.cardHigh },
  smallText: { color: colors.text, fontWeight: '700' },
  page: { padding: spacing.xl, gap: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  input: { color: colors.text, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 16 },
  error: { color: colors.danger, fontSize: 14 },
  button: { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.md + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  buttonText: { color: colors.accentText, fontWeight: '700', fontSize: 17 },
});
