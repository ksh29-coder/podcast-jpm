import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { formatWhen, isScheduled, type Status } from '../../lib/host';
import { colors, spacing, type } from '../../theme';
import { ui } from './ui';

// Publish now, schedule a release, or take it down. Quick choices plus a
// typed date and time ("2026-10-24 09:00", in this device's time zone).
export function Schedule({
  item,
  busy,
  canPublish,
  onChange,
}: {
  item: { status: Status; publishedAt: string | null };
  busy: boolean;
  canPublish: boolean;
  onChange: (change: { status: Status; publishAt?: string }) => void;
}) {
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const live = item.status === 'published' && !isScheduled(item);

  const at = (d: Date) => onChange({ status: 'published', publishAt: d.toISOString() });
  const nextAt = (days: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const nextMonday = () => {
    const d = new Date();
    d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
    d.setHours(9, 0, 0, 0);
    return d;
  };

  const scheduleCustom = () => {
    const m = custom.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
    const d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    if (!d || Number.isNaN(d.getTime())) return setError('Use the format 2026-10-24 09:00');
    if (d.getTime() < Date.now()) return setError('That time has passed. Use “Publish now” instead.');
    setError(null);
    at(d);
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={type.body}>
        {live ? 'Published: listeners can see it.' : isScheduled(item) ? `Scheduled for ${formatWhen(item.publishedAt!)}.` : 'Not published.'}
      </Text>
      {!canPublish && <Text style={ui.hint}>The video is still processing; you can publish once it’s ready.</Text>}
      <View style={ui.row}>
        {!live && (
          <Pressable style={[ui.button, (busy || !canPublish) && ui.buttonDisabled]} disabled={busy || !canPublish} onPress={() => onChange({ status: 'published' })}>
            <Text style={ui.buttonText}>Publish now</Text>
          </Pressable>
        )}
        {item.status === 'published' && (
          <Pressable style={[ui.button, ui.secondary, busy && ui.buttonDisabled]} disabled={busy} onPress={() => onChange({ status: 'draft' })}>
            <Text style={ui.secondaryText}>{isScheduled(item) ? 'Cancel schedule' : 'Unpublish'}</Text>
          </Pressable>
        )}
      </View>
      {/* Scheduling a live item would hide it until then, so it's only offered before release. */}
      {canPublish && !live && (
        <>
          <Text style={ui.label}>{isScheduled(item) ? 'Or pick another time' : 'Or schedule it'}</Text>
          <View style={ui.row}>
            {/* Times are worked out when tapped, not when drawn. */}
            {(
              [
                ['In 1 hour', () => new Date(Date.now() + 3600_000)],
                ['Tomorrow 9:00', () => nextAt(1, 9)],
                ['Monday 9:00', nextMonday],
              ] as const
            ).map(([label, when]) => (
              <Pressable key={label} style={[ui.button, ui.secondary, busy && ui.buttonDisabled]} disabled={busy} onPress={() => at(when())}>
                <Text style={ui.secondaryText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={ui.row}>
            <TextInput
              style={[ui.input, { flexGrow: 1, minWidth: 180 }]}
              value={custom}
              onChangeText={setCustom}
              placeholder="2026-10-24 09:00"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Release date and time"
            />
            <Pressable style={[ui.button, ui.secondary, (busy || !custom.trim()) && ui.buttonDisabled]} disabled={busy || !custom.trim()} onPress={scheduleCustom}>
              <Text style={ui.secondaryText}>Schedule</Text>
            </Pressable>
          </View>
          {error && <Text style={ui.error}>{error}</Text>}
        </>
      )}
    </View>
  );
}
