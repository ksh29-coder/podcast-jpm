import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Status } from '../../lib/host';
import { colors, radius, spacing } from '../../theme';

export type Filter = 'all' | 'live' | 'in_review' | 'not_live';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'in_review', label: 'In review' },
  { key: 'not_live', label: 'Not live' },
];

export const matches = (filter: Filter, status: Status) =>
  filter === 'all' || (filter === 'live' ? status === 'published' : filter === 'in_review' ? status === 'in_review' : status === 'draft' || status === 'rejected');

// All / Live / In review / Not live, with counts.
export function StatusFilter({ value, onChange, statuses }: { value: Filter; onChange: (f: Filter) => void; statuses: Status[] }) {
  return (
    <View style={styles.row}>
      {FILTERS.map((f) => {
        const on = f.key === value;
        const n = statuses.filter((s) => matches(f.key, s)).length;
        return (
          <Pressable key={f.key} onPress={() => onChange(f.key)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[styles.text, on && styles.textOn]}>
              {f.label} {n}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { color: colors.text, fontSize: 13, fontWeight: '700' },
  textOn: { color: colors.accentText },
});
