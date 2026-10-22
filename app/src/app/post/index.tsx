import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { router } from 'expo-router';
import { ErrorState } from '../../components/ErrorState';
import { ShortRecorder } from '../../components/host/ShortRecorder';
import { usePost } from '../../components/post/PostContext';
import { Welcome } from '../../components/post/Welcome';
import { api, type Profile } from '../../lib/api';
import { colors } from '../../theme';

// Longest video that can be chosen; a Short's length of it is kept.
const MAX_SOURCE_SEC = 600;

// ＋: the camera, with a button to choose a video instead. The first time,
// a name and the guidelines come first.
export default function PostCamera() {
  const { setPicked } = usePost();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.me().then(setProfile, (e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
  }, []);

  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setError(null);
          load();
        }}
      />
    );
  if (!profile) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.text} />;
  if (!profile.name || !profile.acceptedGuidelines) return <Welcome profile={profile} onDone={setProfile} />;

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // iOS shows its trimmer and keeps a long video to a Short's length,
      // on the phone, so only that part is uploaded.
      allowsEditing: true,
      videoMaxDuration: profile.maxShortSec,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const durationSec = asset.duration != null ? asset.duration / 1000 : null;
    if (durationSec != null && durationSec > MAX_SOURCE_SEC) {
      Alert.alert('That video is too long', 'Choose a video of up to 10 minutes, then pick the part to keep.');
      return;
    }
    setPicked({ uri: asset.uri, durationSec });
    router.push('/post/preview');
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <ShortRecorder
        onRecorded={(rec) => {
          setPicked(rec);
          router.push('/post/preview');
        }}
        onPickFromLibrary={pick}
      />
    </View>
  );
}
