import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CommentCard, ReviewCard } from '../../components/host/cards';
import { ui } from '../../components/host/ui';
import { useHostData } from '../../components/host/useHostData';
import { videoLabel } from '../../lib/host';
import { colors, spacing } from '../../theme';

// Host Studio → Review: Shorts and episodes people posted, and comments,
// waiting for a host. Nothing here is visible to anyone else yet.
export default function StudioReview() {
  const { episodes, shorts, comments, error, busyId, toReview, reviewComment } = useHostData();
  if (!episodes || !shorts) {
    return error ? <Text style={[ui.error, { padding: 20 }]}>{error}</Text> : <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />;
  }
  return (
    <ScrollView contentContainerStyle={ui.page}>
      {error && <Text style={ui.error}>{error}</Text>}
      <View style={styles.columns}>
        <View style={styles.col}>
          <Text style={[ui.section, { marginTop: 0 }]}>Posts to review ({toReview.length})</Text>
          <Text style={ui.hint}>Posted from the app and website. Open one to watch it, fix the details, and approve or reject it.</Text>
          {toReview.length === 0 && <Text style={[ui.hint, styles.empty]}>Nothing waiting.</Text>}
          {toReview.map((item) => (
            <ReviewCard key={item.id} item={item} progress={videoLabel(item.video, { needsAudio: item.id.startsWith('ep_') })} onOpen={() => router.push(`/host/review/${item.id}`)} />
          ))}
        </View>
        <View style={styles.col}>
          <Text style={[ui.section, { marginTop: 0 }]}>Reported comments ({comments.length})</Text>
          <Text style={ui.hint}>Comments go up straight away. Reported ones are hidden and wait here: approve to show it again, reject to keep it hidden.</Text>
          {comments.length === 0 && <Text style={[ui.hint, styles.empty]}>Nothing waiting.</Text>}
          {comments.map((c) => (
            <CommentCard key={c.id} comment={c} busy={busyId === c.id} onReview={(s) => reviewComment(c.id, s)} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxxl },
  col: { flex: 1, minWidth: 340, gap: spacing.md },
  empty: { paddingVertical: spacing.xl },
});
