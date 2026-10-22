import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { ItemCard } from '../../components/host/cards';
import { matches, StatusFilter, type Filter } from '../../components/host/StatusFilter';
import { ui } from '../../components/host/ui';
import { useHostData } from '../../components/host/useHostData';
import { formatTime } from '../../lib/format';
import { isScheduled, videoLabel } from '../../lib/host';
import { colors } from '../../theme';

// Host Studio → Shorts: every Short, cut from an episode or posted, with
// publishing and editing.
export default function StudioShorts() {
  const { shorts, error, busyId, setStatus } = useHostData();
  const [filter, setFilter] = useState<Filter>('all');
  if (!shorts) return error ? <Text style={[ui.error, { padding: 20 }]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
  return (
    <ScrollView contentContainerStyle={ui.page}>
      {error && <Text style={ui.error}>{error}</Text>}
      <StatusFilter value={filter} onChange={setFilter} statuses={shorts.map((s) => s.status)} />
      {shorts
        .filter((s) => matches(filter, s.status))
        .map((s) => (
          <ItemCard
            key={s.id}
            title={s.title}
            imageUrl={s.artworkUrl}
            meta={[
              s.author ? `by ${s.author.name}` : s.episodeTitle ? `From “${s.episodeTitle}”` : 'Uploaded',
              s.startSec != null && s.endSec != null ? `${formatTime(s.startSec)}–${formatTime(s.endSec)}` : null,
              s.tags.map((t) => `#${t}`).join(' ') || null,
            ]
              .filter(Boolean)
              .join(' · ')}
            counts={s}
            status={s.status}
            scheduledFor={isScheduled(s) ? s.publishedAt : null}
            onEdit={() => router.push(s.status === 'in_review' && s.author ? `/host/review/${s.id}` : `/host/short/${s.id}`)}
            progress={videoLabel(s.video)}
            busy={busyId === s.id}
            onStatus={(st) => setStatus('short', s.id, st)}
          />
        ))}
    </ScrollView>
  );
}
