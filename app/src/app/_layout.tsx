import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PlayerProvider } from '../lib/player';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return (
    <PlayerProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="episode/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
      </Stack>
    </PlayerProvider>
  );
}
