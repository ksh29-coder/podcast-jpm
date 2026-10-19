import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { formatTime } from '../lib/format';
import { MAX_RATE, MIN_RATE, usePlayer } from '../lib/player';
import { colors, radius, spacing, type } from '../theme';

const PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_MINUTES = [5, 15, 30, 45, 60];
const BACK = [10, 15, 30];
const FORWARD = [15, 30, 45, 60];

// Speed, sleep timer and skip lengths, as a sheet over the player.
export default function PlaybackSheet() {
  const player = usePlayer();
  const { prefs, sleep } = player;
  const rate = prefs.rate;
  const chapters = player.episode?.chapters ?? [];

  const sleepLabel = !sleep
    ? 'Off'
    : sleep.kind === 'time'
      ? `Pausing in ${formatTime(player.sleepLeftSec ?? 0)}`
      : `Pausing after “${sleep.title}”`;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <Text style={[type.headline, { textAlign: 'center' }]} accessibilityRole="header">
        Playback
      </Text>

      <View style={styles.section}>
        <Text style={type.eyebrow}>Speed</Text>
        <View style={styles.speedRow}>
          <Round label="Slower" icon="minus" disabled={rate <= MIN_RATE} onPress={() => player.setRate(rate - 0.05)} />
          <Text style={[type.display, styles.speed]} accessibilityLiveRegion="polite">
            {formatRate(rate)}×
          </Text>
          <Round label="Faster" icon="plus" disabled={rate >= MAX_RATE} onPress={() => player.setRate(rate + 0.05)} />
        </View>
        <View style={styles.chips}>
          {PRESETS.map((r) => (
            <Chip key={r} label={`${formatRate(r)}×`} on={Math.abs(rate - r) < 0.01} onPress={() => player.setRate(r)} />
          ))}
        </View>
        <Text style={[type.caption, { textAlign: 'center' }]}>Used for every episode on this device. Up to 2× on phones.</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.headRow}>
          <Text style={type.eyebrow}>Sleep timer</Text>
          <Text style={[type.footnote, sleep && { color: colors.highlight }]}>{sleepLabel}</Text>
        </View>
        <View style={styles.chips}>
          <Chip label="Off" on={!sleep} onPress={() => player.setSleep(null)} />
          {SLEEP_MINUTES.map((m) => (
            <Chip key={m} label={`${m} min`} on={false} onPress={() => player.setSleep(m)} />
          ))}
          {player.episode && (
            <Chip
              label={chapters.length ? 'End of chapter' : 'End of episode'}
              on={sleep?.kind === 'chapter'}
              onPress={() => player.setSleep('chapter')}
            />
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={type.eyebrow}>Skip back</Text>
        <View style={styles.chips}>
          {BACK.map((s) => (
            <Chip key={s} label={`${s} sec`} on={prefs.skipBack === s} onPress={() => player.setSkip(s, prefs.skipForward)} />
          ))}
        </View>
        <Text style={type.eyebrow}>Skip forward</Text>
        <View style={styles.chips}>
          {FORWARD.map((s) => (
            <Chip key={s} label={`${s} sec`} on={prefs.skipForward === s} onPress={() => player.setSkip(prefs.skipBack, s)} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

// 1 -> "1", 1.25 -> "1.25", 1.5 -> "1.5"
function formatRate(r: number) {
  return String(Math.round(r * 100) / 100);
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[type.subhead, { color: on ? colors.accentText : colors.text, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

function Round({ label, icon, disabled, onPress }: { label: string; icon: 'minus' | 'plus'; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.round, (disabled || pressed) && { opacity: disabled ? 0.3 : 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.xl, paddingTop: spacing.xxl, gap: spacing.xxl },
  section: { gap: spacing.md },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  speedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xxl },
  speed: { minWidth: 120, textAlign: 'center', fontVariant: ['tabular-nums'] },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardHigh, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.accent },
});
