import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type Profile } from '../../lib/api';
import { getDisplayName, saveDisplayName } from '../../lib/device';
import { colors, radius, spacing, type } from '../../theme';
import { Icon } from '../Icon';

export const GUIDELINES = [
  'Share tips, demos and lessons about AI and software engineering.',
  'Nothing confidential: no client names or data, credentials, internal links or code that isn’t public.',
  'Be respectful. A host reviews every Short before anyone else sees it.',
];

// Before someone's first Short: the name shown on it, and the guidelines.
export function Welcome({ profile, onDone }: { profile: Profile; onDone: (p: Profile) => void }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(profile.name ?? '');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the name they comment with, if any.
  useEffect(() => {
    if (profile.name) return;
    getDisplayName().then((saved) => saved && setName((n) => n || saved));
  }, [profile.name]);

  const canContinue = !!name.trim() && agreed && !busy;
  const submit = async () => {
    if (!canContinue) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveMe(name.trim(), true);
      await saveDisplayName(name.trim());
      onDone(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
          <Icon name="close" size={22} />
        </Pressable>
        <Text style={type.display}>Share a Short</Text>
        <Text style={type.subhead}>Post a quick tip or demo for everyone. It goes live once a host has approved it.</Text>

        <Text style={[type.eyebrow, styles.section]}>Your name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={50}
          placeholder="Shown on your Shorts"
          placeholderTextColor={colors.textFaint}
          autoComplete="name"
          textContentType="name"
          accessibilityLabel="Your name"
        />

        <Text style={[type.eyebrow, styles.section]}>Guidelines</Text>
        <View style={styles.card}>
          {GUIDELINES.map((g) => (
            <View key={g} style={styles.rule}>
              <Text style={styles.bullet}>•</Text>
              <Text style={[type.body, { flex: 1 }]}>{g}</Text>
            </View>
          ))}
        </View>
        <Pressable
          style={styles.agree}
          onPress={() => setAgreed((a) => !a)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
        >
          <View style={[styles.box, agreed && styles.boxOn]}>{agreed && <Icon name="check" size={16} color={colors.accentText} />}</View>
          <Text style={[type.body, { flex: 1 }]}>I agree to these guidelines</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={[styles.button, !canContinue && { opacity: 0.4 }]} disabled={!canContinue} onPress={submit} accessibilityRole="button">
          <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Continue'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: spacing.xl, gap: spacing.md, width: '100%', maxWidth: 600, alignSelf: 'center' },
  close: { alignSelf: 'flex-end', padding: spacing.xs },
  section: { marginTop: spacing.lg },
  input: {
    color: colors.text,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 17,
  },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  rule: { flexDirection: 'row', gap: spacing.sm },
  bullet: { ...type.body, color: colors.highlight, fontWeight: '800' },
  agree: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  error: { color: colors.danger, fontSize: 14 },
  button: { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.md + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  buttonText: { color: colors.accentText, fontWeight: '700', fontSize: 17 },
});
