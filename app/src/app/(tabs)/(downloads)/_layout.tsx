import { Stack } from 'expo-router';
import { stackHeader } from '../../../theme/navigation';

export default function DownloadsLayout() {
  return (
    <Stack screenOptions={stackHeader}>
      <Stack.Screen name="downloads" options={{ title: 'Downloads' }} />
    </Stack>
  );
}
