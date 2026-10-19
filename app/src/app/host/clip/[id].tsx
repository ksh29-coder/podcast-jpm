import { useLocalSearchParams } from 'expo-router';
import { ClipEditor } from '../../../components/host/ClipEditor';

export default function ClipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClipEditor episodeId={id} />;
}
