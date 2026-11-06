import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Cue } from '../../../lib/api';
import type { SplitRow } from '../../../lib/host';
import { colors, radius, spacing, type } from '../../../theme';

// Pieces of the hosts' listening stats: number tiles, bars for breakdowns,
// and words for figures. Figures based on fewer than 5 people come as null
// and read "Fewer than 5".

export const FEW = 'Fewer than 5';

export const percent = (share: number | null | undefined) => (share == null ? '–' : `${Math.round(share * 100)}%`);

// "12 h 30 min", "45 min", "40 s".
export function duration(sec: number | null | undefined) {
  if (sec == null) return '–';
  if (sec < 60) return `${Math.round(sec)} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

export const count = (n: number | null | undefined) => (n == null ? FEW : n.toLocaleString());

export const SOURCE_LABEL: Record<string, string> = {
  home: 'Home',
  search: 'Search',
  episode: 'Episode page',
  short: 'From a Short',
  notification: 'Notification',
  link: 'Shared link',
  continue: 'Carrying on',
  downloads: 'Downloads',
  assistant: 'Voice assistant',
  comments: 'Comments',
  other: 'Other',
};
export const PLATFORM_LABEL: Record<string, string> = { ios: 'iPhone', android: 'Android', web: 'Website', other: 'Other' };
export const MODE_LABEL: Record<string, string> = { audio: 'Listening', video: 'Watching', other: 'Other' };
export const AUDIENCE_LABEL: Record<string, string> = { new: 'First episode they played', returning: 'Had listened before' };

// What was being said at time t (the line then, or the next one).
export function saidAt(cues: Cue[], t: number) {
  const cue = cues.find((c) => t >= c.startSec && t < c.endSec) ?? cues.find((c) => c.startSec >= t);
  return cue?.text ?? null;
}

export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={type.caption}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {hint && <Text style={[type.caption, { color: colors.textFaint }]}>{hint}</Text>}
    </View>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <View style={styles.tiles}>{children}</View>;
}

// One bar per group, as a share of `total` listeners.
export function SplitBars({ title, rows, labels, total }: { title: string; rows: SplitRow[]; labels: Record<string, string>; total: number }) {
  return (
    <View style={{ gap: spacing.xs, flex: 1, minWidth: 300 }}>
      <Text style={type.footnote}>{title}</Text>
      {rows.length === 0 && <Text style={[type.caption, { color: colors.textFaint }]}>Each group is fewer than 5 people.</Text>}
      {rows.map((r) => (
        <View key={r.key} style={styles.barRow}>
          <Text style={[type.caption, styles.barLabel]} numberOfLines={1}>
            {labels[r.key] ?? r.key}
          </Text>
          <View style={styles.track}>{r.listeners != null && <View style={[styles.fill, { width: `${Math.max(2, (r.listeners / total) * 100)}%` }]} />}</View>
          <Text style={[type.caption, styles.barValue]} numberOfLines={1}>
            {r.listeners == null ? FEW : r.listeners}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function StatsSection({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.footnote, { color: colors.text, fontWeight: '700' }]}>{title}</Text>
      {hint && <Text style={type.caption}>{hint}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { minWidth: 140, flexGrow: 1, flexBasis: 140, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  value: { color: colors.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { width: 120 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.highlight },
  barValue: { width: 92, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
