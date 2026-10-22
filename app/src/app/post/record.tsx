import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ShortRecorder } from '../../components/host/ShortRecorder';
import { usePost } from '../../components/post/PostContext';

// The website's recorder for anyone (camera, or screen with a camera bubble),
// from the New page. `?format=episode` records a landscape episode, which
// goes straight to its details; a Short is trimmed first, like a chosen file.
// (The phone records Shorts from the ＋ tab's camera instead.)
export default function PostRecord() {
  const { format } = useLocalSearchParams<{ format?: string }>();
  const episode = format === 'episode';
  const { setPicked, startUpload, reset } = usePost();
  return (
    <>
      <Stack.Screen options={{ title: episode ? 'Record an episode' : 'Record a Short' }} />
      <ShortRecorder
        format={episode ? 'episode' : 'short'}
        onRecorded={(r) => {
          reset();
          const picked = { uri: r.uri, durationSec: r.durationSec, kind: episode ? ('episode' as const) : ('short' as const), file: r.blob };
          setPicked(picked);
          if (episode) {
            startUpload(undefined, picked);
            router.replace('/post/details');
          } else {
            router.replace('/post/preview');
          }
        }}
      />
    </>
  );
}
