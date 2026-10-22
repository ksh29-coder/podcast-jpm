import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { ItemCard } from '../../components/host/cards';
import { matches, StatusFilter, type Filter } from '../../components/host/StatusFilter';
import { ui } from '../../components/host/ui';
import { useHostData } from '../../components/host/useHostData';
import { formatTime } from '../../lib/format';
import { isScheduled, videoLabel } from '../../lib/host';
import { colors } from '../../theme';

// Host Studio → Episodes: every episode, with publishing, editing, cutting
// Shorts (website) and AI help.
export default function StudioEpisodes() {
  const { episodes, error, busyId, setStatus } = useHostData();
  const [filter, setFilter] = useState<Filter>('all');
  if (!episodes) return error ? <Text style={[ui.error, { padding: 20 }]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
  return (
    <ScrollView contentContainerStyle={ui.page}>
      {error && <Text style={ui.error}>{error}</Text>}
      <StatusFilter value={filter} onChange={setFilter} statuses={episodes.map((e) => e.status)} />
      {episodes
        .filter((ep) => matches(filter, ep.status))
        .map((ep) => (
          <ItemCard
            key={ep.id}
            title={ep.title}
            imageUrl={ep.artworkUrl}
            meta={[ep.durationSec ? formatTime(ep.durationSec) : null, ep.author ? `by ${ep.author.name}` : null, ep.tags.map((t) => `#${t}`).join(' ') || null].filter(Boolean).join(' · ') || null}
            counts={ep}
            status={ep.status}
            scheduledFor={isScheduled(ep) ? ep.publishedAt : null}
            onEdit={() => router.push(ep.status === 'in_review' ? `/host/review/${ep.id}` : `/host/episode/${ep.id}`)}
            progress={videoLabel(ep.video, { needsAudio: true })}
            busy={busyId === ep.id}
            onStatus={(s) => setStatus('episode', ep.id, s)}
            extra={
              <>
                {Platform.OS === 'web' && !(ep.video && ep.video.status !== 'ready') && (
                  <Pressable style={[ui.button, ui.secondary]} onPress={() => router.push(`/host/clip/${ep.id}`)}>
                    <Text style={ui.secondaryText}>Make a Short</Text>
                  </Pressable>
                )}
                {ep.video?.status === 'ready' && (
                  <Pressable style={[ui.button, ui.secondary]} onPress={() => router.push(`/host/ai/${ep.id}`)}>
                    <Text style={ui.secondaryText}>{ep.ai ? 'AI suggestions' : 'AI assist'}</Text>
                  </Pressable>
                )}
              </>
            }
          />
        ))}
    </ScrollView>
  );
}
