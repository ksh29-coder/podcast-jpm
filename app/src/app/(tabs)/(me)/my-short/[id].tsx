import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CaptionsEditor } from '../../../../components/engage/CaptionsEditor';
import { TagsField } from '../../../../components/post/TagsField';
import { api, type Cue, type MyEpisode, type MyShort } from '../../../../lib/api';
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
      {!isEpisode && <CaptionsEditor load={loadCaptions} save={short.status === 'in_review' ? saveCaptions : undefined} hints={() => ({ title, description, tags })} />}
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.button, (busy || !title.trim()) && { opacity: 0.4 }]} disabled={busy || !title.trim()} onPress={save} accessibilityRole="button">
        <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.xl, gap: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  input: { color: colors.text, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 16 },
  error: { color: colors.danger, fontSize: 14 },
  button: { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.md + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  buttonText: { color: colors.accentText, fontWeight: '700', fontSize: 17 },
});
