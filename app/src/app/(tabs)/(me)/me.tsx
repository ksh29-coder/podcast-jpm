import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ErrorState } from '../../../components/ErrorState';
import { Icon } from '../../../components/Icon';
import { api, type MyShort, type Profile } from '../../../lib/api';
import { saveDisplayName } from '../../../lib/device';
import { colors, radius, spacing, type } from '../../../theme';

// Your name, Downloads, and every Short you've posted with where it is in review.
export default function MeScreen() {
  const { posted } = useLocalSearchParams<{ posted?: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [shorts, setShorts] = useState<MyShort[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showPosted, setShowPosted] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.me(), api.myShorts()]);
      setProfile(p);
      setShorts(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Fresh each visit, e.g. after posting or once a host has reviewed.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (error && !shorts) return <ErrorState message={error} onRetry={load} />;
  if (!profile || !shorts) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.text} />;

  const remove = (s: MyShort) =>
    Alert.alert('Delete this Short?', s.status === 'published' ? 'It’s removed for everyone, with its likes and comments.' : 'It won’t be reviewed or posted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteMyShort(s.id);
            setShorts((all) => all?.filter((x) => x.id !== s.id) ?? null);
          } catch (e) {
            Alert.alert('Couldn’t delete it', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);

  return (
    <FlatList
      data={shorts}
      keyExtractor={(s) => s.id}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: spacing.huge }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.text}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {posted && showPosted && (
            <Pressable style={styles.banner} onPress={() => setShowPosted(false)} accessibilityRole="button" accessibilityHint="Dismiss">
              <Icon name="checkCircle" size={20} color={colors.accentText} />
              <Text style={[type.subhead, { flex: 1, color: colors.accentText }]}>Sent for review. It goes live once a host approves it.</Text>
            </Pressable>
          )}
          <NameCard profile={profile} onSaved={setProfile} />
          <Pressable style={styles.row} onPress={() => router.push('/downloads')} accessibilityRole="button">
            <Icon name="download" size={22} />
            <Text style={[type.headline, { flex: 1 }]}>Downloads</Text>
            <Icon name="chevronRight" size={16} color={colors.textMuted} />
          </Pressable>
          <Text style={[type.eyebrow, styles.section]}>My Shorts</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={[type.subhead, { textAlign: 'center' }]}>Shorts you post appear here, with where they are in review.</Text>
          <Pressable style={styles.cta} onPress={() => router.push('/post')} accessibilityRole="button">
            <Icon name="plus" size={16} color={colors.accentText} />
            <Text style={styles.ctaText}>New Short</Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => <MyShortRow short={item} onEdit={() => router.push(`/my-short/${item.id}`)} onDelete={() => remove(item)} />}
    />
  );
}

function NameCard({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name ?? '');
  const [busy, setBusy] = useState(false);

  if (!profile.name && !editing) {
    return (
      <View style={styles.card}>
        <Text style={type.subhead}>Post a Short with ＋ and add the name shown on it.</Text>
      </View>
    );
  }
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      onSaved(await api.saveMe(name.trim()));
      await saveDisplayName(name.trim());
      setEditing(false);
    } catch (e) {
      Alert.alert('Couldn’t save', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.card, styles.nameCard]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(profile.name || name || '?').trim().charAt(0).toUpperCase()}</Text>
      </View>
      {editing ? (
        <>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={name}
            onChangeText={setName}
            maxLength={50}
            autoFocus
            onSubmitEditing={save}
            accessibilityLabel="Your name"
          />
          <Pressable onPress={save} disabled={busy || !name.trim()} style={[styles.small, (busy || !name.trim()) && { opacity: 0.4 }]} accessibilityRole="button">
            <Text style={styles.smallText}>Save</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={{ flex: 1 }}>
            <Text style={type.title}>{profile.name}</Text>
            <Text style={type.footnote}>Shown on your Shorts</Text>
          </View>
          <Pressable onPress={() => setEditing(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit your name">
            <Icon name="edit" size={18} color={colors.textMuted} />
          </Pressable>
        </>
      )}
    </View>
  );
}

const STATUS: Record<MyShort['status'], { label: string; color: string }> = {
  in_review: { label: 'In review', color: colors.highlight },
  published: { label: 'Live', color: '#4ADE80' },
  rejected: { label: 'Not approved', color: colors.danger },
  draft: { label: 'Hidden', color: colors.textMuted },
};

function MyShortRow({ short, onEdit, onDelete }: { short: MyShort; onEdit: () => void; onDelete: () => void }) {
  const status = STATUS[short.status];
  const processing = short.video && short.video.status !== 'ready';
  return (
    <View style={styles.item}>
      {short.artworkUrl && !processing ? <Image source={{ uri: short.artworkUrl }} style={styles.thumb} /> : <View style={styles.thumb} />}
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={type.headline} numberOfLines={2}>
          {short.title}
        </Text>
        <View style={styles.line}>
          <View style={[styles.dot, { backgroundColor: status.color }]} />
          <Text style={[type.footnote, { color: status.color, fontWeight: '700' }]}>{status.label}</Text>
          {processing && <Text style={type.footnote}>· {short.video?.status === 'errored' ? 'Processing failed' : 'Processing…'}</Text>}
        </View>
        {short.status === 'published' && (
          <Text style={type.footnote}>
            {short.views} views · {short.likes} likes · {short.comments} comments
          </Text>
        )}
        {short.status === 'in_review' && <Text style={type.footnote}>Waiting for a host to look at it.</Text>}
        {short.status === 'draft' && <Text style={type.footnote}>A host took it down.</Text>}
        {short.status === 'rejected' && (
          <Text style={[type.footnote, styles.note]}>{short.reviewNote ? `“${short.reviewNote}”` : 'The host didn’t leave a note.'}</Text>
        )}
        <View style={[styles.line, { marginTop: spacing.xs, gap: spacing.md }]}>
          {short.status === 'in_review' && (
            <Pressable onPress={onEdit} style={styles.small} accessibilityRole="button" accessibilityLabel={`Edit ${short.title}`}>
              <Text style={styles.smallText}>Edit</Text>
            </Pressable>
          )}
          <Pressable onPress={onDelete} style={styles.small} accessibilityRole="button" accessibilityLabel={`Delete ${short.title}`}>
            <Text style={[styles.smallText, { color: colors.danger }]}>Delete</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xl, gap: spacing.md, paddingTop: spacing.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.highlight },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg },
  nameCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tintFallback, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontSize: 22, fontWeight: '800' },
  input: { color: colors.text, backgroundColor: colors.cardHigh, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg },
  section: { marginTop: spacing.lg, marginBottom: spacing.xs },
  empty: { alignItems: 'center', gap: spacing.lg, padding: spacing.xxxl },
  cta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.full, backgroundColor: colors.accent },
  ctaText: { color: colors.accentText, fontWeight: '700', fontSize: 15 },
  item: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  thumb: { width: 72, height: 96, borderRadius: radius.sm, backgroundColor: colors.cardHigh },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  note: { color: colors.text, fontStyle: 'italic' },
  small: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full, backgroundColor: colors.cardHigh },
  smallText: { color: colors.text, fontWeight: '700', fontSize: 13 },
});
