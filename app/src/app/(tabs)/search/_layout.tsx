import { Stack } from 'expo-router';
import { colors } from '../../../theme';

// A plain header (no large title, not see-through): with it, iOS 26 moves the
// search field down into the tab bar, like Apple's own apps. The see-through
// large-title header the other tabs use keeps it at the top instead, where it
// sits under the title bar.
export default function SearchLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
