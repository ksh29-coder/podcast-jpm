import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useHost } from '../../components/host/HostGate';
import { Icon } from '../../components/Icon';
import { ui } from '../../components/host/ui';
import { formatTime } from '../../lib/format';
import { STATUS_LABEL, videoLabel, type HostComment, type HostEpisode, type HostShort, type Status } from '../../lib/host';
import { colors } from '../../theme';

const isWeb = Platform.OS === 'web';

// Everything hosts have made, drafts included, with publish controls.
export default function HostHome() {
  const { api, lock } = useHost();
  const [episodes, setEpisodes] = useState<HostEpisode[] | null>(null);
  const [shorts, setShorts] = useState<HostShort[] | null>(null);
  const [comments, setComments] = useState<HostComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [eps, shs, cms] = await Promise.all([api.episodes(), api.shorts(), api.comments()]);
      setEpisodes(eps);
      setShorts(shs);
      setComments(cms);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  // Reload whenever the screen comes back into view, e.g. after an upload.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Keep checking while anything is still uploading or processing.
  const stillWorking = (v: HostEpisode['video'], needsAudio: boolean) => !!v && v.status !== 'errored' && !!videoLabel(v, { needsAudio });
  const pending = !!episodes?.some((e) => stillWorking(e.video, true)) || !!shorts?.some((s) => stillWorking(s.video, false));
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [pending, load]);

  const setStatus = async (kind: 'episode' | 'short', id: string, status: Status) => {
    setBusyId(id);
    try {
      if (kind === 'episode') await api.updateEpisode(id, { status });
      else await api.updateShort(id, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const review = async (id: string, status: 'approved' | 'rejected') => {
    setBusyId(id);
    try {
      await api.setCommentStatus(id, status);
      setComments((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!episodes || !shorts) {
    return error ? <Text style={[ui.error, { padding: 20 }]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
  }

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
      <View style={ui.row}>
        {isWeb ? (
          <>
            <Pressable style={ui.button} onPress={() => router.push('/host/upload-episode')}>
              <Text style={ui.buttonText}>Upload episode</Text>
            </Pressable>
            <Pressable style={[ui.button, styles.record]} onPress={() => router.push('/host/record')}>
              <Icon name="video" size={18} color={colors.accentText} />
              <Text style={ui.buttonText}>Record a Short</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={[ui.button, styles.record]} onPress={() => router.push('/host/record?next=upload')}>
              <Icon name="video" size={18} color={colors.accentText} />
              <Text style={ui.buttonText}>Record a Short</Text>
            </Pressable>
            <Pressable style={[ui.button, ui.secondary]} onPress={() => router.push('/host/upload-short')}>
              <Text style={ui.secondaryText}>Upload from library</Text>
            </Pressable>
          </>
        )}
        <Pressable style={[ui.button, ui.secondary]} onPress={lock}>
          <Text style={ui.secondaryText}>Lock host mode</Text>
        </Pressable>
      </View>
      <Text style={ui.hint}>
        {isWeb
          ? 'Upload long episodes, cut Shorts from them, or record a Short with your camera or screen. Shorts filmed on a phone are uploaded from the phone app.'
          : 'Upload Shorts from your phone here. Long episodes are uploaded, and Shorts cut from them, on the host website.'}
      </Text>
      {error && <Text style={ui.error}>{error}</Text>}

      {comments.length > 0 && (
        <>
          <Text style={ui.section}>Comments to review ({comments.length})</Text>
          <Text style={ui.hint}>Viewers only see comments you approve.</Text>
          {comments.map((c) => (
            <View key={c.id} style={ui.card}>
              <Text style={ui.hint}>
                {c.authorName} on “{c.itemTitle ?? c.itemId}”
              </Text>
              <Text style={styles.title}>{c.body}</Text>
              <View style={ui.row}>
                <Pressable style={[ui.button, busyId === c.id && ui.buttonDisabled]} disabled={busyId === c.id} onPress={() => review(c.id, 'approved')}>
                  <Text style={ui.buttonText}>Approve</Text>
                </Pressable>
                <Pressable style={[ui.button, ui.secondary, busyId === c.id && ui.buttonDisabled]} disabled={busyId === c.id} onPress={() => review(c.id, 'rejected')}>
                  <Text style={ui.secondaryText}>Reject</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={ui.section}>Episodes</Text>
      {episodes.map((ep) => (
        <ItemCard
          key={ep.id}
          title={ep.title}
          imageUrl={ep.artworkUrl}
          meta={[ep.durationSec ? formatTime(ep.durationSec) : null, ep.tags.map((t) => `#${t}`).join(' ') || null].filter(Boolean).join(' · ') || null}
          counts={ep}
          status={ep.status}
          progress={videoLabel(ep.video, { needsAudio: true })}
          busy={busyId === ep.id}
          onStatus={(s) => setStatus('episode', ep.id, s)}
          extra={
            isWeb &&
            !(ep.video && ep.video.status !== 'ready') && (
              <Pressable style={[ui.button, ui.secondary]} onPress={() => router.push(`/host/clip/${ep.id}`)}>
                <Text style={ui.secondaryText}>Make a Short</Text>
              </Pressable>
            )
          }
        />
      ))}

      <Text style={ui.section}>Shorts</Text>
      {shorts.length === 0 && <Text style={ui.hint}>No Shorts yet.</Text>}
      {shorts.map((s) => (
        <ItemCard
          key={s.id}
          title={s.title}
          imageUrl={s.artworkUrl}
          meta={[
            s.episodeTitle ? `From “${s.episodeTitle}”` : 'Uploaded',
            s.startSec != null && s.endSec != null ? `${formatTime(s.startSec)}–${formatTime(s.endSec)}` : null,
            s.tags.map((t) => `#${t}`).join(' ') || null,
          ]
            .filter(Boolean)
            .join(' · ')}
          counts={s}
          status={s.status}
          progress={videoLabel(s.video)}
          busy={busyId === s.id}
          onStatus={(st) => setStatus('short', s.id, st)}
        />
      ))}
    </ScrollView>
  );
}

function ItemCard({
  title,
  imageUrl,
  meta,
  counts,
  status,
  progress,
  busy,
  onStatus,
  extra,
}: {
  title: string;
  imageUrl: string | null;
  meta: string | null;
  counts: { likes: number; views: number; comments: number };
  status: Status;
  progress: string | null;
  busy: boolean;
  onStatus: (s: Status) => void;
  extra?: React.ReactNode;
}) {
  const failed = progress?.startsWith('Failed');
  // Not ready to go live until the video (and an episode's audio) is ready.
  const canPublish = !progress;
  return (
    <View style={[ui.card, styles.card]}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.thumb} /> : <View style={styles.thumb} />}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {meta ? <Text style={ui.hint}>{meta}</Text> : null}
        <Text style={ui.hint}>
          {counts.views} views · {counts.likes} likes · {counts.comments} comments
        </Text>
        <View style={ui.row}>
          <Text style={[styles.chip, status === 'published' && styles.chipLive]}>{STATUS_LABEL[status]}</Text>
          {progress && <Text style={[ui.hint, failed && ui.error]}>{progress}</Text>}
        </View>
        <View style={[ui.row, { marginTop: 4 }]}>
          {status === 'published' ? (
            <Pressable style={[ui.button, ui.secondary, busy && ui.buttonDisabled]} disabled={busy} onPress={() => onStatus('draft')}>
              <Text style={ui.secondaryText}>Unpublish</Text>
            </Pressable>
          ) : (
            <Pressable style={[ui.button, (busy || !canPublish) && ui.buttonDisabled]} disabled={busy || !canPublish} onPress={() => onStatus('published')}>
              <Text style={ui.buttonText}>Publish</Text>
            </Pressable>
          )}
          {status === 'in_review' && (
            <Pressable style={[ui.button, ui.secondary, busy && ui.buttonDisabled]} disabled={busy} onPress={() => onStatus('rejected')}>
              <Text style={ui.secondaryText}>Reject</Text>
            </Pressable>
          )}
          {extra}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  record: { flexDirection: 'row', gap: 8 },
  card: { flexDirection: 'row', gap: 12 },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: colors.cardHigh },
  body: { flex: 1, gap: 4 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  chip: {
    color: colors.textMuted,
    backgroundColor: colors.cardHigh,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  chipLive: { color: colors.accentText, backgroundColor: colors.accent },
});
