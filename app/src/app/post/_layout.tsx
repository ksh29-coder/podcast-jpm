import { Platform, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { PostProvider } from '../../components/post/PostContext';
import { colors, spacing, type } from '../../theme';

// The ＋ tab's screens, over everything: camera, trim, then details.
export default function PostLayout() {
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, backgroundColor: colors.bg }}>
        <Text style={[type.subhead, { textAlign: 'center' }]}>Post Shorts from the AI Dev Wave app on your phone.</Text>
      </View>
    );
  }
  return (
    <PostProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: '#000' } }} />
        <Stack.Screen name="preview" options={{ contentStyle: { backgroundColor: '#000' } }} />
        {/* Reached with replace, once the upload has started, so there's no going back to trim. */}
        <Stack.Screen name="details" options={{ gestureEnabled: false }} />
      </Stack>
    </PostProvider>
  );
}
