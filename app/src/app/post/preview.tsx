import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoVideo, usePost } from '../../components/post/PostContext';
import { TrimBar } from '../../components/post/TrimBar';
import { MAX_SHORT_SEC } from '../../lib/host';
import { colors, radius, spacing, type } from '../../theme';

// Play back what was recorded or chosen and pick the part to keep. Next
// starts the upload and moves on to the details.
export default function PostPreview() {
  const insets = useSafeAreaInsets();
  const { picked, startUpload, setKept } = usePost();
  // A wide window (the website): the video centred above the controls,
  // instead of filling the screen behind them.
  const { width, height } = useWindowDimensions();
  const wide = width >= 700;
  const videoHeight = height - 230;
  const [duration, setDuration] = useState(picked?.durationSec ?? 0);
  const [range, setRange] = useState({ start: 0, end: Math.min(picked?.durationSec ?? MAX_SHORT_SEC, MAX_SHORT_SEC) });

  const player = useVideoPlayer(picked?.uri ?? null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.2;
    p.play();
  });
  // The real length, once the file is open (the picker doesn't always say).
  useEventListener(player, 'sourceLoad', ({ duration: d }) => {
    // Browser recordings (WebM) often don't know their length; keep the recorder's.
    if (!Number.isFinite(d) || d <= 0) return;
    setDuration(d);
    setRange((r) => ({ start: Math.min(r.start, Math.max(0, d - 1)), end: Math.min(d, picked?.durationSec ? r.end : MAX_SHORT_SEC) }));
  });
  // Loop within the part being kept.
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (currentTime >= range.end || currentTime < range.start - 0.5) player.seekBy(range.start - currentTime);
  });

  if (!picked) return <NoVideo />;

  const whole = range.start <= 0.2 && range.end >= duration - 0.2;
  const next = () => {
    player.pause();
    startUpload(whole ? undefined : { startSec: range.start, endSec: range.end });
    setKept({ startSec: whole ? 0 : range.start, durationSec: whole ? duration : range.end - range.start });
    // Shorts can have pictures added next; episodes go straight to the details.
    router.replace(picked.kind === 'episode' ? '/post/details' : '/post/edit');
  };

  return (
    <View style={[styles.screen, wide && styles.screenWide]}>
      <VideoView
        player={player}
        style={wide ? { width: (videoHeight * 9) / 16, height: videoHeight, borderRadius: radius.lg } : StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />
      <View style={[styles.bottom, wide && styles.bottomWide, { paddingBottom: insets.bottom + spacing.lg }]}>
        {duration > 0 && (
          <TrimBar
            durationSec={duration}
            startSec={range.start}
            endSec={range.end}
            maxSec={MAX_SHORT_SEC}
            onChange={(start, end) => setRange({ start, end })}
            onDone={(sec) => {
              player.seekBy(sec - player.currentTime);
              player.play();
            }}
          />
        )}
        {duration > MAX_SHORT_SEC && <Text style={styles.hint}>Shorts can be up to {MAX_SHORT_SEC} seconds. Drag to choose which part to keep.</Text>}
        <View style={styles.row}>
          <Pressable style={[styles.button, styles.secondary]} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.secondaryText}>Retake</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={next} accessibilityRole="button">
            <Text style={styles.buttonText}>Next</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  screenWide: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.lg, backgroundColor: colors.bg },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.md, backgroundColor: 'rgba(0,0,0,0.6)' },
  bottomWide: { position: 'relative', width: '100%', maxWidth: 720, backgroundColor: 'transparent' },
  hint: { ...type.footnote, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  row: { flexDirection: 'row', gap: spacing.md },
  button: { flex: 1, alignItems: 'center', paddingVertical: spacing.md + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  buttonText: { color: colors.accentText, fontWeight: '700', fontSize: 17 },
  secondary: { backgroundColor: 'rgba(255,255,255,0.18)' },
  secondaryText: { color: '#fff', fontWeight: '700', fontSize: 17 },
});
