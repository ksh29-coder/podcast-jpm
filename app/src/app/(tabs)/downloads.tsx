import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { EpisodeRow } from '../../components/EpisodeRow';
import { ErrorState } from '../../components/ErrorState';
import { api, type Episode } from '../../lib/api';
import { deleteDownload, downloadedSize, downloadEpisode, downloadsSupported } from '../../lib/downloads';
import { usePlayer } from '../../lib/player';
import { colors } from '../../lib/theme';
import { useFetch } from '../../lib/useFetch';

export default function DownloadsScreen() {
  const { data, error, reload } = useFetch(api.episodes);
  const { progress } = usePlayer();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Bumped after each change so sizes are re-read from disk.
  const [, setVersion] = useState(0);

  if (!downloadsSupported) {
    return (
      <View style={styles.empty}>
        <Ionicons name="phone-portrait-outline" size={40} color={colors.textMuted} />
        <Text style={styles.emptyText}>Downloads work in the iPhone and Android app, not in the web preview.</Text>
      </View>
    );
  }
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;

  const toggle = async (ep: Episode) => {
    if (downloadedSize(ep.id) !== null) {
      deleteDownload(ep.id);
      setVersion((v) => v + 1);
      return;
    }
    setBusy((b) => ({ ...b, [ep.id]: true }));
    try {
      await downloadEpisode(ep);
    } catch (e) {
      Alert.alert('Download failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => ({ ...b, [ep.id]: false }));
      setVersion((v) => v + 1);
    }
  };

  return (
    <FlatList
      // Downloads are audio; video-only episodes have none.
      data={data.filter((ep) => ep.audioUrl)}
      keyExtractor={(ep) => ep.id}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
      ListHeaderComponent={<Text style={styles.hint}>Downloaded episodes play without a connection.</Text>}
      renderItem={({ item }) => {
        const size = downloadedSize(item.id);
        return (
          <EpisodeRow
            episode={item}
            positionSec={progress[item.id]?.positionSec}
            onPress={() => router.push(`/episode/${item.id}`)}
            right={
              <Pressable onPress={() => toggle(item)} hitSlop={10} style={styles.action}>
                {busy[item.id] ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Ionicons
                    name={size !== null ? 'checkmark-circle' : 'arrow-down-circle-outline'}
                    size={30}
                    color={size !== null ? colors.accent : colors.text}
                  />
                )}
                {size !== null && <Text style={styles.size}>{(size / 1e6).toFixed(1)} MB</Text>}
              </Pressable>
            }
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textMuted, fontSize: 13, marginHorizontal: 16, marginBottom: 12 },
  action: { alignItems: 'center', width: 56 },
  size: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyText: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
});
