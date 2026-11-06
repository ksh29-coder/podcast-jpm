import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Chapter, Cue } from '../../../lib/api';
import { formatTime } from '../../../lib/format';
import { colors, spacing, type } from '../../../theme';
import { percent, saidAt } from './parts';

const SHORTS_COLOR = '#7AA7FF';

// The share of listeners who heard each point of the episode (100 points),
// what came through its Shorts in another color, and the chapters under it.
// Pointing at (or tapping) a point says when it is, which chapter, and what
// was being said.
export function RetentionChart({ durationSec, retention, fromShorts, chapters, cues }: {
  durationSec: number;
  retention: number[];
  fromShorts: number[] | null | undefined;
  chapters: Chapter[];
  cues: Cue[];
}) {
  const [at, setAt] = useState<number | null>(null);
  const timeOf = (i: number) => ((i + 0.5) / retention.length) * durationSec;
  const chapterAt = (t: number) => [...chapters].reverse().find((c) => c.startSec <= t)?.title ?? null;
  const t = at === null ? null : timeOf(at);
  const said = t === null ? null : saidAt(cues, t);

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={styles.chart} accessibilityLabel="Retention: the share of listeners still listening across the episode">
        {[100, 50].map((line) => (
          <View key={line} style={[styles.grid, { bottom: `${line}%` }]}>
            <Text style={styles.gridLabel}>{line}%</Text>
          </View>
        ))}
        {retention.map((share, i) => (
          <Pressable
            key={i}
            style={styles.column}
            onPress={() => setAt(i)}
            onHoverIn={() => setAt(i)}
            accessibilityLabel={`${formatTime(timeOf(i))}: ${percent(share)}`}
          >
            <View style={[styles.bar, { height: `${Math.min(1, share) * 100}%` }, at === i && { backgroundColor: colors.text }]} />
            {fromShorts && fromShorts[i] > 0 && <View style={[styles.shorts, { height: `${Math.min(1, fromShorts[i]) * 100}%` }]} />}
          </Pressable>
        ))}
      </View>
      <View style={styles.chapters}>
        {chapters.map((c) => (
          <View key={`${c.startSec}-${c.title}`} style={[styles.chapter, { left: `${(c.startSec / durationSec) * 100}%` }]}>
            <View style={styles.tick} />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={type.caption}>0:00</Text>
        <Text style={type.caption}>{formatTime(durationSec)}</Text>
      </View>
      <Text style={[type.footnote, { minHeight: 40 }]}>
        {t === null ? (
          'Point at the chart to see what was being said.'
        ) : (
          <>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {formatTime(t)} · {percent(retention[at!])} still listening
            </Text>
            {fromShorts && fromShorts[at!] > 0 ? ` · ${percent(fromShorts[at!])} through a Short` : ''}
            {chapterAt(t) ? ` · ${chapterAt(t)}` : ''}
            {said ? `\n“${said}”` : ''}
          </>
        )}
      </Text>
      {fromShorts && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: SHORTS_COLOR }} />
          <Text style={type.caption}>Heard through the episode’s Shorts</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height: 160, flexDirection: 'row', alignItems: 'flex-end', gap: 1, paddingLeft: 30 },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  gridLabel: { position: 'absolute', left: 0, top: -7, fontSize: 10, color: colors.textFaint },
  column: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.highlight, borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  shorts: { position: 'absolute', bottom: 0, left: '25%', right: '25%', backgroundColor: SHORTS_COLOR, opacity: 0.85 },
  chapters: { height: 8, marginLeft: 30, position: 'relative' },
  chapter: { position: 'absolute', top: 0 },
  tick: { width: 2, height: 8, backgroundColor: colors.textMuted },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: 30 },
});
