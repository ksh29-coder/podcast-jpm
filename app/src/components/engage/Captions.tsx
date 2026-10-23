import { Pressable, StyleSheet, Text, View } from 'react-native';
import { captionAt, useCaptionsOn, useShortCaptions } from '../../lib/captions';

// What's being said, over a Short: a few words at a time in bold white on a
// dark box, just above its title, like YouTube Shorts' captions.
export function ShortCaptions({ id, position, enabled = true }: { id: string; position: number; enabled?: boolean }) {
  const [on] = useCaptionsOn();
  const chunks = useShortCaptions(id, enabled && on);
  const text = on ? captionAt(chunks, position) : null;
  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {text && (
        <Text style={styles.text} numberOfLines={2}>
          {text}
        </Text>
      )}
    </View>
  );
}

// Turns captions on or off for every Short (remembered on the device).
export function CcButton() {
  const [on, toggle] = useCaptionsOn();
  return (
    <Pressable
      onPress={toggle}
      hitSlop={10}
      style={[styles.cc, on && styles.ccOn]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel="Captions"
    >
      <Text style={[styles.ccText, on && styles.ccTextOn]}>CC</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Always takes its room, so the title doesn't jump as lines come and go.
  wrap: { minHeight: 58, alignItems: 'center', justifyContent: 'flex-end' },
  text: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  cc: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' },
  ccOn: { backgroundColor: '#fff', borderColor: '#fff' },
  ccText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  ccTextOn: { color: '#000' },
});
