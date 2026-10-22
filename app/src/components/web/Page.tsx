import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { colors, spacing, type } from '../../theme';

// A website page: a centred column up to `max` wide, with an optional title.
export function Page({ title, children, max = 1200, onRefresh, refreshing = false }: { title?: string; children: ReactNode; max?: number; onRefresh?: () => void; refreshing?: boolean }) {
  const narrow = useWindowDimensions().width < 700;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.page, { maxWidth: max }, narrow && styles.pageNarrow]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} /> : undefined}
    >
      {title && <Text style={styles.title}>{title}</Text>}
      {children}
    </ScrollView>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={type.title}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

// Lays children out in as many columns of at least `min` px as fit.
export function Grid<T>({ items, min, gap = spacing.xl, render }: { items: T[]; min: number; gap?: number; render: (item: T, width: number) => ReactNode }) {
  const [width, setWidth] = useState(0);
  const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
  const itemWidth = cols > 0 && width > 0 ? (width - gap * (cols - 1)) / cols : 0;
  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={[styles.grid, { gap }]}>
      {itemWidth > 0 && items.map((item) => render(item, itemWidth))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', alignSelf: 'center', paddingHorizontal: spacing.xxxl, paddingTop: spacing.xxxl, paddingBottom: spacing.huge * 2, gap: spacing.xxxl },
  pageNarrow: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.xxl },
  title: { ...type.display, fontSize: 34 },
  section: { gap: spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
