import type { PressableStateCallbackType } from 'react-native';

// Whether the mouse is over a Pressable (react-native-web adds `hovered` to
// the state it passes to `style`; React Native's types don't include it).
export const hovered = (state: PressableStateCallbackType) => !!(state as { hovered?: boolean }).hovered;
