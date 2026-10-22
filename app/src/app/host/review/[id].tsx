import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AiCheckLine } from '../../../components/host/AiCheckLine';
import { ReportsLine } from '../../../components/host/cards';
import { useHost } from '../../../components/host/HostGate';
import { ui } from '../../../components/host/ui';
import { TagsField } from '../../../components/post/TagsField';
import { ShortVideo } from '../../../components/ShortVideo';
import { formatWhen, videoLabel, type HostEpisode, type HostShort } from '../../../lib/host';
import { colors, radius, spacing } from '../../../theme';

// Review a Short or episode someone posted: watch it, fix the details if
// needed, then approve it (it goes live) or reject it with an optional note
// for them. Episode ids start with "ep_".
export default function ReviewShort() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useHost();
  const isEpisode = id.startsWith('ep_');
  const [short, setShort] = useState<HostShort | HostEpisode | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // There's no single-Short endpoint; the host lists are small.
    (isEpisode ? api.episodes() : api.shorts()).then(
      (all: (HostShort | HostEpisode)[]) => {
        const s = all.find((x) => x.id === id);
        if (!s) return setError('Short not found');
        setShort(s);
        setTitle(s.title);
        setDescription(s.description);
        setTags(s.tags);
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  }, [api, id, isEpisode]);

  if (!short) return error ? <Text style={[ui.error, { padding: spacing.xl }]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.text} />;

  const processing = videoLabel(short.video, { needsAudio: isEpisode });
  const decide = async (change: Parameters<typeof api.updateShort>[1] & Parameters<typeof api.updateEpisode>[1]) => {
    setBusy(true);
    setError(null);
    try {
      await (isEpisode ? api.updateEpisode(short.id, change) : api.updateShort(short.id, change));
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <View style={[styles.player, isEpisode && styles.playerWide]}>
        {processing ? (
          <Text style={[ui.hint, { textAlign: 'center' }]}>{processing}</Text>
        ) : (
          <ShortVideo uri={short.videoUrl} playing style={StyleSheet.absoluteFill} focusX={'focusX' in short ? short.focusX : 0.5} fit={isEpisode ? 'contain' : 'cover'} onTime={() => {}} />
        )}
      </View>
      <Text style={ui.hint}>
        {isEpisode ? 'Episode' : 'Short'} posted by {short.author?.name ?? 'a host'} · {formatWhen(short.createdAt)}
      </Text>
      <View style={ui.card}>
        <ReportsLine reports={short.reports} />
        <AiCheckLine check={short.aiCheck} />
        <Text style={ui.hint}>The AI only reads what’s said. Check what’s on screen yourself, such as code or documents.</Text>
      </View>

      <Text style={ui.label}>Title</Text>
      <TextInput style={ui.input} value={title} onChangeText={setTitle} maxLength={100} accessibilityLabel="Title" />
      <Text style={ui.label}>Description</Text>
      <TextInput style={[ui.input, ui.multiline]} value={description} onChangeText={setDescription} maxLength={1000} multiline accessibilityLabel="Description" />
      <Text style={ui.label}>Tags</Text>
      <TagsField tags={tags} onChange={setTags} />

      {error && <Text style={ui.error}>{error}</Text>}
      {rejecting ? (
        <View style={ui.card}>
          <Text style={ui.label}>Note for {short.author?.name ?? 'them'} (optional)</Text>
          <TextInput
            style={[ui.input, ui.multiline]}
            value={note}
            onChangeText={setNote}
            maxLength={500}
            multiline
            autoFocus
            placeholder="e.g. Please blur the client name at 0:12 and post it again."
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Note for the uploader"
          />
          <View style={ui.row}>
            <Pressable style={[ui.button, styles.danger, busy && ui.buttonDisabled]} disabled={busy} onPress={() => decide({ status: 'rejected', reviewNote: note.trim() || null })}>
              <Text style={ui.buttonText}>Reject</Text>
            </Pressable>
            <Pressable style={[ui.button, ui.secondary]} onPress={() => setRejecting(false)}>
              <Text style={ui.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={ui.row}>
          <Pressable
            style={[ui.button, (busy || !!processing || !title.trim()) && ui.buttonDisabled]}
            disabled={busy || !!processing || !title.trim()}
            onPress={() => decide({ title: title.trim(), description: description.trim(), tags, status: 'published' })}
          >
            <Text style={ui.buttonText}>{busy ? 'Saving…' : short.status === 'published' ? 'Keep it up' : 'Approve and publish'}</Text>
          </Pressable>
          <Pressable style={[ui.button, ui.secondary]} onPress={() => setRejecting(true)}>
            {/* Already live (a reported host episode or Short): taking it down. */}
            <Text style={ui.secondaryText}>{short.status === 'published' ? 'Take down…' : 'Reject…'}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  player: { width: '100%', maxWidth: 320, aspectRatio: 9 / 16, alignSelf: 'center', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', justifyContent: 'center' },
  playerWide: { maxWidth: 820, aspectRatio: 16 / 9 },
  danger: { backgroundColor: colors.danger },
});
