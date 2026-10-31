import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { CommentCard, ItemCard, ReviewCard } from '../../components/host/cards';
import { useHost } from '../../components/host/HostGate';
import { ui } from '../../components/host/ui';
import { useHostData } from '../../components/host/useHostData';
import { formatTime } from '../../lib/format';
import { isScheduled, videoLabel } from '../../lib/host';
import { colors } from '../../theme';

// Host mode on the phone: review what people post (approve or reject), and
// take things down. Uploading is the ＋ tab; editing and uploading episodes
// is the Host Studio on the website.
export default function HostHome() {
  const { lock } = useHost();
  const { episodes, shorts, comments, error, busyId, load, toReview, setStatus, reviewComment } = useHostData();
  const [refreshing, setRefreshing] = useState(false);

  if (!episodes || !shorts) {
    return error ? <Text style={[ui.error, { padding: 20 }]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
  }

  const live = [
    ...episodes.filter((e) => e.status === 'published').map((e) => ({ kind: 'episode' as const, item: e })),
    ...shorts.filter((s) => s.status === 'published').map((s) => ({ kind: 'short' as const, item: s })),
  ];
  const hidden = [
    ...episodes.filter((e) => e.status === 'draft' || e.status === 'rejected').map((e) => ({ kind: 'episode' as const, item: e })),
    ...shorts.filter((s) => s.status === 'draft' || s.status === 'rejected').map((s) => ({ kind: 'short' as const, item: s })),
  ];

  return (
    <ScrollView
      contentContainerStyle={ui.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {error && <Text style={ui.error}>{error}</Text>}

      <Text style={[ui.section, { marginTop: 0 }]}>To review{toReview.length ? ` (${toReview.length})` : ''}</Text>
      {toReview.length === 0 ? (
        <Text style={ui.hint}>Nothing waiting. New posts from the app and website show up here.</Text>
      ) : (
        toReview.map((item) => (
          <ReviewCard key={item.id} item={item} progress={videoLabel(item.video, { needsAudio: item.id.startsWith('ep_') })} onOpen={() => router.push(`/host/review/${item.id}`)} />
        ))
      )}

      {comments.length > 0 && (
        <>
          <Text style={ui.section}>Reported comments ({comments.length})</Text>
          {comments.map((c) => (
            <CommentCard key={c.id} comment={c} busy={busyId === c.id} onReview={(s) => reviewComment(c.id, s)} />
          ))}
        </>
      )}

      <Text style={ui.section}>Live</Text>
      <Text style={ui.hint}>Take something down with Unpublish; it stays in Host mode and can go live again.</Text>
      {live.map(({ kind, item }) => (
        <ItemCard
          key={item.id}
          title={item.title}
          imageUrl={item.artworkUrl}
          meta={[kind === 'episode' ? `Episode · ${formatTime(item.durationSec)}` : 'Short', item.author ? `by ${item.author.name}` : null].filter(Boolean).join(' · ')}
          counts={item}
          status={item.status}
          scheduledFor={isScheduled(item) ? item.publishedAt : null}
          progress={null}
          busy={busyId === item.id}
          onStatus={(s) => setStatus(kind, item.id, s)}
        />
      ))}

      {hidden.length > 0 && (
        <>
          <Text style={ui.section}>Not live</Text>
          {hidden.map(({ kind, item }) => (
            <ItemCard
              key={item.id}
              title={item.title}
              imageUrl={item.artworkUrl}
              meta={[kind === 'episode' ? 'Episode' : 'Short', item.author ? `by ${item.author.name}` : null].filter(Boolean).join(' · ')}
              counts={item}
              status={item.status}
              scheduledFor={null}
              progress={videoLabel(item.video, { needsAudio: kind === 'episode' })}
              busy={busyId === item.id}
              onStatus={(s) => setStatus(kind, item.id, s)}
            />
          ))}
        </>
      )}

      <Pressable style={[ui.button, ui.secondary, { alignSelf: 'flex-start', marginTop: 24 }]} onPress={lock}>
        <Text style={ui.secondaryText}>Lock host mode</Text>
      </Pressable>
    </ScrollView>
  );
}
