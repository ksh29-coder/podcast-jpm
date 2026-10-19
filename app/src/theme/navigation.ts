import type { NativeStackNavigationOptions } from 'expo-router';
import { colors } from './index';

// Header for the tab stacks: large title that shrinks into a translucent bar
// as you scroll, over the dark page.
export const stackHeader: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerTransparent: process.env.EXPO_OS === 'ios',
  headerBlurEffect: 'systemChromeMaterialDark',
  headerLargeTitleShadowVisible: false,
  headerShadowVisible: false,
  headerTintColor: colors.text,
  headerLargeTitleStyle: { color: colors.text, fontWeight: '800' },
  headerTitleStyle: { color: colors.text },
  headerStyle: { backgroundColor: process.env.EXPO_OS === 'ios' ? 'transparent' : colors.bg },
  contentStyle: { backgroundColor: colors.bg },
};
