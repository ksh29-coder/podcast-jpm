import { Share } from 'react-native';
import * as Linking from 'expo-linking';

// The phone's own share sheet. The link opens the app on that episode (or the
// episode a Short came from) when the app is installed.
export async function shareItem({ title, path }: { title: string; path: string }) {
  const url = Linking.createURL(path);
  try {
    await Share.share({ title, message: `${title} · AI Dev Podcast\n${url}`, url });
  } catch {
    // Dismissed or unavailable: nothing to do.
  }
}
