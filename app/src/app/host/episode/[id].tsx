import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useHost } from '../../../components/host/HostGate';
import { Schedule } from '../../../components/host/Schedule';
import { ui } from '../../../components/host/ui';
import { formatTime, parseChapters, parseTime } from '../../../lib/format';
import { parseTags, videoLabel, type HostEpisode, type Reach } from '../../../lib/host';
import { colors, radius, spacing, type } from '../../../theme';

// Edit an episode after upload: details, chapters, tags, cover frame,
// speaker names, and when it goes live. Also shows how far people got.
export default function EditEpisode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useHost();
  const [episode, setEpisode] = useState<HostEpisode | null>(null);
  const [reach, setReach] = useState<Reach | null>(null);
  const [form, setForm] = useState({ title: '', description: '', chapters: '', tags: '', cover: '', speakers: {} as Record<string, string> });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    api.episode(id).then(
      (ep) => {
        setEpisode(ep);
        setForm({
          title: ep.title,
          description: ep.description,
          chapters: ep.chapters.map((c) => `${formatTime(c.startSec)} ${c.title}`).join('\n'),
          tags: ep.tags.map((t) => `#${t}`).join(' '),
          cover: formatTime(ep.thumbnailSec ?? 0),
          speakers: ep.speakers ?? {},
        });
      },
      (e) => setMessage({ text: e instanceof Error ? e.message : String(e), error: true })
    );
    api.reach(id).then(setReach, () => setReach(null));
  }, [api, id]);

  if (!episode) {
    return message ? <Text style={[ui.error, { padding: spacing.xl }]}>{message.text}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.text} />;
  }

  const { chapters, bad } = parseChapters(form.chapters);
  const thumbnailSec = parseTime(form.cover);
  const formError = !form.title.trim()
    ? 'Add a title.'
    : bad.length
      ? `These chapter lines need a time first, like "1:30 Topic": ${bad.join(', ')}`
      : thumbnailSec === null
        ? 'Cover frame should look like 0:05.'
        : null;
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setMessage(null);
  };

  const save = async () => {
    if (formError) return;
    setSaving(true);
    try {
      const ep = await api.updateEpisode(episode.id, {
        title: form.title.trim(),
        description: form.description.trim(),
        chapters,
        tags: parseTags(form.tags),
        thumbnailSec: thumbnailSec ?? 0,
        speakers: Object.fromEntries(Object.entries(form.speakers).filter(([, v]) => v.trim())),
      });
      setEpisode(ep);
      setMessage({ text: 'Saved.' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (change: { status: HostEpisode['status']; publishAt?: string }) => {
    setSaving(true);
    try {
      setEpisode(await api.updateEpisode(episode.id, change));
      setMessage({ text: change.status === 'draft' ? 'Unpublished.' : change.publishAt ? 'Scheduled.' : 'Published.' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  };

  const speakerIds = [...new Set([...(episode.transcriptSpeakers ?? []), ...Object.keys({ ...episode.ai?.speakers, ...episode.speakers })])].sort(
    (a, b) => Number(a) - Number(b)
  );

  return (
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <Section title="When it’s live">
        <Schedule item={episode} busy={saving} canPublish={!videoLabel(episode.video, { needsAudio: true })} onChange={changeStatus} />
      </Section>

      <Section title="Details">
        <Text style={ui.label}>Title</Text>
        <TextInput style={ui.input} value={form.title} onChangeText={(v) => set({ title: v })} maxLength={200} accessibilityLabel="Title" />
        <Text style={ui.label}>Description</Text>
        <TextInput style={[ui.input, ui.multiline]} value={form.description} onChangeText={(v) => set({ description: v })} multiline accessibilityLabel="Description" />
        <Text style={ui.label}>Tags</Text>
        <TextInput style={ui.input} value={form.tags} onChangeText={(v) => set({ tags: v })} autoCapitalize="none" placeholder="#ai #testing" placeholderTextColor={colors.textFaint} accessibilityLabel="Tags" />
        <Text style={ui.label}>Chapters (one per line: time, then title)</Text>
        <TextInput
          style={[ui.input, ui.multiline, { fontVariant: ['tabular-nums'] }]}
          value={form.chapters}
          onChangeText={(v) => set({ chapters: v })}
          multiline
          placeholder={'0:00 Intro\n4:30 First topic'}
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Chapters"
        />
        <Text style={ui.label}>Cover image from</Text>
        <TextInput style={[ui.input, { maxWidth: 140 }]} value={form.cover} onChangeText={(v) => set({ cover: v })} placeholder="0:05" placeholderTextColor={colors.textFaint} accessibilityLabel="Cover image time" />
        {speakerIds.length > 0 && (
          <>
            <Text style={ui.label}>Speaker names (shown in the transcript)</Text>
            {speakerIds.map((n) => (
              <View key={n} style={ui.row}>
                <Text style={[type.footnote, { width: 80 }]}>Speaker {Number(n) + 1}</Text>
                <TextInput
                  style={[ui.input, { flexGrow: 1 }]}
                  value={form.speakers[n] ?? ''}
                  onChangeText={(v) => set({ speakers: { ...form.speakers, [n]: v } })}
                  placeholder={episode.ai?.speakers?.[n] ?? 'Name'}
                  placeholderTextColor={colors.textFaint}
                  maxLength={40}
                  accessibilityLabel={`Name of speaker ${Number(n) + 1}`}
                />
              </View>
            ))}
          </>
        )}
        {(formError || message) && <Text style={formError || message?.error ? ui.error : ui.hint}>{formError ?? message?.text}</Text>}
        <View style={ui.row}>
          <Pressable style={[ui.button, (saving || !!formError) && ui.buttonDisabled]} disabled={saving || !!formError} onPress={save}>
            <Text style={ui.buttonText}>{saving ? 'Saving…' : 'Save changes'}</Text>
          </Pressable>
          <Pressable style={[ui.button, ui.secondary]} onPress={() => router.push(`/host/ai/${episode.id}`)}>
            <Text style={ui.secondaryText}>AI assist</Text>
          </Pressable>
          {Platform.OS === 'web' && episode.video && (
            <Pressable style={[ui.button, ui.secondary]} onPress={() => router.push(`/host/edit/${episode.id}`)}>
              <Text style={ui.secondaryText}>Edit video</Text>
            </Pressable>
          )}
        </View>
      </Section>

      <Section title="How far people got">
        {!reach || reach.listeners === 0 ? (
          <Text style={ui.hint}>No listeners yet.</Text>
        ) : (
          <>
            <Text style={ui.hint}>
              Of {reach.listeners} {reach.listeners === 1 ? 'person' : 'people'} who started it, the share who reached each point.
            </Text>
            {reach.points.map((p) => (
              <View key={p.percent} style={styles.bar} accessible accessibilityLabel={`${Math.round(p.share * 100)}% reached ${formatTime(p.atSec)}`}>
                <Text style={[type.caption, styles.barLabel]}>{p.percent === 100 ? 'End' : formatTime(p.atSec)}</Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.max(2, p.share * 100)}%` }]} />
                </View>
                <Text style={[type.caption, styles.barValue]}>{Math.round(p.share * 100)}%</Text>
              </View>
            ))}
          </>
        )}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={type.eyebrow}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { width: 44, fontVariant: ['tabular-nums'] },
  barValue: { width: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },
  track: { flex: 1, height: 10, borderRadius: radius.sm, backgroundColor: colors.card, overflow: 'hidden' },
  fill: { height: 10, borderRadius: radius.sm, backgroundColor: colors.highlight },
});
