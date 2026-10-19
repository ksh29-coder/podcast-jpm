import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ui } from './ui';

// For host screens that only make sense on the web or only on the phone.
export function NotOnThisPlatform({ message }: { message: string }) {
  return (
    <View style={[ui.page, { flex: 1, justifyContent: 'center' }]}>
      <Text style={[ui.hint, { fontSize: 16, textAlign: 'center' }]}>{message}</Text>
      <Pressable style={[ui.button, ui.secondary, { alignSelf: 'center' }]} onPress={() => router.back()}>
        <Text style={ui.secondaryText}>Back</Text>
      </Pressable>
    </View>
  );
}
