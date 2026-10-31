import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTime } from '../../lib/format';
import { formatWhen, STATUS_LABEL, type HostComment, type Status } from '../../lib/host';
import { colors } from '../../theme';
import { AiCheckLine } from './AiCheckLine';
import { ui } from './ui';
import type { ReviewItem } from './useHostData';

// One episode or Short with its status and publish controls.
export function ItemCard({
  title,
  imageUrl,
  meta,
  counts,
  status,
  scheduledFor,
  onEdit,
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
  scheduledFor: string | null;
  onEdit?: () => void;
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
          <Text style={[styles.chip, status === 'published' && !scheduledFor && styles.chipLive]}>
            {scheduledFor ? `Scheduled · ${formatWhen(scheduledFor)}` : STATUS_LABEL[status]}
          </Text>
          {progress && <Text style={[ui.hint, failed && ui.error]}>{progress}</Text>}
        </View>
        <View style={[ui.row, { marginTop: 4 }]}>
          {status === 'published' ? (
            <Pressable style={[ui.button, ui.secondary, busy && ui.buttonDisabled]} disabled={busy} onPress={() => onStatus('draft')}>
              <Text style={ui.secondaryText}>{scheduledFor ? 'Cancel schedule' : 'Unpublish'}</Text>
            </Pressable>
          ) : (
            <Pressable style={[ui.button, (busy || !canPublish) && ui.buttonDisabled]} disabled={busy || !canPublish} onPress={() => onStatus('published')}>
              <Text style={ui.buttonText}>Publish</Text>
            </Pressable>
          )}
          {onEdit && (
            <Pressable style={[ui.button, ui.secondary]} onPress={onEdit}>
              <Text style={ui.secondaryText}>Edit</Text>
            </Pressable>
          )}
          {extra}
        </View>
      </View>
    </View>
  );
}

// Something posted from the app or website, waiting for review. Opens the
// review screen.
export function ReviewCard({ item, onOpen, progress }: { item: ReviewItem; onOpen: () => void; progress: string | null }) {
  const isEpisode = item.id.startsWith('ep_');
  return (
    <Pressable style={[ui.card, styles.card]} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Review ${item.title}`}>
      {item.artworkUrl && !progress ? <Image source={{ uri: item.artworkUrl }} style={styles.thumb} /> : <View style={styles.thumb} />}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={ui.hint}>
          {isEpisode ? 'Episode' : 'Short'} by {item.author?.name ?? 'a host'} · {formatWhen(item.createdAt)}
        </Text>
        <AiCheckLine check={item.aiCheck} />
        <ReportsLine reports={item.reports} />
        {progress && <Text style={ui.hint}>{progress}</Text>}
      </View>
    </Pressable>
  );
}

// What viewers said when they reported it, if anyone did.
export function ReportsLine({ reports }: { reports?: string[] }) {
  if (!reports?.length) return null;
  return (
    <Text style={[ui.hint, { color: colors.danger }]}>
      Reported {reports.length === 1 ? 'once' : `${reports.length} times`}
      {reports.some(Boolean) ? `: ${reports.filter(Boolean).join('; ')}` : ''}
    </Text>
  );
}

// A comment waiting for review (reported), with Approve and Reject.
export function CommentCard({ comment: c, busy, onReview }: { comment: HostComment; busy: boolean; onReview: (status: 'approved' | 'rejected') => void }) {
  return (
    <View style={ui.card}>
      <Text style={ui.hint}>
        {c.authorName} on “{c.itemTitle ?? c.itemId}”{c.atSec != null ? ` at ${formatTime(c.atSec)}` : ''}
      </Text>
      <Text style={styles.title}>{c.body}</Text>
      {c.reports.length > 0 && (
        <Text style={[ui.hint, { color: colors.danger }]}>
          Reported {c.reports.length === 1 ? 'once' : `${c.reports.length} times`}
          {c.reports.some(Boolean) ? `: ${c.reports.filter(Boolean).join('; ')}` : ''}. Hidden until you approve it again.
        </Text>
      )}
      <View style={ui.row}>
        <Pressable style={[ui.button, busy && ui.buttonDisabled]} disabled={busy} onPress={() => onReview('approved')}>
          <Text style={ui.buttonText}>Approve</Text>
        </Pressable>
        <Pressable style={[ui.button, ui.secondary, busy && ui.buttonDisabled]} disabled={busy} onPress={() => onReview('rejected')}>
          <Text style={ui.secondaryText}>Reject</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
