import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useHost } from '../../components/host/HostGate';
import { ui } from '../../components/host/ui';
import { hovered } from '../../components/web/hover';
import { count, duration, FEW, percent, StatsSection, Tile, Tiles } from '../../components/host/stats/parts';
import type { ShowStats } from '../../lib/host';
import { colors, radius, spacing, type } from '../../theme';

// Host Studio → Stats: listening across the show (docs/listening-stats.md).
// Totals only: never who, and nothing based on fewer than 5 people.
export default function StudioStats() {
  const { api } = useHost();
  const [stats, setStats] = useState<ShowStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState<number | null>(null);

  useEffect(() => {
    api.stats().then(setStats, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api]);

  if (error) return <Text style={[ui.error, { padding: 20 }]}>{error}</Text>;
  if (!stats) return <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
  const d = stats.definitions;
  const most = Math.max(1, ...stats.weeks.map((w) => w.listeners ?? 0));
  const picked = week === null ? null : stats.weeks[week];
  const weekName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <ScrollView contentContainerStyle={[ui.page, { gap: spacing.xl }]}>
      {stats.totals ? (
        <Tiles>
          <Tile label="Listeners" value={count(stats.totals.listeners)} hint="Everyone who has played an episode, or heard one through its Shorts" />
          <Tile label="Plays" value={count(stats.totals.plays)} hint={`${d.PLAY_SEC}+ seconds heard`} />
          <Tile label="Time listened" value={duration(stats.totals.timeListenedSec)} hint="Episodes and Shorts" />
        </Tiles>
      ) : (
        <Text style={ui.hint}>Fewer than {d.MIN_PEOPLE} listeners so far. Stats show once {d.MIN_PEOPLE} people have listened, so nobody can be singled out.</Text>
      )}

      <StatsSection title="Listeners each week" hint="People who played an episode (or heard 30 seconds of one through its Shorts). Weeks with fewer than 5 are left out.">
        <View style={styles.weeks}>
          {stats.weeks.map((w, i) => (
            <Pressable key={w.week} style={styles.week} onPress={() => setWeek(i)} onHoverIn={() => setWeek(i)} accessibilityLabel={`Week of ${weekName(w.week)}: ${count(w.listeners)} listeners`}>
              <View style={[styles.weekBar, { height: `${((w.listeners ?? 0) / most) * 100}%` }, week === i && { backgroundColor: colors.text }]} />
            </Pressable>
          ))}
        </View>
        <View style={styles.weekAxis}>
          <Text style={type.caption}>{weekName(stats.weeks[0].week)}</Text>
          <Text style={type.caption}>{weekName(stats.weeks[stats.weeks.length - 1].week)}</Text>
        </View>
        <Text style={[type.footnote, { minHeight: 20 }]}>
          {picked
            ? picked.listeners == null
              ? `Week of ${weekName(picked.week)}: ${FEW.toLowerCase()} listeners`
              : `Week of ${weekName(picked.week)}: ${picked.listeners} listeners · ${picked.plays} plays · ${duration(picked.timeSec)} listened`
            : 'Point at a week for its numbers.'}
        </Text>
      </StatsSection>

      <StatsSection title="Episodes" hint="Tap one for its retention, where people stopped, and more.">
        <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ flex: 1, minWidth: 720 }}>
            <Row head cells={['Episode', 'Listeners', 'Engaged', 'Completed', 'Time listened', `First ${d.FIRST_DAYS} days`]} />
            {stats.episodes.map((e) => (
              <Pressable key={e.id} onPress={() => router.push(`/host/episode/${e.id}`)} style={(state) => [(hovered(state) || state.pressed) && { backgroundColor: colors.card }]}>
                <Row
                  cells={
                    e.all.enough
                      ? [e.title, count(e.all.listeners), count(e.all.engaged), percent(e.all.completionRate), duration(e.all.timeListenedSec), e.firstDays?.enough ? count(e.firstDays.listeners) : FEW]
                      : [e.title, FEW, '', '', '', '']
                  }
                />
              </Pressable>
            ))}
            {stats.episodes.length === 0 && <Text style={ui.hint}>No live episodes yet.</Text>}
          </View>
        </ScrollView>
      </StatsSection>

      <StatsSection title="Shorts" hint={`Swiped away: left within ${d.SWIPED_SEC} seconds. Watched can be over 100% when it loops.`}>
        <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ flex: 1, minWidth: 820 }}>
            <Row head cells={['Short', 'Views', 'Viewers', 'Swiped away', 'Watched', 'Loops', 'To the episode']} />
            {stats.shorts.map((s) => (
              <Row
                key={s.id}
                cells={
                  s.enough
                    ? [s.title, count(s.views), count(s.viewers), percent(s.swipedShare), percent(s.avgWatchedShare), count(s.loops), count(s.openedEpisode)]
                    : [s.title, FEW, '', '', '', '', '']
                }
              />
            ))}
            {stats.shorts.length === 0 && <Text style={ui.hint}>No live Shorts yet.</Text>}
          </View>
        </ScrollView>
      </StatsSection>

      <Text style={type.caption}>
        Updated {new Date(stats.refreshedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}; refreshed every {d.REFRESH_MIN} minutes. Totals only:
        never who, and nothing based on fewer than {d.MIN_PEOPLE} people.
      </Text>
    </ScrollView>
  );
}

function Row({ cells, head = false }: { cells: string[]; head?: boolean }) {
  return (
    <View style={[styles.row, head && styles.head]}>
      {cells.map((c, i) => (
        <Text key={i} style={[i === 0 ? styles.first : styles.cell, head ? type.caption : { color: colors.text, fontSize: 14 }]} numberOfLines={1}>
          {c}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  weeks: { height: 140, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  week: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  weekBar: { width: '100%', backgroundColor: colors.highlight, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, minHeight: 2 },
  weekAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  head: { borderBottomColor: colors.textFaint },
  first: { flex: 1, minWidth: 220 },
  cell: { width: 96, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
