import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { CaptionsEditor } from '../../../components/engage/CaptionsEditor';
import { useHost } from '../../../components/host/HostGate';
import { Schedule } from '../../../components/host/Schedule';
import { ui } from '../../../components/host/ui';
import type { Cue } from '../../../lib/api';
import { parseTags, videoLabel, type HostShort } from '../../../lib/host';
import { colors, spacing, type } from '../../../theme';

// Edit a Short: title, tags, captions, and when it goes live.
export default function EditShort() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useHost();
  const [short, setShort] = useState<HostShort | null>(null);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    // There's no single-Short endpoint; the host list is small.
    api.shorts().then(
      (all) => {
        const s = all.find((x) => x.id === id) ?? null;
        setShort(s);
        if (s) {
          setTitle(s.title);
          setTags(s.tags.map((t) => `#${t}`).join(' '));
        } else setMessage({ text: 'Short not found', error: true });
      },
      (e) => setMessage({ text: e instanceof Error ? e.message : String(e), error: true })
    );
  }, [api, id]);

  const loadCaptions = useCallback(() => api.shortCaptions(id), [api, id]);
  const saveCaptions = useCallback((cues: Cue[]) => api.saveShortCaptions(id, cues), [api, id]);

  if (!short) {
    return message ? <Text style={[ui.error, { padding: spacing.xl }]}>{message.text}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.text} />;
  }

  const run = async (change: Parameters<typeof api.updateShort>[1], done: string) => {
    setSaving(true);
    try {
      setShort(await api.updateShort(short.id, change));
      setMessage({ text: done });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <View style={styles.section}>
        <Text style={type.eyebrow}>When it’s live</Text>
        <Schedule
          item={short}
          busy={saving}
          canPublish={!videoLabel(short.video)}
          onChange={(c) => run(c, c.status === 'draft' ? 'Unpublished.' : c.publishAt ? 'Scheduled.' : 'Published.')}
        />
      </View>
      <View style={styles.section}>
        <Text style={type.eyebrow}>Details</Text>
        <Text style={ui.label}>Title</Text>
        <TextInput style={ui.input} value={title} onChangeText={setTitle} maxLength={200} accessibilityLabel="Title" />
        <Text style={ui.label}>Tags</Text>
        <TextInput style={ui.input} value={tags} onChangeText={setTags} autoCapitalize="none" placeholder="#ai #testing" placeholderTextColor={colors.textFaint} accessibilityLabel="Tags" />
        {message && <Text style={message.error ? ui.error : ui.hint}>{message.text}</Text>}
        <Pressable
          style={[ui.button, { alignSelf: 'flex-start' }, (saving || !title.trim()) && ui.buttonDisabled]}
          disabled={saving || !title.trim()}
          onPress={() => run({ title: title.trim(), tags: parseTags(tags) }, 'Saved.')}
        >
          <Text style={ui.buttonText}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </Pressable>
      </View>
      <View style={styles.section}>
        <CaptionsEditor load={loadCaptions} save={saveCaptions} hints={() => ({ title, tags: parseTags(tags) })} waiting={!!videoLabel(short.video)} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
