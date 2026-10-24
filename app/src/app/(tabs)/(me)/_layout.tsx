import { Stack } from 'expo-router';
import { stackHeader, tabRootOptions } from '../../../theme/navigation';

export default function MeLayout() {
  return (
    <Stack screenOptions={stackHeader}>
      <Stack.Screen name="me" options={{ title: 'Me', ...tabRootOptions }} />
      <Stack.Screen name="downloads" options={{ title: 'Downloads' }} />
      <Stack.Screen name="my-short/[id]" options={{ title: 'Edit Short', headerLargeTitle: false }} />    </Stack>
  );
}
