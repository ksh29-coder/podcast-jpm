import { useLocalSearchParams } from 'expo-router';
import { VideoEditor } from '../../../components/host/VideoEditor';

export default function EditVideo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <VideoEditor episodeId={id} />;
}
