import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';
import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import { MiniPlayer } from '../../components/MiniPlayer';
import { colors } from '../../lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function icon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      // Now-playing bar sits just above the tabs on every tab.
      tabBar={(props) => (
        <>
          <MiniPlayer />
          <BottomTabBar {...props} />
        </>
      )}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Episodes', tabBarIcon: icon('albums') }} />
      <Tabs.Screen name="shorts" options={{ title: 'Shorts', headerShown: false, tabBarIcon: icon('play-circle') }} />
      <Tabs.Screen name="downloads" options={{ title: 'Downloads', tabBarIcon: icon('download') }} />
    </Tabs>
  );
}
