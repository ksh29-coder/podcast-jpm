import { StyleSheet } from 'react-native';
import { colors } from '../../lib/theme';

// Shared styles for the host screens (forms, buttons, status chips).
export const ui = StyleSheet.create({
  page: { padding: 20, paddingBottom: 48, gap: 12, width: '100%', maxWidth: 820, alignSelf: 'center' },
  section: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 16 },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginTop: 4 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  input: {
    color: colors.text,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 22, backgroundColor: colors.accent },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: colors.accentText, fontWeight: '700', fontSize: 15 },
  secondary: { backgroundColor: colors.cardHigh },
  secondaryText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  error: { color: colors.danger, fontSize: 14 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, gap: 6 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: colors.accent },
});
