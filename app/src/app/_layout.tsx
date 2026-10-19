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
        <Stack.Screen
          name="episode/[id]"
          // iOS 26 lets you swipe back from anywhere, which hijacks dragging the
          // progress bar. Keep swipe-back to the screen edge here.
          options={{ title: '', headerBackTitle: 'Back', fullScreenGestureEnabled: false }}
        />
      </Stack>
    </PlayerProvider>
  );
}
