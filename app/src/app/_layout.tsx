import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PostProvider } from '../components/post/PostContext';
import { Shell } from '../components/web/Shell';
import { useAlerts } from '../lib/alerts';
import { PlayerProvider } from '../lib/player';
import { colors } from '../theme';

// Dark navigation theme in our colors, so iOS 26's native tabs don't flash
// white between screens.
const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, primary: colors.text, border: colors.border },
};

export default function RootLayout() {
  // Phone alerts: sign this phone up, and open what a tapped alert is about.
  useAlerts();
  return (
    <ThemeProvider value={navTheme}>
      <PlayerProvider>
        {/* Shared by the New page and the posting screens. */}
        <PostProvider>
          <StatusBar style="light" />
          {/* On the website: the sidebar and now-playing bar around every page. */}
          <Shell>
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
                  // The website's frame has its own Back button.
                  headerShown: process.env.EXPO_OS !== 'web',
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
              <Stack.Screen
                name="playback"
                options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, headerShown: false }}
              />
              <Stack.Screen
                name="transcript/[id]"
                options={{ presentation: 'formSheet', sheetAllowedDetents: [0.85, 1], sheetGrabberVisible: true, headerShown: false }}
              />
              {/* The ＋ tab: camera, trim and details, over everything. */}
              <Stack.Screen
                name="post"
                // A normal page on the website, where modals don't fit this flow.
                options={{ headerShown: false, presentation: process.env.EXPO_OS === 'web' ? 'card' : 'fullScreenModal', gestureEnabled: false }}
              />
              {/* Changing a Short's pictures while it's in review, from Me. */}
              <Stack.Screen
                name="pictures/[id]"
                options={{ headerShown: false, presentation: process.env.EXPO_OS === 'web' ? 'card' : 'fullScreenModal', gestureEnabled: false }}
              />
              <Stack.Screen name="privacy" options={{ title: 'Privacy', headerBackTitle: 'Back', headerShown: process.env.EXPO_OS !== 'web' }} />
              {/* The voice assistant, from the mic in Search. */}
              <Stack.Screen
                name="assistant"
                options={{ headerShown: false, presentation: process.env.EXPO_OS === 'web' ? 'card' : 'fullScreenModal', gestureEnabled: false }}
              />
              {/* Host mode has its own stack and headers (src/app/host/_layout.tsx). */}
              <Stack.Screen name="host" options={{ headerShown: false }} />
            </Stack>
          </Shell>
        </PostProvider>
      </PlayerProvider>
    </ThemeProvider>
  );
}
