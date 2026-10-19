import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PlayerProvider } from '../lib/player';
import { colors } from '../theme';

// Dark navigation theme in our colors, so iOS 26's native tabs don't flash
// white between screens.
const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, primary: colors.text, border: colors.border },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={navTheme}>
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
            options={{
              title: '',
              headerBackTitle: 'Back',
              // The player draws its own artwork-tinted backdrop up to the top edge.
              headerTransparent: true,
              headerStyle: { backgroundColor: 'transparent' },
              // iOS 26 lets you swipe back from anywhere, which hijacks dragging the
              // progress bar. Keep swipe-back to the screen edge here.
              fullScreenGestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="comments/[type]/[id]"
            options={{
              title: 'Comments',
              presentation: 'formSheet',
              sheetAllowedDetents: [0.6, 1],
              sheetGrabberVisible: true,
              headerShown: false,
            }}
          />
          {/* Host mode has its own stack and headers (src/app/host/_layout.tsx). */}
          <Stack.Screen name="host" options={{ headerShown: false }} />
        </Stack>
      </PlayerProvider>
    </ThemeProvider>
  );
}
