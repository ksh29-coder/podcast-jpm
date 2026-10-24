import { Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { Icon } from '../../../components/Icon';
import { stackHeader, tabRootOptions } from '../../../theme/navigation';

export default function HomeLayout() {
  return (
    <Stack screenOptions={stackHeader}>
      <Stack.Screen
        name="index"
        options={{
          title: 'AI Wave',
          // Reviewing what people post, for hosts.
          headerRight: () => (
            <Pressable onPress={() => router.push('/host')} accessibilityRole="button" accessibilityLabel="Host mode" hitSlop={10}>
              <Icon name="shield" size={21} />
            </Pressable>
          ),
          ...tabRootOptions,
        }}
      />
    </Stack>
  );
}
