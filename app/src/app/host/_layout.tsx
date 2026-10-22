import { Platform, Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { HostGate } from '../../components/host/HostGate';
import { Icon } from '../../components/Icon';
import { colors } from '../../theme';

// Leaves host mode for the listener app.
function exitHost() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function HostLayout() {
  return (
    <HostGate onCancel={exitHost}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Host mode',
            headerLeft: () => (
              <Pressable onPress={exitHost} accessibilityLabel="Leave host mode" hitSlop={10}>
                <Icon name="close" size={22} />
              </Pressable>
            ),
          }}
        />
        <Stack.Screen name="upload-episode" options={{ title: 'Upload episode' }} />
        <Stack.Screen name="upload-short" options={{ title: 'New Short' }} />
        {/* Phone: full-screen camera. Web: a normal page with a header. */}
        <Stack.Screen
          name="record"
          options={Platform.OS === 'web' ? { title: 'Record a Short' } : { headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }}
        />
        <Stack.Screen name="clip/[id]" options={{ title: 'Make a Short' }} />
        <Stack.Screen name="ai/[id]" options={{ title: 'AI assist' }} />
        <Stack.Screen name="episode/[id]" options={{ title: 'Edit episode' }} />
        <Stack.Screen name="short/[id]" options={{ title: 'Edit Short' }} />
        <Stack.Screen name="review/[id]" options={{ title: 'Review Short' }} />
      </Stack>
    </HostGate>
  );
}
