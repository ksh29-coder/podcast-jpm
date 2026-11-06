import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import type { EditPlan, EditText, EpisodeEdit, Pause, TextStyleName } from '../../lib/host';
import { clock, editedLength, findFillers, keptSegments, newId, playableFrom, shortenPauses, TEXT_STYLES, withItem, type Range } from '../../lib/edit';
import { colors } from '../../theme';
import { useHost } from './HostGate';
import { ui } from './ui';
import { Preview } from './editor/Preview.web';
import { Timeline } from './editor/Timeline.web';
import { Transcript } from './editor/Transcript.web';

// Web: edit an episode's video. Cuts (by time, by selecting words in the
// transcript, or found filler words and long pauses) and text on screen,
// previewed live over the original upload; saved as you go, and made into
// the episode's new video by the server when you're ready. The original is
// kept, so anything cut can be brought back later.
export function VideoEditor({ episodeId }: { episodeId: string }) {
  const { api } = useHost();
  const [data, setData] = useState<EpisodeEdit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.episodeEdit(episodeId).then(setData, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, episodeId]);

  if (error) return <Text style={[ui.error, { padding: 20 }]}>{error}</Text>;
  if (!data) return <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
  if (!data.videoUrl) return <Text style={[ui.hint, { padding: 20 }]}>The video is still processing. Come back in a few minutes.</Text>;
  return <Editor episodeId={episodeId} initial={data} />;
}

type Save = 'saved' | 'saving' | 'unsaved' | { error: string };
type Tab = 'cuts' | 'text' | 'find';

function Editor({ episodeId, initial }: { episodeId: string; initial: EpisodeEdit }) {
  const { api } = useHost();
  const videoRef = useRef<HTMLVideoElement>(null);
  const duration = initial.durationSec;
  const locked = initial.locked;

  // The plan, with undo and redo.
  const [history, setHistory] = useState<{ plan: EditPlan; past: EditPlan[]; future: EditPlan[] }>({ plan: initial.plan, past: [], future: [] });
  const plan = history.plan;
  const change = useCallback(
    (next: EditPlan | ((p: EditPlan) => EditPlan)) => {
      if (locked) return;
      setHistory((h) => ({ plan: typeof next === 'function' ? next(h.plan) : next, past: [...h.past.slice(-99), h.plan], future: [] }));
    },
    [locked]
  );
  const undo = useCallback(() => setHistory((h) => (h.past.length ? { plan: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [...h.future, h.plan] } : h)), []);
  const redo = useCallback(() => setHistory((h) => (h.future.length ? { plan: h.future[h.future.length - 1], past: [...h.past, h.plan], future: h.future.slice(0, -1) } : h)), []);

  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Play the edit (skipping cuts) or the original as uploaded.
  const [previewEdit, setPreviewEdit] = useState(true);
  const [selection, setSelection] = useState<Range | null>(null);
  const [tab, setTab] = useState<Tab>('cuts');
  const [edit, setEdit] = useState(initial.edit);
  const [save, setSave] = useState<Save>('saved');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [makeError, setMakeError] = useState<string | null>(null);

  const segments = useMemo(() => keptSegments(plan.cuts, duration), [plan.cuts, duration]);
  const length = editedLength(segments);

  const seek = useCallback((t: number) => {
    const el = videoRef.current;
    const at = Math.min(Math.max(t, 0), duration);
    if (el) el.currentTime = at;
    setNow(at);
  }, [duration]);
  const toggle = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  }, []);

  // While playing: jump over cut parts (in preview), and keep the time fresh.
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = (ts: number) => {
      const el = videoRef.current;
      if (el && !el.paused) {
        if (previewEdit) {
          const next = playableFrom(segments, el.currentTime);
          if (next === null) el.pause();
          else if (next - el.currentTime > 0.05) el.currentTime = next;
        }
        if (ts - last > 66) {
          setNow(el.currentTime);
          last = ts;
        }
      }
      setPlaying(!!el && !el.paused);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [segments, previewEdit]);

  // Saved shortly after each change.
  const first = useRef(true);
  const saving = useRef(0);
  const saveNow = useCallback(async (p: EditPlan) => {
    const n = ++saving.current;
    setSave('saving');
    try {
      const res = await api.saveEpisodeEdit(episodeId, p);
      if (n !== saving.current) return false;
      setWarnings(res.warnings);
      setSave('saved');
      // The episode's video doesn't have this saved change yet.
      setEdit((e) => ({ ...e, changed: true }));
      return true;
    } catch (e) {
      if (n === saving.current) setSave({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }, [api, episodeId]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave('unsaved');
    const timer = setTimeout(() => saveNow(plan), 800);
    return () => clearTimeout(timer);
  }, [plan, saveNow]);

  // While the edited video is being made, check on it.
  const making = edit.status === 'queued' || edit.status === 'rendering' || edit.processing;
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(() => {
      api.episodeEdit(episodeId).then((d) => setEdit(d.edit), () => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [making, api, episodeId]);

  const make = async () => {
    setMakeError(null);
    if (save !== 'saved' && !(await saveNow(plan))) return;
    try {
      await api.makeEpisodeEdit(episodeId);
      setEdit((e) => ({ ...e, status: 'queued', error: null }));
    } catch (e) {
      setMakeError(e instanceof Error ? e.message : String(e));
    }
  };

  const addCuts = useCallback(
    (ranges: (Range & { reason?: string })[]) =>
      change((p) => ({ ...p, cuts: [...p.cuts, ...ranges.map((r) => ({ id: newId('cut'), from: r.from, to: r.to, ...(r.reason && { reason: r.reason }) }))] })),
    [change]
  );
  const cutSelection = useCallback(() => {
    if (!selection || selection.to - selection.from < 0.05) return;
    addCuts([selection]);
    setSelection(null);
  }, [selection, addCuts]);

  // Keys: space plays, I and O mark the selection, X cuts it, arrows skip,
  // Ctrl/⌘+Z undoes (with Shift, redoes).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      const t = videoRef.current?.currentTime ?? now;
      if (e.key === ' ') toggle();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') (e.shiftKey ? redo : undo)();
      else if (e.key === 'i') setSelection((s) => ({ from: t, to: s && s.to > t ? s.to : Math.min(t + 5, duration) }));
      else if (e.key === 'o') setSelection((s) => ({ from: s && s.from < t ? s.from : Math.max(t - 5, 0), to: t }));
      else if (e.key === 'x' || e.key === 'Backspace' || e.key === 'Delete') cutSelection();
      else if (e.key === 'ArrowLeft') seek(t - 5);
      else if (e.key === 'ArrowRight') seek(t + 5);
      else if (e.key === 'Escape') setSelection(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [now, duration, toggle, undo, redo, cutSelection, seek]);

  const cutSec = duration - length;
  return (
    <ScrollView contentContainerStyle={[ui.page, { maxWidth: 1280 }]} keyboardShouldPersistTaps="handled">
      {locked && <Text style={[ui.card, ui.hint, { color: colors.highlight }]}>{locked}</Text>}

      <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
        <View style={{ flex: 3, minWidth: 420, gap: 10 }}>
          <Preview
            videoRef={videoRef}
            url={initial.videoUrl!}
            poster={initial.posterUrl}
            texts={plan.texts}
            now={now}
            onTime={setNow}
            onAspect={() => {}}
          />
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <View style={ui.row}>
              <Button label={playing ? 'Pause' : 'Play'} onPress={toggle} primary />
              <Text style={{ color: colors.text, fontVariant: ['tabular-nums'], fontSize: 15 }}>
                {clock(now)} <Text style={{ color: colors.textMuted }}>/ {clock(duration)}</Text>
              </Text>
            </View>
            <View style={ui.row}>
              <Toggle on={previewEdit} onPress={() => setPreviewEdit((v) => !v)} label="Skip cut parts" />
              <Button label="Undo" onPress={undo} disabled={!history.past.length} />
              <Button label="Redo" onPress={redo} disabled={!history.future.length} />
            </View>
          </View>
        </View>
        <View style={{ flex: 2, minWidth: 320, height: 420, backgroundColor: colors.card, borderRadius: 12, padding: 12 }}>
          <Text style={[ui.label, { marginTop: 0, marginBottom: 6 }]}>Transcript — click a word to jump, drag across words to select</Text>
          <Transcript transcript={initial.transcript} segments={segments} now={now} selection={selection} onSeek={seek} onSelect={setSelection} />
        </View>
      </View>

      <Timeline durationSec={duration} cuts={plan.cuts} texts={plan.texts} selection={selection} now={now} onSeek={seek} onSelect={setSelection} />

      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <View style={ui.row}>
          <Button label="Mark in (I)" onPress={() => setSelection((s) => ({ from: now, to: s && s.to > now ? s.to : Math.min(now + 5, duration) }))} />
          <Button label="Mark out (O)" onPress={() => setSelection((s) => ({ from: s && s.from < now ? s.from : Math.max(now - 5, 0), to: now }))} />
          <Button label={selection ? `Cut ${clock(selection.from)}–${clock(selection.to)} (X)` : 'Cut selection (X)'} onPress={cutSelection} disabled={!selection || !!locked} primary={!!selection} />
          {selection && <Button label="Clear" onPress={() => setSelection(null)} />}
        </View>
        <Text style={[ui.hint, { fontVariant: ['tabular-nums'] }]}>
          {clock(duration)} → <Text style={{ color: colors.text, fontWeight: '700' }}>{clock(length)}</Text>
          {cutSec > 0.05 ? ` (${clock(cutSec)} cut)` : ''}
        </Text>
      </View>

      <View style={[ui.card, { gap: 10 }]}>
        <View style={ui.row}>
          {(['cuts', 'text', 'find'] as Tab[]).map((t) => (
            <Toggle key={t} on={tab === t} onPress={() => setTab(t)} label={{ cuts: `Cuts (${plan.cuts.length})`, text: `Text on screen (${plan.texts.length})`, find: 'Find things to cut' }[t]} />
          ))}
        </View>
        {tab === 'cuts' && <CutsPanel plan={plan} change={change} seek={seek} locked={!!locked} />}
        {tab === 'text' && <TextPanel plan={plan} change={change} now={now} seek={seek} locked={!!locked} />}
        {tab === 'find' && <FindPanel episodeId={episodeId} words={initial.transcript.words} segments={segments} initialPauses={initial.pauses} addCuts={addCuts} seek={seek} locked={!!locked} />}
      </View>

      <View style={[ui.card, { gap: 8 }]}>
        <Text style={ui.section}>Make the edited video</Text>
        <Text style={ui.hint}>
          The episode’s video is made again from the original with your cuts and text. Its chapters, cover image and transcript move with your cuts. The original is
          kept, so you can bring cut parts back and make it again.
        </Text>
        {warnings.map((w) => (
          <Text key={w} style={[ui.hint, { color: colors.highlight }]}>{w}</Text>
        ))}
        <SaveLine save={save} />
        <EditLine edit={edit} />
        {makeError && <Text style={ui.error}>{makeError}</Text>}
        <View style={ui.row}>
          <Button
            label={making ? 'Making…' : 'Make edited video'}
            primary
            onPress={make}
            disabled={!!locked || making || (!edit.changed && save === 'saved') || typeof save === 'object'}
          />
          <Button label="Back to episode" onPress={() => router.push(`/host/episode/${episodeId}`)} />
        </View>
      </View>
    </ScrollView>
  );
}

function SaveLine({ save }: { save: Save }) {
  if (typeof save === 'object') return <Text style={ui.error}>Not saved: {save.error}</Text>;
  return <Text style={ui.hint}>{{ saved: 'All changes saved.', saving: 'Saving…', unsaved: 'Saving…' }[save]}</Text>;
}

function EditLine({ edit }: { edit: EpisodeEdit['edit'] }) {
  const text =
    edit.status === 'queued'
      ? 'Waiting to start making the video…'
      : edit.status === 'rendering'
        ? 'Making the video. A long episode can take a while; you can leave this page.'
        : edit.processing
          ? 'Made. The video service is processing it; the episode shows it in a few minutes.'
          : edit.status === 'failed'
            ? `Making the video failed: ${edit.error ?? 'unknown error'}`
            : edit.status === 'ready' && !edit.changed
              ? 'The episode’s video has all your saved changes.'
              : edit.changed
                ? 'You have changes the episode’s video doesn’t have yet.'
                : null;
  if (!text) return null;
  return <Text style={edit.status === 'failed' ? ui.error : ui.hint}>{text}</Text>;
}

// ---- Panels ----

function CutsPanel({ plan, change, seek, locked }: { plan: EditPlan; change: (f: (p: EditPlan) => EditPlan) => void; seek: (t: number) => void; locked: boolean }) {
  const cuts = [...plan.cuts].sort((a, b) => a.from - b.from);
  if (!cuts.length) {
    return <Text style={ui.hint}>No cuts yet. Select a stretch on the timeline or in the transcript (or press I and O while playing), then Cut. Or find filler words and long pauses.</Text>;
  }
  const remove = (ids: string[]) => change((p) => ({ ...p, cuts: p.cuts.filter((c) => !ids.includes(c.id)) }));
  const accept = (id: string) => change((p) => ({ ...p, cuts: p.cuts.map((c) => (c.id === id ? (({ state: _, ...rest }) => rest)(c) : c)) }));
  return (
    <View style={{ gap: 4 }}>
      {cuts.length > 1 && (
        <View style={ui.row}>
          <Button label="Remove all cuts" onPress={() => remove(cuts.map((c) => c.id))} disabled={locked} />
        </View>
      )}
      {cuts.map((c) => (
        <ItemRow key={c.id} suggested={c.state === 'suggested'}>
          <Text style={{ color: colors.text, fontVariant: ['tabular-nums'], minWidth: 210 }}>
            {clock(c.from)} – {clock(c.to)} <Text style={{ color: colors.textMuted }}>({(c.to - c.from).toFixed(1)}s)</Text>
          </Text>
          <Text style={[ui.hint, { flex: 1 }]} numberOfLines={1}>
            {c.reason ?? ''}
            {c.by ? ` · ${c.by}` : ''}
          </Text>
          <Button label="Play" onPress={() => seek(Math.max(0, c.from - 3))} />
          {c.state === 'suggested' && <Button label="Accept" onPress={() => accept(c.id)} disabled={locked} />}
          <Button label={c.state === 'suggested' ? 'Reject' : 'Remove'} onPress={() => remove([c.id])} disabled={locked} />
        </ItemRow>
      ))}
    </View>
  );
}

const EMPTY_TEXT = { style: 'lower-third' as TextStyleName, text: '', subtitle: '', seconds: '5' };

function TextPanel({ plan, change, now, seek, locked }: { plan: EditPlan; change: (f: (p: EditPlan) => EditPlan) => void; now: number; seek: (t: number) => void; locked: boolean }) {
  const [form, setForm] = useState(EMPTY_TEXT);
  const [editing, setEditing] = useState<EditText | null>(null);
  const seconds = Number(form.seconds);
  const valid = form.text.trim() && seconds > 0 && seconds <= 600;

  const submit = () => {
    if (!valid) return;
    const from = editing ? editing.from : Math.round(now * 10) / 10;
    const item: EditText = {
      ...(editing ?? {}),
      id: editing?.id ?? newId('text'),
      from,
      to: Math.round((from + seconds) * 10) / 10,
      style: form.style,
      text: form.text.trim(),
      ...(form.subtitle.trim() && TEXT_STYLES[form.style].subtitleSize ? { subtitle: form.subtitle.trim() } : { subtitle: undefined }),
    };
    change((p) => withItem(p, 'texts', item));
    setEditing(null);
    setForm(EMPTY_TEXT);
  };
  const texts = [...plan.texts].sort((a, b) => a.from - b.from);

  return (
    <View style={{ gap: 8 }}>
      <View style={ui.row}>
        {(Object.keys(TEXT_STYLES) as TextStyleName[]).map((s) => (
          <Toggle key={s} on={form.style === s} onPress={() => setForm({ ...form, style: s })} label={TEXT_STYLES[s].label} />
        ))}
      </View>
      <View style={ui.row}>
        <TextInput style={[ui.input, { flex: 2, minWidth: 200 }]} value={form.text} onChangeText={(text) => setForm({ ...form, text })} placeholder={form.style === 'lower-third' ? 'Name' : 'Text'} placeholderTextColor={colors.textFaint} maxLength={120} accessibilityLabel="Text" />
        {!!TEXT_STYLES[form.style].subtitleSize && (
          <TextInput style={[ui.input, { flex: 2, minWidth: 200 }]} value={form.subtitle} onChangeText={(subtitle) => setForm({ ...form, subtitle })} placeholder={form.style === 'lower-third' ? 'Role or team (optional)' : 'Second line (optional)'} placeholderTextColor={colors.textFaint} maxLength={120} accessibilityLabel="Second line" />
        )}
        <TextInput style={[ui.input, { width: 90 }]} value={form.seconds} onChangeText={(v) => setForm({ ...form, seconds: v })} inputMode="decimal" accessibilityLabel="Seconds on screen" />
        <Text style={ui.hint}>seconds</Text>
      </View>
      <View style={ui.row}>
        <Button label={editing ? 'Update text' : `Add at ${clock(now)}`} onPress={submit} disabled={!valid || locked} primary />
        {editing && <Button label="Cancel" onPress={() => { setEditing(null); setForm(EMPTY_TEXT); }} />}
      </View>
      {texts.map((t) => (
        <ItemRow key={t.id} suggested={t.state === 'suggested'}>
          <Text style={{ color: colors.text, fontVariant: ['tabular-nums'], minWidth: 150 }}>
            {clock(t.from)} – {clock(t.to)}
          </Text>
          <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
            {t.text}
            {t.subtitle ? <Text style={{ color: colors.textMuted }}> · {t.subtitle}</Text> : null}
            <Text style={{ color: colors.textFaint }}>  {TEXT_STYLES[t.style].label}</Text>
          </Text>
          <Button label="Play" onPress={() => seek(t.from)} />
          <Button
            label="Edit"
            onPress={() => {
              setEditing(t);
              setForm({ style: t.style, text: t.text, subtitle: t.subtitle ?? '', seconds: String(Math.round((t.to - t.from) * 10) / 10) });
              seek(t.from);
            }}
            disabled={locked}
          />
          <Button label="Remove" onPress={() => change((p) => ({ ...p, texts: p.texts.filter((x) => x.id !== t.id) }))} disabled={locked} />
        </ItemRow>
      ))}
    </View>
  );
}

function FindPanel({ episodeId, words, segments, initialPauses, addCuts, seek, locked }: {
  episodeId: string;
  words: EpisodeEdit['transcript']['words'];
  segments: Range[];
  initialPauses: Pause[] | null;
  addCuts: (ranges: (Range & { reason?: string })[]) => void;
  seek: (t: number) => void;
  locked: boolean;
}) {
  const { api } = useHost();
  const [pauses, setPauses] = useState(initialPauses);
  const [finding, setFinding] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [minPause, setMinPause] = useState(2);
  const fillers = useMemo(() => (words ? findFillers(words, segments) : []), [words, segments]);
  const shorten = useMemo(() => (pauses ? shortenPauses(pauses, segments, minPause) : []), [pauses, segments, minPause]);

  const findPauses = async () => {
    setFinding(true);
    setPauseError(null);
    try {
      setPauses(await api.episodePauses(episodeId));
    } catch (e) {
      setPauseError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinding(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 6 }}>
        <Text style={ui.label}>Filler words (um, uh, erm…)</Text>
        {!words ? (
          <Text style={ui.hint}>Needs a word-by-word transcript: transcribe the episode again from its page.</Text>
        ) : fillers.length === 0 ? (
          <Text style={ui.hint}>None left in the edit.</Text>
        ) : (
          <>
            <Text style={ui.hint}>
              {fillers.length} found, {fillers.reduce((s, f) => s + f.to - f.from, 0).toFixed(1)}s in all. Words like “like” and “you know” are left alone, as they’re often meant.
            </Text>
            <View style={ui.row}>
              <Button label={`Cut all ${fillers.length}`} primary onPress={() => addCuts(fillers.map((f) => ({ from: f.from, to: f.to, reason: `filler: “${f.said}”` })))} disabled={locked} />
            </View>
            <View style={[ui.row, { gap: 6 }]}>
              {fillers.slice(0, 40).map((f) => (
                <Pressable key={f.from} onPress={() => seek(Math.max(0, f.from - 2))} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.cardHigh }}>
                  <Text style={{ color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                    {f.said} {clock(f.from)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={ui.label}>Long pauses</Text>
        {!pauses ? (
          <View style={ui.row}>
            <Button label={finding ? 'Listening…' : 'Find long pauses'} onPress={findPauses} disabled={finding} />
            <Text style={ui.hint}>Listens to the whole episode once; a long one takes up to a minute.</Text>
          </View>
        ) : (
          <>
            <View style={ui.row}>
              <Text style={ui.hint}>Pauses of at least</Text>
              {[1.5, 2, 3, 5].map((s) => (
                <Toggle key={s} on={minPause === s} onPress={() => setMinPause(s)} label={`${s}s`} />
              ))}
            </View>
            {shorten.length === 0 ? (
              <Text style={ui.hint}>None that long left in the edit.</Text>
            ) : (
              <>
                <Text style={ui.hint}>
                  {shorten.length} found. Shortening each to half a second saves {shorten.reduce((s, p) => s + p.to - p.from, 0).toFixed(1)}s.
                </Text>
                <View style={ui.row}>
                  <Button label={`Shorten all ${shorten.length}`} primary onPress={() => addCuts(shorten.map((p) => ({ from: p.from, to: p.to, reason: `pause of ${p.durationSec.toFixed(1)}s` })))} disabled={locked} />
                </View>
                <View style={[ui.row, { gap: 6 }]}>
                  {shorten.slice(0, 40).map((p) => (
                    <Pressable key={p.from} onPress={() => seek(Math.max(0, p.from - 2))} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.cardHigh }}>
                      <Text style={{ color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                        {p.durationSec.toFixed(1)}s at {clock(p.from)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </>
        )}
        {pauseError && <Text style={ui.error}>{pauseError}</Text>}
      </View>
    </View>
  );
}

// ---- Small pieces ----

function Button({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable style={[ui.button, !primary && ui.secondary, { paddingVertical: 8, paddingHorizontal: 14 }, disabled && ui.buttonDisabled]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <Text style={[primary ? ui.buttonText : ui.secondaryText, { fontSize: 14 }]}>{label}</Text>
    </Pressable>
  );
}

function Toggle({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: on ? colors.text : colors.border, backgroundColor: on ? colors.cardHigh : 'transparent' }}
    >
      <Text style={{ color: on ? colors.text : colors.textMuted, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function ItemRow({ children, suggested }: { children: ReactNode; suggested?: boolean }) {
  return (
    <View style={[ui.row, { paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }, suggested && { borderLeftWidth: 2, borderLeftColor: colors.highlight, paddingLeft: 8 }]}>
      {suggested && <Text style={{ color: colors.highlight, fontSize: 11, fontWeight: '800' }}>SUGGESTED</Text>}
      {children}
    </View>
  );
}
