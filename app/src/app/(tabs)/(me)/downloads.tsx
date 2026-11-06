import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { EpisodeRow } from '../../../components/EpisodeRow';
import { ErrorState } from '../../../components/ErrorState';
import { Icon } from '../../../components/Icon';
import { api, type Episode } from '../../../lib/api';
import { deleteDownload, downloadedSize, downloadEpisode, downloadsSupported } from '../../../lib/downloads';
import { usePlayer } from '../../../lib/player';
import { colors, spacing, type } from '../../../theme';
import { useFetch } from '../../../lib/useFetch';
import { openEpisode } from '../../../lib/openEpisode';

export default function DownloadsScreen() {
  const { data, error, reload } = useFetch(api.episodes);
  const { progress } = usePlayer();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Bumped after each change so sizes are re-read from disk.
  const [, setVersion] = useState(0);

  if (!downloadsSupported) {
    return (
      <View style={styles.empty}>
        <Icon name="phone" size={40} color={colors.textMuted} />
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
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: spacing.huge }}
      ListHeaderComponent={<Text style={styles.hint}>Downloaded episodes play without a connection.</Text>}
      renderItem={({ item }) => {
        const size = downloadedSize(item.id);
        return (
          <EpisodeRow
            episode={item}
            positionSec={progress[item.id]?.positionSec}
            onPress={() => openEpisode('downloads', `/episode/${item.id}`)}
            right={
              <Pressable
                onPress={() => toggle(item)}
                hitSlop={10}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={size !== null ? `Remove download of ${item.title}` : `Download ${item.title}`}
              >
                {busy[item.id] ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Icon name={size !== null ? 'checkCircle' : 'download'} size={28} color={size !== null ? colors.highlight : colors.text} />
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
  hint: { ...type.footnote, marginHorizontal: spacing.xl, marginBottom: spacing.sm },
  action: { alignItems: 'center', width: 56, gap: spacing.xxs },
  size: { ...type.caption, fontVariant: ['tabular-nums'] },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, gap: spacing.md, backgroundColor: colors.bg },
  emptyText: { ...type.subhead, textAlign: 'center' },
});
