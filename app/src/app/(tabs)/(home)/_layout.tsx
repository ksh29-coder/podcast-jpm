import { Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { Icon } from '../../../components/Icon';
import { stackHeader } from '../../../theme/navigation';

export default function HomeLayout() {
  return (
    <Stack screenOptions={stackHeader}>
      <Stack.Screen
        name="index"
        options={{
          title: 'AI Dev Wave',
          headerRight: () => (
            <Pressable onPress={() => router.push('/host')} accessibilityRole="button" accessibilityLabel="Host mode" hitSlop={10}>
              <Icon name="upload" size={20} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
