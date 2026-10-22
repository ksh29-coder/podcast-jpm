import { router } from 'expo-router';
import { ShortRecorder } from '../../components/host/ShortRecorder';
import { usePost } from '../../components/post/PostContext';

// The website's recorder for anyone (camera, or screen with a camera bubble),
// from the New page. The recording continues like a chosen file: trim, then
// details. (The phone records from the ＋ tab's camera instead.)
export default function PostRecord() {
  const { setPicked, reset } = usePost();
  return (
    <ShortRecorder
      onRecorded={(r) => {
        reset();
        setPicked({ uri: r.uri, durationSec: r.durationSec, kind: 'short', file: r.blob });
        router.replace('/post/preview');
      }}
    />
  );
}
