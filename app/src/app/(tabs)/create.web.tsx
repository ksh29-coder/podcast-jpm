import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ErrorState } from '../../components/ErrorState';
import { Icon, type IconName } from '../../components/Icon';
import { usePost } from '../../components/post/PostContext';
import { Welcome } from '../../components/post/Welcome';
import { Page } from '../../components/web/Page';
import { api, type PostKind, type Profile } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { colors, radius, spacing, type } from '../../theme';

// Longest video a Short can be cut from.
const MAX_SHORT_SOURCE_SEC = 600;

// The website's New page: post a Short (trimmed to 90 seconds) or a whole
// episode from a video file. Both wait for a host to approve them. The first
// time, a name and the guidelines come first.
export default function CreateWeb() {
  const { setPicked, startUpload, reset } = usePost();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const load = () => api.me().then(setProfile, (e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
  }, []);

  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setError(null);
          load();
        }}
      />
    );
  if (!profile) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.text} />;
  if (!profile.name || !profile.acceptedGuidelines) return <Welcome profile={profile} onDone={setProfile} />;

  const choose = async (kind: PostKind, file: File) => {
    setFileError(null);
    if (!file.type.startsWith('video/')) return setFileError('That isn’t a video file. Choose an MP4 or MOV.');
    const uri = URL.createObjectURL(file);
    const durationSec = await videoLength(uri);
    if (kind === 'short' && durationSec != null && durationSec > MAX_SHORT_SOURCE_SEC) {
      return setFileError(`That video is ${formatTime(durationSec)}. A Short can be cut from a video of up to 10 minutes; post it as an episode instead.`);
    }
    reset();
    const picked = { uri, file, durationSec, kind };
    setPicked(picked);
    if (kind === 'short') {
      router.push('/post/preview');
    } else {
      // Episodes are kept whole: straight to the details while it uploads.
      startUpload(undefined, picked);
      router.push('/post/details');
    }
  };

  return (
    <Page title="New" max={1000}>
      <Text style={[type.subhead, { marginTop: -spacing.xl }]}>Share a tip or a whole talk. A host reviews everything before anyone else sees it.</Text>
      <View style={styles.row}>
        <DropZone
          kind="short"
          icon="shorts"
          title="Short"
          detail="A quick vertical clip, up to 90 seconds. Record your camera or your screen, or choose a video; you can trim it next."
          onFile={(f) => choose('short', f)}
          onRecord={() => router.push('/post/record')}
        />
        <DropZone
          kind="episode"
          icon="film"
          title="Episode"
          detail="A longer video, kept whole. Listeners can play it as audio too."
          onFile={(f) => choose('episode', f)}
        />
      </View>
      {fileError && <Text style={styles.error}>{fileError}</Text>}
      <Text style={type.footnote}>
        Posting as {profile.name}. AI suggests a title, description, tags and cover from what’s said while your video uploads.
      </Text>
    </Page>
  );
}

// A card to choose a file (or drop one onto), and for Shorts to record one.
function DropZone({
  kind,
  icon,
  title,
  detail,
  onFile,
  onRecord,
}: {
  kind: PostKind;
  icon: IconName;
  title: string;
  detail: string;
  onFile: (f: File) => void;
  onRecord?: () => void;
}) {
  const [over, setOver] = useState(false);
  const id = `file-${kind}`;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      style={{ flex: 1, minWidth: 280, display: 'flex' }}
    >
      <View style={[styles.zone, over && styles.zoneOver]}>
        <View style={styles.zoneIcon}>
          <Icon name={icon} size={28} color={colors.highlight} />
        </View>
        <Text style={type.title}>{title}</Text>
        <Text style={[type.subhead, { textAlign: 'center' }]}>{detail}</Text>
        <View style={styles.zoneButtons}>
          {onRecord && (
            <Pressable onPress={onRecord} style={styles.zoneButton} accessibilityRole="button">
              <Icon name="video" size={16} color={colors.accentText} />
              <Text style={styles.zoneButtonText}>Record</Text>
            </Pressable>
          )}
          <label htmlFor={id} style={{ cursor: 'pointer' }}>
            <View style={[styles.zoneButton, onRecord && styles.zoneButtonSecondary]}>
              <Text style={[styles.zoneButtonText, onRecord && { color: colors.text }]}>Choose a video</Text>
            </View>
          </label>
        </View>
        <Text style={type.caption}>or drop a file here</Text>
      </View>
      <input
        id={id}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

// A video file's length in seconds, read by the browser (null if it can't tell).
function videoLength(uri: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => resolve(null);
    v.src = uri;
  });
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  zone: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  zoneOver: { borderColor: colors.highlight, backgroundColor: 'rgba(255,181,71,0.08)' },
  zoneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,181,71,0.12)', alignItems: 'center', justifyContent: 'center' },
  zoneButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  zoneButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.full, backgroundColor: colors.accent },
  zoneButtonSecondary: { backgroundColor: colors.cardHigh },
  zoneButtonText: { color: colors.accentText, fontWeight: '700', fontSize: 15 },
  error: { color: colors.danger, fontSize: 15 },
});
