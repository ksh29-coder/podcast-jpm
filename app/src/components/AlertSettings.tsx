import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { turnOn, useAlertsState } from '../lib/alerts';
import { api, type AlertSettings as Settings } from '../lib/api';
import { colors, radius, spacing, type } from '../theme';
import { Icon } from './Icon';

const KINDS: { key: keyof Settings; label: string }[] = [
  { key: 'replies', label: 'Replies to my comments' },
  { key: 'comments', label: 'Comments on my posts' },
  { key: 'reviews', label: 'When a host reviews my posts' },
  { key: 'episodes', label: 'New episodes' },
];

// Phone alerts in Me: turn them on, or choose which kinds come. Activity
// lists everything either way. Not on the website.
export function AlertSettings() {
  const [state, setState] = useAlertsState();
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    if (state === 'on') api.pushSettings().then(setSettings, () => {});
  }, [state]);

  if (!state) return null;

  if (state !== 'on') {
    return (
      <View style={[styles.card, styles.row]}>
        <Icon name="bell" size={22} />
        <View style={{ flex: 1 }}>
          <Text style={type.headline}>Phone alerts</Text>
          <Text style={type.footnote}>{state === 'off' ? 'Turned off in Settings.' : 'Replies, comments on your posts, reviews and new episodes.'}</Text>
        </View>
        <Pressable
          style={styles.button}
          onPress={() => (state === 'off' ? Linking.openSettings() : turnOn().then(setState))}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{state === 'off' ? 'Settings' : 'Turn on'}</Text>
        </Pressable>
      </View>
    );
  }

  const change = (key: keyof Settings, value: boolean) => {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, [key]: value });
    api.savePushSettings({ [key]: value }).then(setSettings, () => setSettings(before));
  };

  return (
    <View style={styles.card}>
      <View style={[styles.row, { paddingBottom: spacing.sm }]}>
        <Icon name="bell" size={22} />
        <Text style={[type.headline, { flex: 1 }]}>Phone alerts</Text>
      </View>
      {KINDS.map(({ key, label }) => (
        <View key={key} style={styles.option}>
          <Text style={[type.subhead, { flex: 1, color: colors.text }]}>{label}</Text>
          <Switch
            value={settings?.[key] ?? true}
            disabled={!settings}
            onValueChange={(v) => change(key, v)}
            trackColor={{ true: colors.accent }}
            accessibilityLabel={label}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  button: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.accent },
  buttonText: { color: colors.accentText, fontWeight: '700' },
});
