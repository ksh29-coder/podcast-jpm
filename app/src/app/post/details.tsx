import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { usePost, type Upload } from '../../components/post/PostContext';
import { TagsField } from '../../components/post/TagsField';
import { api, type UploadState } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { colors, radius, spacing, type } from '../../theme';

// Title, description, tags and cover for the Short, while it uploads. Once
// the video's processed and what's said is read, the AI's suggestions fill
// any empty fields; anything already typed stays, with the suggestion
// offered underneath instead.
export default function PostDetails() {
  const insets = useSafeAreaInsets();
  const { picked, upload, retryUpload } = usePost();
  // The ＋ screens' own stack; its parent is the app's, where they sit as one overlay.
  const navigation = useNavigation();
  const close = () => navigation.getParent()?.goBack();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [coverSec, setCoverSec] = useState<number | null>(null);
  const [state, setState] = useState<UploadState | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoId = upload?.videoId ?? null;
  const uploaded = !!upload?.done;

  // Check on the video until it's processed and the suggestions are in.
  useEffect(() => {
    if (!videoId || !uploaded) return;
    let stopped = false;
    let applied = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await api.upload(videoId);
        if (stopped) return;
        setState(s);
        const sug = s.suggestions;
        if (!applied && (sug.status === 'ready' || sug.status === 'unavailable')) {
          applied = true;
          // Only into fields that are still empty.
          if (sug.title) setTitle((t) => (t.trim() ? t : sug.title!));
          if (sug.description) setDescription((d) => (d.trim() ? d : sug.description!));
          if (sug.tags.length) setTags((t) => (t.length ? t : sug.tags));
          if (sug.coverSec != null) setCoverSec((c) => c ?? sug.coverSec);
        }
        if (s.status === 'errored' || (s.status === 'ready' && applied)) return;
      } catch {
        // A blip; try again on the next tick.
      }
      if (!stopped) timer = setTimeout(tick, 3000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [videoId, uploaded]);

  if (!picked || !upload) return <Redirect href="/post" />;

  const sug = state?.suggestions;
  const canPost = !!title.trim() && uploaded && !!videoId && state?.status !== 'errored' && !posting;

  const post = async () => {
    if (!canPost || !videoId) return;
    setPosting(true);
    setError(null);
    try {
      await api.postShort(videoId, { title: title.trim(), description: description.trim(), tags, ...(coverSec != null && { coverSec }) });
      close();
      router.navigate('/me?posted=1');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPosting(false);
    }
  };

  const discard = () => {
    Alert.alert('Discard this Short?', 'The video won’t be posted.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          if (videoId) api.discardUpload(videoId).catch(() => {});
          close();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={discard} hitSlop={10} accessibilityRole="button" accessibilityLabel="Discard">
          <Icon name="close" size={22} />
        </Pressable>
        <Text style={type.headline}>Details</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + spacing.xxxl }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.top}>
          <Preview uri={picked.uri} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Progress state={state} upload={upload} onRetry={retryUpload} />
          </View>
        </View>

        <Field label="Title" suggestedNow={!!sug?.title && title === sug.title}>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            maxLength={100}
            placeholder={sug && sug.status !== 'unavailable' && sug.status !== 'ready' ? 'Suggesting…' : 'What’s this Short about?'}
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Title"
          />
          <Offer value={sug?.title} current={title} onUse={setTitle} />
        </Field>

        <Field label="Description" suggestedNow={!!sug?.description && description === sug.description}>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={description}
            onChangeText={setDescription}
            maxLength={1000}
            multiline
            placeholder="Optional: the tip in a sentence or two"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Description"
          />
          <Offer value={sug?.description} current={description} onUse={setDescription} />
        </Field>

        <Field label="Tags" suggestedNow={!!sug?.tags.length && sug.tags.every((t) => tags.includes(t)) && tags.length === sug.tags.length}>
          <TagsField tags={tags} onChange={setTags} suggested={sug?.tags} />
        </Field>

        <Field label="Cover" suggestedNow={sug?.coverSec != null && coverSec === sug.coverSec}>
          {state?.frames.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {state.frames.map((f) => {
                const on = coverSec === f.sec;
                return (
                  <Pressable
                    key={f.sec}
                    onPress={() => setCoverSec(f.sec)}
                    style={[styles.frame, on && styles.frameOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Cover at ${formatTime(f.sec)}${f.sec === sug?.coverSec ? ', suggested' : ''}`}
                  >
                    <Image source={{ uri: f.url }} style={styles.frameImage} />
                    {f.sec === sug?.coverSec && (
                      <View style={styles.frameBadge}>
                        <Icon name="sparkles" size={12} color={colors.accentText} />
                      </View>
                    )}
                    <Text style={styles.frameTime}>{formatTime(f.sec)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={type.footnote}>Frames to choose from appear once the video is processed.</Text>
          )}
        </Field>

        <View style={styles.note}>
          <Icon name="checkCircle" size={16} color={colors.textMuted} />
          <Text style={[type.footnote, { flex: 1 }]}>A host reviews it before anyone else sees it. You can still edit it while it’s in review.</Text>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={[styles.button, !canPost && { opacity: 0.4 }]} disabled={!canPost} onPress={post} accessibilityRole="button">
          <Text style={styles.buttonText}>{posting ? 'Sending…' : 'Submit for review'}</Text>
        </Pressable>
        {!uploaded && !upload.error && <Text style={[type.footnote, { textAlign: 'center' }]}>You can submit once the upload has finished.</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Where the upload and the suggestions have got to.
function Progress({ state, upload, onRetry }: { state: UploadState | null; upload: Upload; onRetry: () => void }) {
  if (upload.error) {
    return (
      <>
        <Text style={styles.error}>Upload failed: {upload.error}</Text>
        <Pressable style={[styles.small, { alignSelf: 'flex-start' }]} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.smallText}>Try again</Text>
        </Pressable>
      </>
    );
  }
  if (!upload.done) {
    return (
      <>
        <Text style={type.headline}>Uploading {upload.percent}%</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${upload.percent}%` }]} />
        </View>
      </>
    );
  }
  if (state?.status === 'errored') return <Text style={styles.error}>Processing failed: {state.error || 'the video service couldn’t read this file'}</Text>;
  const sug = state?.suggestions.status;
  if (!state || state.status !== 'ready' || sug === 'none' || sug === 'generating') {
    return (
      <View style={styles.line}>
        <ActivityIndicator color={colors.highlight} />
        <Text style={[type.subhead, { flex: 1 }]}>{state?.status === 'ready' ? 'Suggesting details from what you said…' : 'Uploaded. Processing your video…'}</Text>
      </View>
    );
  }
  return (
    <View style={styles.line}>
      <Icon name="sparkles" size={18} color={colors.highlight} />
      <Text style={[type.subhead, { flex: 1 }]}>
        {sug === 'ready' ? 'Suggestions added. Change anything you like.' : 'Nothing spoken to suggest from, so add the details yourself.'}
      </Text>
    </View>
  );
}

function Field({ label, suggestedNow, children }: { label: string; suggestedNow: boolean; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.line}>
        <Text style={type.eyebrow}>{label}</Text>
        {suggestedNow && (
          <View style={styles.suggested}>
            <Icon name="sparkles" size={11} color={colors.highlight} />
            <Text style={styles.suggestedText}>Suggested</Text>
          </View>
        )}
      </View>
      {children}
    </View>
  );
}

// A suggestion for a field the person already filled in differently.
function Offer({ value, current, onUse }: { value: string | null | undefined; current: string; onUse: (v: string) => void }) {
  if (!value || !current.trim() || current === value) return null;
  return (
    <Pressable style={styles.offer} onPress={() => onUse(value)} accessibilityRole="button" accessibilityLabel={`Use suggestion: ${value}`}>
      <Icon name="sparkles" size={14} color={colors.highlight} />
      <Text style={[type.footnote, { flex: 1, color: colors.text }]} numberOfLines={2}>
        {value}
      </Text>
      <Text style={[type.footnote, { color: colors.highlight, fontWeight: '700' }]}>Use</Text>
    </Pressable>
  );
}

function Preview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={styles.preview} contentFit="cover" nativeControls={false} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  page: { padding: spacing.xl, gap: spacing.xl },
  top: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  preview: { width: 90, height: 160, borderRadius: radius.md, backgroundColor: '#000' },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.highlight },
  input: {
    color: colors.text,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  suggested: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, backgroundColor: 'rgba(255,181,71,0.15)' },
  suggestedText: { fontSize: 11, fontWeight: '700', color: colors.highlight },
  offer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.highlight },
  frame: { width: 72, borderRadius: radius.sm, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden', alignItems: 'center' },
  frameOn: { borderColor: colors.highlight },
  frameImage: { width: 68, height: 68, backgroundColor: colors.cardHigh },
  frameBadge: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },
  frameTime: { ...type.caption, paddingVertical: 2, fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  error: { color: colors.danger, fontSize: 14 },
  button: { alignItems: 'center', paddingVertical: spacing.md + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  buttonText: { color: colors.accentText, fontWeight: '700', fontSize: 17 },
  small: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.cardHigh },
  smallText: { color: colors.text, fontWeight: '700' },
});
