import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatTime } from '../../lib/format';
import { MAX_SHORT_SEC } from '../../lib/host';
import { colors } from '../../theme';
import { Icon, type IconName } from '../Icon';
import { setRecording, type Recording } from './recording';

type Phase = 'idle' | 'countdown' | 'recording' | 'paused' | 'saving';
const TIMERS = [0, 3, 10];
const SCROLL_SPEEDS = [20, 35, 55]; // teleprompter, pixels per second

// Full-screen camera for Shorts, like the YouTube Shorts / Reels camera:
// countdown timer, flip, flash, a scrolling script, and (iOS 18+ / Android)
// pausing between takes so one Short can be filmed in several bits.
//
// Used by Host mode as a screen of its own, and by the ＋ tab, which passes
// what to do with a recording and adds a button to choose a video instead.
export function ShortRecorder({ onRecorded, onPickFromLibrary }: { onRecorded?: (r: Recording) => void; onPickFromLibrary?: () => void } = {}) {
  const insets = useSafeAreaInsets();
  // Opened straight from Host mode (next=upload): continue to the details
  // screen afterwards. Opened from that screen: just go back to it.
  const { next } = useLocalSearchParams<{ next?: string }>();
  const camera = useRef<CameraView>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();

  const [facing, setFacing] = useState<CameraType>('front');
  const [torch, setTorch] = useState(false);
  const [timer, setTimer] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [countdown, setCountdown] = useState(0);
  const [canPause, setCanPause] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recorded time, not counting paused stretches.
  const [elapsed, setElapsed] = useState(0);
  const segmentStart = useRef(0);
  const before = useRef(0);
  // Where each pause happened, drawn as ticks on the progress bar.
  const [cuts, setCuts] = useState<number[]>([]);

  const [script, setScript] = useState('');
  const [editingScript, setEditingScript] = useState(false);
  const [speed, setSpeed] = useState(1);
  const prompter = useRef<ScrollView>(null);
  const prompterY = useRef(0);

  // Tick the clock while recording; stop at the limit.
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => {
      const now = before.current + (Date.now() - segmentStart.current) / 1000;
      setElapsed(now);
      if (now >= MAX_SHORT_SEC) {
        before.current = MAX_SHORT_SEC;
        setPhase('saving');
        camera.current?.stopRecording();
      }
    }, 100);
    return () => clearInterval(t);
  }, [phase]);

  // Scroll the script while recording, at the chosen speed.
  useEffect(() => {
    if (phase !== 'recording' || !script) return;
    const t = setInterval(() => {
      prompterY.current += SCROLL_SPEEDS[speed] / 20;
      prompter.current?.scrollTo({ y: prompterY.current, animated: false });
    }, 50);
    return () => clearInterval(t);
  }, [phase, script, speed]);

  // Countdown before the first take.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      startRecording();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // startRecording only reads refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  if (!camPerm || !micPerm) return <View style={styles.black} />;
  if (!camPerm.granted || !micPerm.granted) {
    return (
      <View style={[styles.black, styles.center, { padding: 24, gap: 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.permText}>Recording a Short needs the camera and microphone.</Text>
        <Pressable
          style={styles.permButton}
          onPress={async () => {
            if (!camPerm.granted) await requestCam();
            if (!micPerm.granted) await requestMic();
          }}
        >
          <Text style={styles.permButtonText}>Allow camera and microphone</Text>
        </Pressable>
        {(!camPerm.canAskAgain || !micPerm.canAskAgain) && (
          <Text style={styles.permHint}>If nothing happens, turn them on for AI Dev Wave in the Settings app.</Text>
        )}
        {onPickFromLibrary && (
          <Pressable style={[styles.permButton, { backgroundColor: 'rgba(255,255,255,0.18)' }]} onPress={onPickFromLibrary}>
            <Text style={[styles.permButtonText, { color: '#fff' }]}>Choose a video instead</Text>
          </Pressable>
        )}
        <Pressable onPress={() => router.back()}>
          <Text style={styles.permHint}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  function startRecording() {
    const cam = camera.current;
    if (!cam) return;
    setCanPause(!!cam.getSupportedFeatures?.().toggleRecordingAsyncAvailable);
    before.current = 0;
    segmentStart.current = Date.now();
    prompterY.current = 0;
    prompter.current?.scrollTo({ y: 0, animated: false });
    setElapsed(0);
    setCuts([]);
    setPhase('recording');
    // Resolves once recording stops (Done, the 90s limit, or leaving).
    cam
      .recordAsync({ maxDuration: MAX_SHORT_SEC })
      .then((result) => {
        if (result?.uri) {
          const rec = { uri: result.uri, durationSec: Math.min(MAX_SHORT_SEC, before.current) };
          if (onRecorded) {
            setPhase('idle');
            onRecorded(rec);
          } else {
            setRecording(rec);
            if (next === 'upload') router.replace('/host/upload-short');
            else router.back();
          }
        } else {
          setPhase('idle');
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('idle');
      });
  }

  const pressRecord = async () => {
    setError(null);
    if (phase === 'idle') {
      if (timer > 0) {
        setCountdown(timer);
        setPhase('countdown');
      } else {
        startRecording();
      }
    } else if (phase === 'countdown') {
      setPhase('idle');
    } else if (phase === 'recording') {
      if (canPause) {
        await camera.current?.toggleRecordingAsync();
        before.current += (Date.now() - segmentStart.current) / 1000;
        setElapsed(before.current);
        setCuts((c) => [...c, before.current]);
        setPhase('paused');
      } else {
        finish();
      }
    } else if (phase === 'paused') {
      await camera.current?.toggleRecordingAsync();
      segmentStart.current = Date.now();
      setPhase('recording');
    }
  };

  const finish = () => {
    // Lock in the recorded time; while paused it's already counted.
    if (phase === 'recording') before.current += (Date.now() - segmentStart.current) / 1000;
    setPhase('saving');
    camera.current?.stopRecording();
  };

  const recordingOrPaused = phase === 'recording' || phase === 'paused';

  return (
    <View style={styles.black}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={camera} style={StyleSheet.absoluteFill} mode="video" facing={facing} enableTorch={torch} />

      {/* Progress across the top, with a tick where each take ended. */}
      <View style={[styles.progressTrack, { top: insets.top + 8 }]}>
        <View style={[styles.progressFill, { width: `${(elapsed / MAX_SHORT_SEC) * 100}%` }]} />
        {cuts.map((c) => (
          <View key={c} style={[styles.cut, { left: `${(c / MAX_SHORT_SEC) * 100}%` }]} />
        ))}
      </View>

      <View style={[styles.topBar, { top: insets.top + 22 }]}>
        <RoundButton icon="close" label="Close" onPress={() => (recordingOrPaused ? finish() : router.back())} />
        <Text style={styles.clock}>
          {formatTime(elapsed)} / {formatTime(MAX_SHORT_SEC)}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Side tools, like the Shorts camera. Flipping mid-recording would stop it. */}
      <View style={[styles.tools, { top: insets.top + 84 }]}>
        <RoundButton icon="flip" label="Flip camera" disabled={recordingOrPaused} onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))} />
        <RoundButton icon={torch ? 'flashOn' : 'flash'} label={torch ? 'Light off' : 'Light on'} onPress={() => setTorch((t) => !t)} />
        <RoundButton
          icon="timer"
          label={`Timer ${timer ? `${timer} seconds` : 'off'}`}
          badge={timer ? `${timer}s` : undefined}
          disabled={phase !== 'idle'}
          onPress={() => setTimer((t) => TIMERS[(TIMERS.indexOf(t) + 1) % TIMERS.length])}
        />
        <RoundButton icon="script" label="Script" badge={script ? '✓' : undefined} disabled={phase !== 'idle'} onPress={() => setEditingScript(true)} />
        {!!script && (
          <RoundButton
            icon="speed"
            label={`Script speed ${speed + 1} of 3`}
            badge={`${speed + 1}`}
            onPress={() => setSpeed((s) => (s + 1) % SCROLL_SPEEDS.length)}
          />
        )}
      </View>

      {!!script && !editingScript && (
        <View style={[styles.prompter, { top: insets.top + 84 }]} pointerEvents="none">
          <ScrollView ref={prompter} scrollEnabled={false} showsVerticalScrollIndicator={false}>
            <Text style={styles.prompterText}>{script}</Text>
            <View style={{ height: 300 }} />
          </ScrollView>
        </View>
      )}

      {phase === 'countdown' && (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Text style={styles.countdown}>{countdown}</Text>
        </View>
      )}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
        {error && <Text style={styles.error}>{error}</Text>}
        {phase === 'paused' && <Text style={styles.hint}>Paused. Reframe, then tap to record the next bit.</Text>}
        {phase === 'recording' && !canPause && <Text style={styles.hint}>Tap to stop.</Text>}
        <View style={styles.controls}>
          {onPickFromLibrary && phase === 'idle' ? (
            <Pressable onPress={onPickFromLibrary} style={styles.gallery} accessibilityRole="button" accessibilityLabel="Choose a video from your library">
              <View style={styles.galleryIcon}>
                <Icon name="photos" size={24} color="#fff" />
              </View>
              <Text style={styles.galleryText}>Upload</Text>
            </Pressable>
          ) : (
            <View style={{ width: 64 }} />
          )}
          <Pressable
            onPress={pressRecord}
            disabled={phase === 'saving'}
            style={styles.recordOuter}
            accessibilityRole="button"
            accessibilityLabel={phase === 'recording' ? (canPause ? 'Pause recording' : 'Stop recording') : phase === 'paused' ? 'Resume recording' : 'Start recording'}
          >
            <View style={phase === 'recording' ? styles.recordStop : styles.recordDot} />
          </Pressable>
          {recordingOrPaused && elapsed > 1 ? (
            <Pressable onPress={finish} style={styles.done} accessibilityRole="button" accessibilityLabel="Done recording">
              <Icon name="check" size={28} color={colors.accentText} />
            </Pressable>
          ) : (
            <View style={{ width: 64 }} />
          )}
        </View>
      </View>

      {editingScript && (
        <View style={[StyleSheet.absoluteFill, styles.scriptPanel, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.scriptTitle}>Script</Text>
          <Text style={styles.hint}>It scrolls at the top of the screen while you record. Leave empty to turn it off.</Text>
          <TextInput
            style={styles.scriptInput}
            value={script}
            onChangeText={setScript}
            multiline
            autoFocus
            placeholder="What do you want to say?"
            placeholderTextColor={colors.textMuted}
          />
          <Pressable style={styles.permButton} onPress={() => setEditingScript(false)}>
            <Text style={styles.permButtonText}>Done</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  disabled,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.round, disabled && { opacity: 0.35 }]} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Icon name={icon} size={22} color="#fff" />
      {badge && <Text style={styles.badge}>{badge}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  permText: { color: '#fff', fontSize: 17, textAlign: 'center' },
  permHint: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  permButton: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 22, backgroundColor: colors.accent, alignSelf: 'center' },
  permButtonText: { color: colors.accentText, fontWeight: '700', fontSize: 15 },
  progressTrack: { position: 'absolute', left: 12, right: 12, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: '#ff3b5c' },
  cut: { position: 'absolute', top: 0, width: 2, height: 4, backgroundColor: '#fff' },
  topBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clock: { color: '#fff', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  tools: { position: 'absolute', right: 12, gap: 14 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', bottom: -4, right: -4, color: '#fff', fontSize: 10, fontWeight: '800', backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 4, overflow: 'hidden' },
  prompter: { position: 'absolute', left: 16, right: 72, height: 150, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)', padding: 12 },
  prompterText: { color: '#fff', fontSize: 22, lineHeight: 30, fontWeight: '600' },
  countdown: { color: '#fff', fontSize: 120, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 10 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 10 },
  hint: { color: 'rgba(255,255,255,0.85)', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 40 },
  recordOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recordDot: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#ff3b5c' },
  recordStop: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#ff3b5c' },
  gallery: { width: 64, alignItems: 'center', gap: 4 },
  galleryIcon: { width: 48, height: 48, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  galleryText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  done: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  scriptPanel: { backgroundColor: colors.bg, padding: 20, gap: 12 },
  scriptTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  scriptInput: { flex: 1, color: colors.text, backgroundColor: colors.card, borderRadius: 12, padding: 14, fontSize: 17, lineHeight: 24, textAlignVertical: 'top' },
});
