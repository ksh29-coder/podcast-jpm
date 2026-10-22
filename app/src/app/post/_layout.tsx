import { Stack } from 'expo-router';
import { colors } from '../../theme';

// The posting screens, over everything: camera (phone), trim, then details.
// On the website, posting starts from the New page and comes here to trim
// and add the details.
export default function PostLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: '#000' } }} />
      <Stack.Screen name="preview" options={{ contentStyle: { backgroundColor: '#000' } }} />
      {/* Reached with replace, once the upload has started, so there's no going back to trim. */}
      <Stack.Screen name="details" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
