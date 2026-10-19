import { Stack } from 'expo-router';
import { stackHeader } from '../../../theme/navigation';

export default function SearchLayout() {
  return <Stack screenOptions={stackHeader} />;
}
