import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type Comment, type ItemType } from '../../../lib/api';
import { getDisplayName, saveDisplayName } from '../../../lib/device';
import { formatDate } from '../../../lib/format';
import { colors } from '../../../lib/theme';
import { useFetch } from '../../../lib/useFetch';

// Comments on an episode or Short. New comments wait for a host to approve
// them; the writer sees theirs straight away, marked as waiting.
export default function CommentsScreen() {
  const { type, id } = useLocalSearchParams<{ type: ItemType; id: string }>();
  const insets = useSafeAreaInsets();
  const { data, error, reload } = useFetch(() => api.comments(type, id), [type, id]);
  const [posted, setPosted] = useState<Comment[]>([]);
  const [name, setName] = useState('');
  const [hasSavedName, setHasSavedName] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    getDisplayName().then((saved) => {
      if (saved) {
        setName(saved);
        setHasSavedName(true);
      }
    });
  }, []);

  const send = async () => {
    if (!name.trim() || !body.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const c = await api.postComment(type, id, name.trim(), body.trim());
      await saveDisplayName(name.trim());
      setHasSavedName(true);
      setPosted((p) => [c, ...p]);
      setBody('');
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const list = [...posted, ...(data || []).filter((c) => !posted.some((p) => p.id === c.id))];

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={60}>
      {!data && !error ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {error ? `Couldn't load comments: ${error}` : 'No comments yet. Comments appear once a host approves them.'}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.comment}>
              <Text style={styles.meta}>
                <Text style={styles.author}>{item.authorName}</Text> · {formatDate(item.createdAt)}
              </Text>
              <Text style={styles.body}>{item.body}</Text>
              {item.status === 'pending' && <Text style={styles.pending}>Only you can see this until a host approves it.</Text>}
            </View>
          )}
          onRefresh={reload}
          refreshing={false}
        />
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {!hasSavedName && (
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            maxLength={50}
            autoCapitalize="words"
            accessibilityLabel="Your name"
          />
        )}
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={body}
            onChangeText={setBody}
            placeholder="Add a comment"
            placeholderTextColor={colors.textMuted}
            maxLength={1000}
            multiline
            accessibilityLabel="Comment"
          />
          <Pressable
            style={[styles.send, (!name.trim() || !body.trim() || sending) && { opacity: 0.4 }]}
            disabled={!name.trim() || !body.trim() || sending}
            onPress={send}
          >
            <Text style={styles.sendText}>{sending ? '…' : 'Post'}</Text>
          </Pressable>
        </View>
        {sendError && <Text style={styles.error}>{sendError}</Text>}
        {hasSavedName && (
          <Pressable onPress={() => setHasSavedName(false)}>
            <Text style={styles.hint}>Posting as {name}. Change</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { padding: 16, gap: 16, flexGrow: 1 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 40, paddingHorizontal: 24, lineHeight: 20 },
  comment: { gap: 4 },
  meta: { color: colors.textMuted, fontSize: 12 },
  author: { color: colors.text, fontWeight: '700' },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  pending: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, padding: 12, gap: 8, backgroundColor: colors.card },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: {
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    maxHeight: 120,
  },
  send: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18, backgroundColor: colors.accent },
  sendText: { color: colors.accentText, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13 },
  hint: { color: colors.textMuted, fontSize: 12 },
});
