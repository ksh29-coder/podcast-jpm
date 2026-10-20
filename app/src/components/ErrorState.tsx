import { Pressable, StyleSheet, Text, View } from 'react-native';
import { API_URL } from '../lib/api';
import { colors } from '../theme';

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Can’t reach the podcast server</Text>
      <Text style={styles.detail}>{message}</Text>
      <Text style={styles.detail}>Server: {API_URL}</Text>
      <Pressable style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  detail: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  button: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.accent },
  buttonText: { color: colors.accentText, fontWeight: '700' },
});
