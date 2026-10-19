import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatTime } from '../../lib/format';
import { MAX_SHORT_SEC, parseTags, type HostEpisode } from '../../lib/host';
import { colors } from '../../theme';
import { attachHls } from '../hls.web';
import { useHost } from './HostGate';
import { ui } from './ui';

// Web: play the episode, mark where the Short starts and ends, choose which
// part of the wide picture stays in view on a phone, and the server cuts it.
export function ClipEditor({ episodeId }: { episodeId: string }) {
  const { api } = useHost();
  const [episode, setEpisode] = useState<HostEpisode | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.episode(episodeId).then(setEpisode, (e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [api, episodeId]);

  if (loadError) return <Text style={[ui.error, { padding: 20 }]}>{loadError}</Text>;
  if (!episode) return <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
  return <Editor episode={episode} />;
}

function Editor({ episode }: { episode: HostEpisode }) {
  const { api } = useHost();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const [aspect, setAspect] = useState(16 / 9);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(30, episode.durationSec));
  const [title, setTitle] = useState('');
  const [tagsText, setTagsText] = useState(episode.tags.map((t) => `#${t}`).join(' '));
  const [focusX, setFocusX] = useState(0.5);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chrome and Firefox need hls.js for our .m3u8 streams (see hls.web.ts).
  useEffect(() => {
    const el = videoRef.current;
    return el ? attachHls(el, episode.videoUrl) : undefined;
  }, [episode.videoUrl]);

  const length = end - start;
  const rangeError =
    length <= 0 ? 'The end must be after the start.' : length > MAX_SHORT_SEC + 0.5 ? `A Short can be at most ${MAX_SHORT_SEC} seconds.` : null;

  const seek = (sec: number) => {
    if (videoRef.current) videoRef.current.currentTime = sec;
  };
  const clampTime = (sec: number) => Math.min(Math.max(0, Math.round(sec * 10) / 10), episode.durationSec);

  const preview = () => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = start;
    el.play();
    setPreviewing(true);
  };

  const save = async (publish: boolean) => {
    if (rangeError || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const short = await api.clipShort({ episodeId: episode.id, title: title.trim(), startSec: start, endSec: end, focusX, tags: parseTags(tagsText) });
      // The cut takes a minute to process; publishing waits for it on the server.
      if (publish) await waitAndPublish(short.id);
      router.replace('/host');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const waitAndPublish = async (shortId: string) => {
    for (let i = 0; i < 60; i++) {
      try {
        await api.updateShort(shortId, { status: 'published' });
        return;
      } catch (e) {
        if (!(e instanceof Error) || !/processing/.test(e.message)) throw e;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('Still processing. The Short is saved as a draft; publish it from Host mode in a minute.');
  };

  // Width of the 9:16 window over the wide picture, as a fraction of its width.
  const windowW = Math.min(1, 9 / 16 / aspect);

  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Text style={ui.hint}>From “{episode.title}”</Text>

      <div style={{ position: 'relative', width: '100%', background: '#000', borderRadius: 12, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          controls
          playsInline
          style={{ width: '100%', display: 'block', aspectRatio: String(aspect) }}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setNow(t);
            // During "Preview", stop at the end mark.
            if (previewing && t >= end) {
              e.currentTarget.pause();
              setPreviewing(false);
            }
          }}
          onLoadedMetadata={(e) => {
            const { videoWidth: w, videoHeight: h } = e.currentTarget;
            if (w && h) setAspect(w / h);
          }}
        />
        {/* What a phone will show: the rest is dimmed. */}
        {windowW < 1 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${(1 - windowW) * focusX * 100}%`,
              width: `${windowW * 100}%`,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              outline: `2px solid ${colors.accent}`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      <Text style={[ui.hint, { fontVariant: ['tabular-nums'] }]}>Playing at {formatTime(now)}</Text>

      <View style={ui.card}>
        <MarkRow label="Start" value={start} onSet={() => setStart(clampTime(now))} onNudge={(d) => setStart((s) => clampTime(s + d))} onJump={() => seek(start)} />
        <MarkRow label="End" value={end} onSet={() => setEnd(clampTime(now))} onNudge={(d) => setEnd((s) => clampTime(s + d))} onJump={() => seek(end)} />
        <Text style={[ui.hint, rangeError && ui.error]}>{rangeError || `Length ${formatTime(length)} (max ${MAX_SHORT_SEC}s)`}</Text>
        <Pressable style={[ui.button, ui.secondary, { alignSelf: 'flex-start' }, !!rangeError && ui.buttonDisabled]} disabled={!!rangeError} onPress={preview}>
          <Text style={ui.secondaryText}>Preview the Short</Text>
        </Pressable>
      </View>

      {windowW < 1 && (
        <View style={ui.card}>
          <Text style={ui.label}>Keep in view on phones</Text>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={focusX}
            onChange={(e) => setFocusX(Number(e.target.value))}
            aria-label="Horizontal position kept in view"
            style={{ width: '100%', accentColor: colors.accent }}
          />
          <Text style={ui.hint}>Shorts fill a vertical phone screen, so the sides of a wide video are cut off. Slide to keep the speaker inside the box.</Text>
        </View>
      )}

      <Text style={ui.label}>Title</Text>
      <TextInput style={ui.input} value={title} onChangeText={setTitle} maxLength={200} placeholder="What's this clip about?" placeholderTextColor={colors.textMuted} />

      <Text style={ui.label}>Tags</Text>
      <TextInput style={ui.input} value={tagsText} onChangeText={setTagsText} autoCapitalize="none" placeholder="#ai #testing" placeholderTextColor={colors.textMuted} />

      {error && <Text style={ui.error}>{error}</Text>}
      <View style={[ui.row, { marginTop: 8 }]}>
        <Pressable style={[ui.button, (!!rangeError || !title.trim() || saving) && ui.buttonDisabled]} disabled={!!rangeError || !title.trim() || saving} onPress={() => save(true)}>
          <Text style={ui.buttonText}>{saving ? 'Cutting…' : 'Publish'}</Text>
        </Pressable>
        <Pressable
          style={[ui.button, ui.secondary, (!!rangeError || !title.trim() || saving) && ui.buttonDisabled]}
          disabled={!!rangeError || !title.trim() || saving}
          onPress={() => save(false)}
        >
          <Text style={ui.secondaryText}>Save as draft</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function MarkRow({ label, value, onSet, onNudge, onJump }: { label: string; value: number; onSet: () => void; onNudge: (d: number) => void; onJump: () => void }) {
  return (
    <View style={[ui.row, { justifyContent: 'space-between' }]}>
      <Pressable onPress={onJump} accessibilityLabel={`Jump to ${label.toLowerCase()}`}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {label} {formatTime(value)}.{Math.round((value % 1) * 10)}
        </Text>
      </Pressable>
      <View style={ui.row}>
        <Pressable style={[ui.button, ui.secondary]} onPress={() => onNudge(-0.5)} accessibilityLabel={`${label} half a second earlier`}>
          <Text style={ui.secondaryText}>−½s</Text>
        </Pressable>
        <Pressable style={[ui.button, ui.secondary]} onPress={() => onNudge(0.5)} accessibilityLabel={`${label} half a second later`}>
          <Text style={ui.secondaryText}>+½s</Text>
        </Pressable>
        <Pressable style={ui.button} onPress={onSet}>
          <Text style={ui.buttonText}>Set to now</Text>
        </Pressable>
      </View>
    </View>
  );
}
