import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { formatTime } from '../lib/format';
import { colors } from '../theme';

type Props = {
  position: number;
  duration: number;
  onSeek: (sec: number) => void;
  // "overlay" is the thin bar laid over a full-screen Short: times only show
  // while dragging.
  variant?: 'default' | 'overlay';
};

// Tap or drag anywhere on the bar. While dragging, the bar and times follow
// your finger; the seek happens when you let go.
export function Scrubber({ position, duration, onSeek, variant = 'default' }: Props) {
  const [width, setWidth] = useState(0);
  const [dragSec, setDragSec] = useState<number | null>(null);
  // The player's position lags a seek slightly, so keep showing where you let
  // go until it catches up.
  const [seekingTo, setSeekingTo] = useState<number | null>(null);
  if (seekingTo !== null && Math.abs(position - seekingTo) < 2) setSeekingTo(null);

  // Give up waiting after a moment, e.g. if the seek was refused.
  useEffect(() => {
    if (seekingTo === null) return;
    const t = setTimeout(() => setSeekingTo(null), 2000);
    return () => clearTimeout(t);
  }, [seekingTo]);

  // The bar's children ignore touches, so locationX is always relative to the bar.
  const secAt = (e: GestureResponderEvent) =>
    width > 0 && duration > 0 ? Math.min(1, Math.max(0, e.nativeEvent.locationX / width)) * duration : 0;

  const seek = (sec: number) => {
    const clamped = Math.min(Math.max(0, sec), duration);
    setSeekingTo(clamped);
    onSeek(clamped);
  };

  const overlay = variant === 'overlay';
  // Screen-reader swipe step: Shorts are short, so smaller steps there.
  const step = overlay ? 5 : 15;
  const shown = dragSec ?? seekingTo ?? position;
  const fraction = duration > 0 ? Math.min(1, shown / duration) : 0;
  const times = (
    <View style={styles.times}>
      <Text style={[styles.time, overlay && styles.overlayTime]}>{formatTime(shown)}</Text>
      <Text style={[styles.time, overlay && styles.overlayTime]}>-{formatTime(duration - shown)}</Text>
    </View>
  );
  return (
    <View style={overlay ? styles.overlayWrap : styles.wrap}>
      {overlay && dragSec !== null && times}
      <View
        style={styles.hit}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // Keep the page (or the Shorts feed) from scrolling away mid-drag.
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => setDragSec(secAt(e))}
        onResponderMove={(e) => setDragSec(secAt(e))}
        onResponderRelease={(e) => {
          setDragSec(null);
          seek(secAt(e));
        }}
        onResponderTerminate={() => setDragSec(null)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{ text: `${formatTime(shown)} of ${formatTime(duration)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => seek(shown + (e.nativeEvent.actionName === 'increment' ? step : -step))}
      >
        <View style={[styles.track, overlay && styles.overlayTrack]} pointerEvents="none">
          <View style={[styles.fill, overlay && styles.overlayFill, { width: `${fraction * 100}%` }]} />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            overlay && dragSec === null && styles.overlayThumb,
            dragSec !== null && styles.thumbActive,
            { left: `${fraction * 100}%` },
          ]}
        />
      </View>
      {!overlay && times}
    </View>
  );
}

const styles = StyleSheet.create({
  // Small inset so 0:00 isn't right at the swipe-back edge.
  wrap: { marginHorizontal: 8 },
  overlayWrap: { paddingHorizontal: 16 },
  hit: { paddingVertical: 16, marginTop: 8, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  overlayTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  overlayFill: { height: 3, backgroundColor: '#fff' },
  thumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  // Small and white until touched, so it doesn't cover the Short.
  overlayThumb: { width: 10, height: 10, marginLeft: -5, borderRadius: 5, backgroundColor: '#fff' },
  thumbActive: { width: 24, height: 24, marginLeft: -12, borderRadius: 12 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  overlayTime: { color: '#fff', fontSize: 14, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
});
