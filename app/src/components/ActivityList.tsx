import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { activityText, lastSeenAt, markActivitySeen, refreshActivity, useActivity, type ActivityEntry } from '../lib/activity';
import { formatAgo } from '../lib/format';
import { colors, radius, spacing, type } from '../theme';
import { Icon, type IconName } from './Icon';

const SHOWN = 5;

const ICON: Record<ActivityEntry['kind'], IconName> = {
  reply: 'reply',
  comment: 'comment',
  like: 'heartFill',
  live: 'checkCircle',
  rejected: 'warning',
  episode: 'headphones',
};

// Activity at the top of Me: replies, comments and likes on what you posted,
// hosts' reviews, and new episodes. Opening Me marks it read; what was new
// keeps its dot until you come back.
export function ActivityList() {
  const { entries } = useActivity();
  const [since, setSince] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useFocusEffect(
    useCallback(() => {
      let here = true;
      refreshActivity().then(() => {
        if (!here) return;
        // What was unread as Me opened, before it's marked read.
        setSince(lastSeenAt());
        timer.current = setTimeout(markActivitySeen, 1500);
      });
      return () => {
        here = false;
        clearTimeout(timer.current);
      };
    }, [])
  );

  if (!entries) return null;
  const shown = all ? entries : entries.slice(0, SHOWN);
  return (
    <View style={styles.card}>
      <Text style={[type.eyebrow, styles.title]}>Activity</Text>
      {!entries.length && <Text style={[type.footnote, styles.empty]}>Replies to your comments, comments on your posts and new episodes show up here.</Text>}
      {shown.map((e) => {
        const unread = !!since && e.at > since;
        const detail = e.kind === 'rejected' ? e.note : e.kind === 'reply' || e.kind === 'comment' ? e.body : null;
        return (
          <Pressable key={e.key} onPress={() => open(e)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <View style={[styles.icon, e.kind === 'like' && { backgroundColor: 'rgba(255,59,48,0.18)' }]}>
              <Icon name={ICON[e.kind]} size={16} color={e.kind === 'like' ? '#FF3B30' : e.kind === 'rejected' ? colors.danger : colors.text} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.subhead, styles.text, unread && styles.unreadText]} numberOfLines={2}>
                {activityText(e)}
              </Text>
              {!!detail && (
                <Text style={type.footnote} numberOfLines={2}>
                  {detail}
                </Text>
              )}
            </View>
            <Text style={type.caption}>{formatAgo(e.at)}</Text>
            {unread && <View style={styles.dot} accessibilityLabel="New" />}
          </Pressable>
        );
      })}
      {entries.length > SHOWN && (
        <Pressable onPress={() => setAll(!all)} style={styles.more} accessibilityRole="button">
          <Text style={styles.moreText}>{all ? 'Show less' : `Show all (${entries.length})`}</Text>
        </Pressable>
      )}
    </View>
  );
}

// Where each kind of thing opens: the comment in its thread, the post, or
// the post's page in Me when a host turned it down.
function open(e: ActivityEntry) {
  if ((e.kind === 'reply' || e.kind === 'comment') && e.commentId) return router.push(`/comments/${e.itemType}/${e.itemId}?focus=${e.commentId}`);
  if (e.kind === 'rejected') return router.push(`/my-short/${e.itemId}`);
  if (e.itemType === 'episode') return router.push(`/episode/${e.itemId}`);
  router.navigate(`/shorts?id=${e.itemId}`);
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, paddingVertical: spacing.sm },
  title: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  empty: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2 },
  icon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardHigh, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.textMuted },
  unreadText: { color: colors.text, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  more: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  moreText: { ...type.footnote, color: colors.highlight, fontWeight: '700' },
});
