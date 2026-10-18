import { ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { EpisodeRow } from '../../components/EpisodeRow';
import { ErrorState } from '../../components/ErrorState';
import { api } from '../../lib/api';
import { usePlayer } from '../../lib/player';
import { colors } from '../../lib/theme';
import { useFetch } from '../../lib/useFetch';

export default function EpisodesScreen() {
  const { data, error, loading, reload } = useFetch(api.episodes);
  const { progress } = usePlayer();

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;

  return (
    <FlatList
      data={data}
      keyExtractor={(ep) => ep.id}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}
      renderItem={({ item }) => (
        <EpisodeRow
          episode={item}
          positionSec={progress[item.id]?.positionSec}
          onPress={() => router.push(`/episode/${item.id}`)}
        />
      )}
    />
  );
}
