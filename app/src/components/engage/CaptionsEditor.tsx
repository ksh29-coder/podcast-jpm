import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type CaptionHints, type Captions, type Cue } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { colors, radius, spacing, type } from '../../theme';
import { Icon } from '../Icon';

type Props = {
  load: () => Promise<Captions>;
  // Left out when they can't be changed (e.g. the Short is already live).
  save?: (cues: Cue[]) => Promise<Captions>;
  // The title and tags help the AI get names and terms right.
  hints: () => CaptionHints;
  // Not yet: the video is still being prepared.
  waiting?: boolean;
};

// A Short's captions on its edit screens: how many lines there are, and
// opened, every line to correct (the timing stays as generated). The AI can
// fix misheard words first; nothing is saved until Save.
export function CaptionsEditor({ load, save, hints, waiting = false }: Props) {
  const [data, setData] = useState<Captions | null>(null);
  const [draft, setDraft] = useState<Cue[] | null>(null);
  const [changedByAi, setChangedByAi] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'ai' | 'save' | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const refresh = useCallback(() => load().then(setData), [load]);

  // Captions take a minute or two after upload; check until they're there.
  useEffect(() => {
    if (waiting) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let status: Captions['status'] = 'none';
      try {
        const c = await load();
        if (stopped) return;
        setData(c);
        status = c.status;
      } catch (e) {
        if (!stopped) setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
        return;
      }
      if (!stopped && (status === 'none' || status === 'generating')) timer = setTimeout(tick, 5000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, waiting]);

  const editing = draft !== null;
  const run = async (kind: 'ai' | 'save', fn: () => Promise<void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const tidy = () =>
    run('ai', async () => {
      const lines = draft ?? data!.cues;
      const { cues } = await api.tidyCaptions(lines, hints());
      const changed = new Set(cues.flatMap((c, i) => (c.text !== lines[i].text ? [i] : [])));
      setDraft(cues);
      setChangedByAi(changed);
      setMessage({ text: changed.size ? `The AI fixed ${changed.size} line${changed.size === 1 ? '' : 's'} (marked). Check them, then save.` : 'The AI found nothing to fix.' });
    });

  const commit = () =>
    run('save', async () => {
      setData(await save!(draft!));
      setDraft(null);
      setChangedByAi(new Set());
      setMessage({ text: 'Captions saved.' });
    });

  let summary: string;
  if (waiting || !data || data.status === 'none' || data.status === 'generating') summary = 'Making captions from what’s said…';
  else if (data.status === 'unavailable' || !data.cues.length) summary = 'Nothing is said in this video, so it has no captions.';
  else summary = `${data.cues.length} line${data.cues.length === 1 ? '' : 's'}${data.source === 'edited' ? ', checked by a person' : ', made automatically'}. Shown over the video; viewers can turn them off.`;
  const ready = !!data && data.status === 'ready' && data.cues.length > 0;

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={type.eyebrow}>Captions</Text>
        {!ready && !waiting && data?.status !== 'unavailable' && <ActivityIndicator size="small" color={colors.textMuted} />}
      </View>
      <Text style={type.footnote}>{summary}</Text>

      {editing &&
        draft.map((c, i) => (
          <View key={i} style={styles.line}>
            <Text style={styles.time}>{formatTime(c.startSec)}</Text>
            <TextInput
              style={[styles.input, changedByAi.has(i) && styles.inputAi]}
              value={c.text}
              onChangeText={(text) => setDraft((d) => d!.map((x, j) => (j === i ? { ...x, text } : x)))}
              multiline
              maxLength={300}
              placeholder="(removed)"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel={`Caption at ${formatTime(c.startSec)}`}
            />
          </View>
        ))}

      {message && <Text style={message.error ? styles.error : type.footnote}>{message.text}</Text>}

      {ready && save && (
        <View style={styles.row}>
          {editing ? (
            <>
              <Button label={busy === 'save' ? 'Saving…' : 'Save captions'} primary disabled={!!busy} onPress={commit} />
              <Button label={busy === 'ai' ? 'Fixing…' : 'Fix with AI'} icon disabled={!!busy} onPress={tidy} />
              <Button
                label="Cancel"
                disabled={!!busy}
                onPress={() => {
                  setDraft(null);
                  setChangedByAi(new Set());
                  setMessage(null);
                  refresh().catch(() => {});
                }}
              />
            </>
          ) : (
            <>
              <Button label="Edit captions" onPress={() => setDraft(data.cues)} />
              <Button label={busy === 'ai' ? 'Fixing…' : 'Fix with AI'} icon disabled={!!busy} onPress={tidy} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

function Button({ label, onPress, primary, icon, disabled }: { label: string; onPress: () => void; primary?: boolean; icon?: boolean; disabled?: boolean }) {
  return (
    <Pressable style={[styles.button, primary && styles.primary, disabled && { opacity: 0.45 }]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      {icon && <Icon name="sparkles" size={14} color={colors.highlight} />}
      <Text style={[styles.buttonText, primary && { color: colors.accentText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.card },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  time: { ...type.caption, width: 40, paddingTop: spacing.sm + 2, fontVariant: ['tabular-nums'] },
  input: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 15,
  },
  inputAi: { borderColor: colors.highlight },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  button: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.cardHigh },
  primary: { backgroundColor: colors.accent },
  buttonText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
});
