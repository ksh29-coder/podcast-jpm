import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useHost } from '../../../components/host/HostGate';
import { ui } from '../../../components/host/ui';
import { formatTime } from '../../../lib/format';
import type { HostEpisode } from '../../../lib/host';
import { colors, spacing, type } from '../../../theme';

// AI suggestions for one episode, from its transcript. Nothing reaches
// listeners until a host applies it here.
export default function AiAssist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useHost();
  const [episode, setEpisode] = useState<HostEpisode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.episode(id).then(setEpisode, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, id]);

  // Runs one action with a busy marker and error message, then marks it done.
  const run = async (key: string, action: () => Promise<HostEpisode | unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'chapters' in result) setEpisode(result as HostEpisode);
      setDone((d) => ({ ...d, [key]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!episode) {
    return error ? <Text style={[ui.error, { padding: spacing.xl }]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.text} />;
  }
  const ai = episode.ai;

  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Text style={type.title}>{episode.title}</Text>
      <Text style={ui.hint}>
        The AI reads the episode’s transcript and suggests a summary, chapters, tags, things mentioned, and moments for Shorts. Review each one;
        listeners only see what you apply.
      </Text>
      <Pressable
        style={[ui.button, { alignSelf: 'flex-start' }, busy === 'generate' && ui.buttonDisabled]}
        disabled={!!busy}
        onPress={() => run('generate', () => api.generateAi(episode.id).then((e) => (setDone({}), e)))}
      >
        <Text style={ui.buttonText}>{busy === 'generate' ? 'Reading the transcript…' : ai ? 'Generate again' : 'Generate suggestions'}</Text>
      </Pressable>
      {ai && (
        <Text style={ui.hint}>
          From {ai.model} · {new Date(ai.generatedAt).toLocaleString()}
        </Text>
      )}
      {error && <Text style={ui.error}>{error}</Text>}

      {ai && (
        <>
          <Section title="Summary">
            <Text style={type.body}>{ai.summary || 'No summary suggested.'}</Text>
            {!!ai.summary && (
              <Apply
                label={episode.summary === ai.summary ? 'Shown to listeners' : 'Show to listeners'}
                done={episode.summary === ai.summary}
                busy={busy === 'summary'}
                onPress={() => run('summary', () => api.updateEpisode(episode.id, { summary: ai.summary }))}
              />
            )}
          </Section>

          <Section title={`Chapters (${ai.chapters.length})`}>
            {ai.chapters.map((c) => (
              <Line key={c.startSec} time={c.startSec} text={c.title} />
            ))}
            {ai.chapters.length > 0 && (
              <Apply
                label="Use these chapters"
                hint={episode.chapters.length ? `Replaces the ${episode.chapters.length} current chapters.` : undefined}
                done={done.chapters}
                busy={busy === 'chapters'}
                onPress={() => run('chapters', () => api.updateEpisode(episode.id, { chapters: ai.chapters }))}
              />
            )}
          </Section>

          <Section title="Tags">
            <Text style={[type.body, { color: colors.highlight }]}>{ai.tags.map((t) => `#${t}`).join('  ') || 'No tags suggested.'}</Text>
            {ai.tags.length > 0 && (
              <Apply
                label="Add these tags"
                done={done.tags}
                busy={busy === 'tags'}
                onPress={() => run('tags', () => api.updateEpisode(episode.id, { tags: [...new Set([...episode.tags, ...ai.tags])] }))}
              />
            )}
          </Section>

          <Section title={`Mentioned (${ai.mentions.length})`}>
            {ai.mentions.map((m) => (
              <Line key={`${m.startSec}-${m.name}`} time={m.startSec} text={`${m.name} · ${m.kind}${m.url ? ` · ${m.url}` : ''}`} />
            ))}
            {ai.mentions.length > 0 && (
              <Apply
                label="Show to listeners"
                hint="Listed under “Mentioned in this episode” on the player, linked to the moment. Check the links first."
                done={done.mentions}
                busy={busy === 'mentions'}
                onPress={() => run('mentions', () => api.updateEpisode(episode.id, { mentions: ai.mentions }))}
              />
            )}
          </Section>

          <Section title={`Suggested Shorts (${ai.shorts.length})`}>
            {ai.shorts.map((s, i) => (
              <View key={`${s.startSec}-${i}`} style={styles.short}>
                <Text style={type.headline}>{s.title}</Text>
                <Text style={[type.footnote, { fontVariant: ['tabular-nums'] }]}>
                  {formatTime(s.startSec)}–{formatTime(s.endSec)} · {Math.round(s.endSec - s.startSec)} s
                </Text>
                {!!s.why && <Text style={type.footnote}>{s.why}</Text>}
                <Apply
                  label="Make this Short"
                  hint="Saved as a draft Short; publish it from Host mode once it’s processed."
                  done={done[`short-${i}`]}
                  busy={busy === `short-${i}`}
                  onPress={() =>
                    run(`short-${i}`, () =>
                      api.clipShort({ episodeId: episode.id, title: s.title, startSec: s.startSec, endSec: s.endSec, focusX: 0.5, tags: ai.tags })
                    )
                  }
                />
              </View>
            ))}
          </Section>
        </>
      )}
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

function Line({ time, text }: { time: number; text: string }) {
  return (
    <View style={styles.line}>
      <Text style={[type.footnote, styles.time]}>{formatTime(time)}</Text>
      <Text style={[type.body, { flex: 1 }]} selectable>
        {text}
      </Text>
    </View>
  );
}

function Apply({ label, hint, done, busy, onPress }: { label: string; hint?: string; done?: boolean; busy: boolean; onPress: () => void }) {
  return (
    <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
      <Pressable style={[ui.button, ui.secondary, { alignSelf: 'flex-start' }, (busy || done) && ui.buttonDisabled]} disabled={busy || done} onPress={onPress}>
        <Text style={ui.secondaryText}>{busy ? 'Working…' : done ? `✓ ${label.replace(/^Show to listeners$/, 'Shown to listeners')}` : label}</Text>
      </Pressable>
      {hint && <Text style={ui.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  line: { flexDirection: 'row', gap: spacing.md },
  time: { width: 48, fontVariant: ['tabular-nums'], paddingTop: 2 },
  short: { gap: spacing.xs, paddingVertical: spacing.sm },
});
