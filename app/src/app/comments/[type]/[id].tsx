import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../../components/Icon';
import { api, type Comment, type ItemType } from '../../../lib/api';
import { blockAuthor, unblockAll, useBlocked } from '../../../lib/blocked';
import { getDisplayName, saveDisplayName } from '../../../lib/device';
import { formatDate, formatTime } from '../../../lib/format';
import { usePlayer } from '../../../lib/player';
import { useFetch } from '../../../lib/useFetch';
import { colors, radius, spacing, type as text } from '../../../theme';

const REASONS = ['Spam', 'Offensive', 'Off topic', 'Other'];

// Comments on an episode or Short. New comments go up straight away. Replies
// sit under the comment they answer, one level deep like YouTube; the person
// answered is told in their Activity. Anyone can report a comment (it's hidden
// until a host looks at it) or block its author on their device.
// focus: a comment to show (from Activity), with its thread open.
export default function CommentsScreen() {
  const { type, id, focus } = useLocalSearchParams<{ type: ItemType; id: string; focus?: string }>();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const [posted, setPosted] = useState<Comment[]>([]);
  const [name, setName] = useState('');
  const [hasSavedName, setHasSavedName] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Shared with the feeds: hiding someone here hides their posts too.
  const blocked = useBlocked();
  const [hidden, setHidden] = useState<string[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The comment being answered, and the threads with their replies showing.
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const listRef = useRef<FlatList<Comment>>(null);
  const inputRef = useRef<TextInput>(null);

  // From Activity, once the comments are in: open the comment's thread,
  // scroll to it and light it up for a moment.
  const focused = useRef(false);
  function showFocus(comments: Comment[]) {
    if (!focus || focused.current) return comments;
    focused.current = true;
    const c = comments.find((x) => x.id === focus);
    if (!c) {
      setNotice('That comment isn’t there any more.');
      return comments;
    }
    const thread = c.parentId ?? c.id;
    setOpen((o) => [...o, thread]);
    setHighlight(c.id);
    const index = comments.filter((x) => !x.parentId).findIndex((x) => x.id === thread);
    if (index > 0) setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.2 }), 300);
    setTimeout(() => setHighlight(null), 3000);
    return comments;
  }

  const { data, error, reload } = useFetch(() => api.comments(type, id).then(showFocus), [type, id]);

  // On the episode that's playing, a comment can be pinned to where you are.
  const here = type === 'episode' && player.episode?.id === id ? Math.floor(player.status.currentTime) : null;
  const [pinTime, setPinTime] = useState(true);

  // KeyboardAvoidingView mismeasures inside an iOS form sheet. The sheet's
  // bottom edge is the screen's, so lifting the composer by the keyboard's
  // height keeps it just above the keyboard.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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
      const c = await api.postComment(
        type,
        id,
        name.trim(),
        body.trim(),
        replyTo ? { replyTo: replyTo.id } : { atSec: pinTime && here !== null ? here : undefined }
      );
      await saveDisplayName(name.trim());
      setHasSavedName(true);
      setPosted((p) => [c, ...p]);
      setBody('');
      setReplyTo(null);
      if (c.parentId) setOpen((o) => [...o, c.parentId!]);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const report = async (c: Comment, reason: string) => {
    setMenuFor(null);
    try {
      await api.reportComment(type, id, c.id, reason);
      setHidden((h) => [...h, c.id]);
      setNotice('Thanks. The comment is hidden while a host reviews it.');
    } catch (e) {
      setNotice(`Couldn’t report it: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const block = async (c: Comment) => {
    setMenuFor(null);
    if (!c.authorKey) return;
    await blockAuthor(c.authorKey);
    setNotice(`You won’t see comments or posts from ${c.authorName} any more.`);
  };

  // Close the sheet and play from that moment; the mini player (or Now
  // Playing underneath) shows it. Video-only episodes open at that time instead.
  const jump = async (sec: number) => {
    if (player.episode?.id === id) {
      player.playEpisode(player.episode, sec);
      return router.back();
    }
    try {
      const ep = await api.episode(id);
      if (!ep.audioUrl) return router.replace(`/episode/${id}?t=${sec}`);
      player.playEpisode(ep, sec);
      router.back();
    } catch (e) {
      setNotice(`Couldn’t play it: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const all = [...posted, ...(data || []).filter((c) => !posted.some((p) => p.id === c.id))].filter(
    (c) => !hidden.includes(c.id) && !(c.authorKey && !c.mine && blocked.includes(c.authorKey))
  );
  // Threads newest first; the replies in each oldest first, like a conversation.
  const list = all.filter((c) => !c.parentId);
  const replies = (parentId: string) => all.filter((c) => c.parentId === parentId).reverse();

  const startReply = (c: Comment) => {
    setMenuFor(null);
    setReplyTo(c);
    inputRef.current?.focus();
  };

  const renderComment = (item: Comment, isReply: boolean) => (
    <View style={[styles.comment, isReply && styles.reply, highlight === item.id && styles.highlight]}>
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { flex: 1 }]}>
          <Text style={styles.author}>{item.authorName}</Text> · {formatDate(item.createdAt)}
        </Text>
        {!item.mine && item.status === 'approved' && (
          <Pressable
            onPress={() => setMenuFor(menuFor === item.id ? null : item.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="More options"
          >
            <Text style={styles.more}>⋯</Text>
          </Pressable>
        )}
      </View>
      {item.atSec != null && (
        <Pressable onPress={() => jump(item.atSec!)} accessibilityRole="button" accessibilityLabel={`Play from ${formatTime(item.atSec)}`}>
          <Text style={styles.at}>at {formatTime(item.atSec)}</Text>
        </Pressable>
      )}
      <Text style={styles.body}>
        {item.replyToName && <Text style={styles.mention}>@{item.replyToName} </Text>}
        {item.body}
      </Text>
      {item.status === 'pending' && <Text style={styles.pending}>Only you can see this while a host looks at it.</Text>}
      {item.status === 'approved' && (
        <Pressable onPress={() => startReply(item)} hitSlop={8} style={styles.replyButton} accessibilityRole="button" accessibilityLabel={`Reply to ${item.authorName}`}>
          <Text style={styles.action}>Reply</Text>
        </Pressable>
      )}
      {menuFor === item.id && (
        <View style={styles.menu}>
          <Text style={styles.hint}>Report this comment as:</Text>
          <View style={styles.chips}>
            {REASONS.map((r) => (
              <Pressable key={r} style={styles.chip} onPress={() => report(item, r)} accessibilityRole="button">
                <Text style={styles.chipText}>{r}</Text>
              </Pressable>
            ))}
          </View>
          {item.authorKey && (
            <Pressable style={[styles.chip, { alignSelf: 'flex-start' }]} onPress={() => block(item)} accessibilityRole="button">
              <Text style={[styles.chipText, { color: colors.danger }]}>Block {item.authorName}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <Text style={[text.headline, styles.heading]} accessibilityRole="header">
        Comments
      </Text>
      {notice && (
        <Pressable onPress={() => setNotice(null)} style={styles.notice} accessibilityRole="button" accessibilityHint="Dismiss">
          <Text style={text.footnote}>{notice}</Text>
        </Pressable>
      )}
      {!data && !error ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.text} />
      ) : (
        // Wrapped so react-native-screens doesn't treat the list as the sheet's
        // scroll view: it resizes that to fill the sheet when the sheet changes
        // height, which covered the heading and composer.
        <View style={styles.listWrap} collapsable={false}>
          <FlatList
            ref={listRef}
            data={list}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            alwaysBounceVertical
            ListEmptyComponent={
              <Text style={styles.empty}>{error ? `Couldn't load comments: ${error}` : 'No comments yet. Be the first.'}</Text>
            }
            ListFooterComponent={
              blocked.length > 0 ? (
                <Pressable
                  onPress={() => unblockAll()}
                  accessibilityRole="button"
                >
                  <Text style={[styles.hint, { textAlign: 'center', paddingTop: spacing.lg }]}>
                    {blocked.length} {blocked.length === 1 ? 'person' : 'people'} blocked · Unblock all
                  </Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => {
              const answers = replies(item.id);
              const showing = open.includes(item.id);
              return (
                <View style={{ gap: spacing.sm }}>
                  {renderComment(item, false)}
                  {answers.length > 0 && (
                    <Pressable
                      onPress={() => setOpen((o) => (showing ? o.filter((x) => x !== item.id) : [...o, item.id]))}
                      style={styles.toggle}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: showing }}
                    >
                      <Icon name={showing ? 'chevronUp' : 'chevronDown'} size={13} color={colors.highlight} />
                      <Text style={styles.toggleText}>{showing ? 'Hide replies' : `${answers.length} ${answers.length === 1 ? 'reply' : 'replies'}`}</Text>
                    </Pressable>
                  )}
                  {showing && answers.map((r) => <View key={r.id}>{renderComment(r, true)}</View>)}
                </View>
              );
            }}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              listRef.current?.scrollToOffset({ offset: averageItemLength * index });
              setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.2 }), 200);
            }}
            onRefresh={reload}
            refreshing={false}
          />
        </View>
      )}

      <View
        style={[
          styles.composer,
          {
            paddingBottom: keyboard ? keyboard + spacing.sm : Math.max(insets.bottom, 12),
          },
        ]}
      >
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
        {replyTo && (
          <View style={styles.replying}>
            <Icon name="reply" size={14} color={colors.textMuted} />
            <Text style={[styles.hint, { flex: 1 }]} numberOfLines={1}>
              Replying to <Text style={styles.author}>{replyTo.authorName}</Text>
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel reply">
              <Icon name="close" size={14} color={colors.textMuted} />
            </Pressable>
          </View>
        )}
        {here !== null && !replyTo && (
          <Pressable
            onPress={() => setPinTime((p) => !p)}
            style={[styles.pin, pinTime && styles.pinOn]}
            accessibilityRole="switch"
            accessibilityState={{ checked: pinTime }}
          >
            <Text style={[styles.chipText, pinTime && { color: colors.accentText }]}>{pinTime ? `At ${formatTime(here)}` : 'Not tied to a moment'}</Text>
          </Pressable>
        )}
        <View style={styles.row}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { flex: 1 }]}
            value={body}
            onChangeText={setBody}
            placeholder={replyTo ? `Reply to ${replyTo.authorName}` : 'Add a comment'}
            placeholderTextColor={colors.textMuted}
            maxLength={1000}
            multiline
            accessibilityLabel="Comment"
          />
          <Pressable
            style={[styles.send, (!name.trim() || !body.trim() || sending) && { opacity: 0.4 }]}
            disabled={!name.trim() || !body.trim() || sending}
            onPress={send}
            accessibilityRole="button"
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: {
    textAlign: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  notice: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardHigh,
  },
  listWrap: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1 },
  empty: {
    ...text.subhead,
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: spacing.xxl,
  },
  comment: { gap: spacing.xs, borderRadius: radius.md },
  // Replies sit indented under their comment, like YouTube.
  reply: { marginLeft: spacing.xl, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border, borderRadius: 0 },
  highlight: { backgroundColor: colors.cardHigh, padding: spacing.sm },
  mention: { color: colors.highlight, fontWeight: '700' },
  replyButton: { alignSelf: 'flex-start' },
  action: { ...text.caption, color: colors.textMuted, fontWeight: '700' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginLeft: spacing.xl, alignSelf: 'flex-start' },
  toggleText: { ...text.caption, color: colors.highlight, fontWeight: '700' },
  replying: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meta: { ...text.caption },
  author: { color: colors.text, fontWeight: '700' },
  more: {
    color: colors.textMuted,
    fontSize: 20,
    fontWeight: '800',
    paddingHorizontal: spacing.xs,
  },
  at: {
    ...text.caption,
    color: colors.highlight,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  pending: { ...text.caption, fontStyle: 'italic' },
  menu: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.cardHigh,
  },
  chipText: { ...text.footnote, color: colors.text, fontWeight: '700' },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.card,
  },
  pin: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.full,
    backgroundColor: colors.cardHigh,
  },
  pinOn: { backgroundColor: colors.highlight },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  input: {
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    maxHeight: 120,
  },
  send: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: colors.accent,
  },
  sendText: { color: colors.accentText, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13 },
  hint: { ...text.caption },
});
