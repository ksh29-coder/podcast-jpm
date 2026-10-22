import { useState } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import { formatTime } from '../../lib/format';
import { colors, radius, spacing, type } from '../../theme';

type Props = {
  durationSec: number;
  startSec: number;
  endSec: number;
  // Longest part that can be kept.
  maxSec: number;
  onChange: (startSec: number, endSec: number) => void;
  // When a drag ends, with the moment to show (the start, or the end when the end moved).
  onDone?: (showSec: number) => void;
};

type Part = 'start' | 'end' | 'middle';

const MIN_SEC = 1;
const HANDLE = 22;

// Pick the part of a video to keep: drag either end, or the middle to slide
// the whole range along (useful when only 90 seconds of a long video fit).
export function TrimBar({ durationSec, startSec, endSec, maxSec, onChange, onDone }: Props) {
  const [width, setWidth] = useState(0);
  // The drag in progress: which part, and where things were when it started.
  const [drag, setDrag] = useState<{ part: Part; x0: number; start: number; end: number } | null>(null);

  const handlers = (part: Part): ViewProps => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    // Keep the drag even if the finger wanders off the handle.
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e) => setDrag({ part, x0: e.nativeEvent.pageX, start: startSec, end: endSec }),
    onResponderMove: (e) => {
      if (!drag || !width) return;
      const delta = ((e.nativeEvent.pageX - drag.x0) / width) * durationSec;
      let { start, end } = drag;
      if (part === 'start') {
        start = clamp(start + delta, Math.max(0, end - maxSec), end - MIN_SEC);
      } else if (part === 'end') {
        end = clamp(end + delta, start + MIN_SEC, Math.min(durationSec, start + maxSec));
      } else {
        const len = end - start;
        start = clamp(start + delta, 0, durationSec - len);
        end = start + len;
      }
      onChange(round(start), round(end));
    },
    onResponderRelease: () => {
      setDrag(null);
      onDone?.(part === 'end' ? Math.max(startSec, endSec - 1) : startSec);
    },
  });

  const x = (sec: number) => (durationSec > 0 ? (sec / durationSec) * width : 0);
  const left = x(startSec);
  const right = x(endSec);

  return (
    <View style={styles.wrap}>
      <View style={styles.track} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={[styles.dim, { left: 0, width: left }]} />
        <View style={[styles.dim, { left: right, right: 0 }]} />
        <View {...handlers('middle')} style={[styles.window, { left, width: Math.max(0, right - left) }]} accessibilityLabel="Part to keep. Drag to move it." />
        <Handle at={left} handlers={handlers('start')} label="Start of the part to keep" />
        <Handle at={right} handlers={handlers('end')} label="End of the part to keep" />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{formatTime(startSec)}</Text>
        <Text style={[type.footnote, { color: colors.text, fontWeight: '700' }]}>Keeping {Math.round(endSec - startSec)}s</Text>
        <Text style={styles.time}>{formatTime(endSec)}</Text>
      </View>
    </View>
  );
}

function Handle({ at, handlers, label }: { at: number; handlers: ViewProps; label: string }) {
  return (
    <View {...handlers} style={[styles.handleHit, { left: at - HANDLE }]} accessibilityLabel={label} hitSlop={8}>
      <View style={styles.handle} />
    </View>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 10) / 10;

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  track: { height: 48, borderRadius: radius.sm, backgroundColor: colors.cardHigh, marginHorizontal: HANDLE / 2 },
  dim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  window: { position: 'absolute', top: 0, bottom: 0, borderTopWidth: 3, borderBottomWidth: 3, borderColor: colors.highlight },
  handleHit: { position: 'absolute', top: -6, bottom: -6, width: HANDLE * 2, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 12, height: '100%', borderRadius: 6, backgroundColor: colors.highlight },
  times: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { ...type.caption, fontVariant: ['tabular-nums'] },
});
