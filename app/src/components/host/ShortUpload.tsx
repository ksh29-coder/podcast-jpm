import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { api as publicApi, type Episode } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { MAX_SHORT_SEC, parseTags } from '../../lib/host';
import { colors } from '../../theme';
import { useHost } from './HostGate';
import { takeRecording } from './recording';
import { ui } from './ui';
import { useVideoState } from './useVideoState';

type Picked = { uri: string; durationSec: number | null };

// Phone: pick a clip (iOS lets you trim it to 90 seconds in the picker), give
// it a title, optionally link it to an episode, and upload it.
export function ShortUpload() {
  const { api } = useHost();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodeId, setEpisodeId] = useState<string | null>(null);

  const [percent, setPercent] = useState<number | null>(null);
  const [shortId, setShortId] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const { state: video, ready } = useVideoState(api, videoId, { uploaded: !!shortId });

  // Coming back from the camera with a new recording.
  useFocusEffect(
    useCallback(() => {
      const rec = takeRecording();
      if (rec) {
        setPickError(null);
        setPicked({ uri: rec.uri, durationSec: rec.durationSec });
      }
    }, [])
  );

  useEffect(() => {
    publicApi.episodes().then(setEpisodes, () => setEpisodes([]));
    return () => abort.current?.abort();
  }, []);

  const pick = async () => {
    setPickError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // iOS shows its trimmer and keeps the clip within videoMaxDuration.
      allowsEditing: true,
      videoMaxDuration: MAX_SHORT_SEC,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const durationSec = asset.duration != null ? asset.duration / 1000 : null;
    if (durationSec != null && durationSec > MAX_SHORT_SEC + 0.5) {
      setPickError(`That video is ${formatTime(durationSec)}. Shorts can be at most ${MAX_SHORT_SEC} seconds, so trim it in your Photos app first.`);
      return;
    }
    setPicked({ uri: asset.uri, durationSec });
  };

  const upload = async () => {
    if (!picked || !title.trim()) return;
    setError(null);
    setPercent(0);
    try {
      const { videoId: id, uploadUrl } = await api.createUpload('short');
      setVideoId(id);
      abort.current = new AbortController();
      // A Short is small enough to send in one request, straight to the video service.
      const task = new File(picked.uri).createUploadTask(uploadUrl, {
        httpMethod: 'PUT',
        signal: abort.current.signal,
        onProgress: ({ bytesSent, totalBytes }) => totalBytes > 0 && setPercent(Math.round((bytesSent / totalBytes) * 100)),
      });
      const res = await task.uploadAsync();
      if (res.status >= 300) throw new Error(`Upload failed (${res.status})`);
      const short = await api.uploadShort({ videoId: id, title: title.trim(), episodeId: episodeId ?? undefined, tags: parseTags(tagsText) });
      setShortId(short.id);
    } catch (e) {
      setPercent(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const publish = async () => {
    if (!shortId) return;
    setPublishing(true);
    try {
      await api.updateShort(shortId, { status: 'published' });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPublishing(false);
    }
  };

  const uploading = percent !== null && !shortId;

  return (
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      {picked ? <Preview uri={picked.uri} /> : null}
      <View style={ui.row}>
        <Pressable
          style={[ui.button, picked && ui.secondary, { flexGrow: 1 }, (uploading || !!shortId) && ui.buttonDisabled]}
          disabled={uploading || !!shortId}
          onPress={() => router.push('/host/record')}
        >
          <Text style={picked ? ui.secondaryText : ui.buttonText}>{picked ? 'Record again' : 'Record'}</Text>
        </Pressable>
        <Pressable style={[ui.button, ui.secondary, { flexGrow: 1 }, (uploading || !!shortId) && ui.buttonDisabled]} disabled={uploading || !!shortId} onPress={pick}>
          <Text style={ui.secondaryText}>{picked ? 'Choose another' : 'Choose from library'}</Text>
        </Pressable>
      </View>
      {picked?.durationSec != null && <Text style={ui.hint}>Length {formatTime(picked.durationSec)}</Text>}
      {pickError && <Text style={ui.error}>{pickError}</Text>}
      <Text style={ui.hint}>Vertical (9:16) works best. Up to {MAX_SHORT_SEC} seconds.</Text>

      <Text style={ui.label}>Title</Text>
      <TextInput
        style={ui.input}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        editable={!uploading && !shortId}
        placeholder="What's this Short about?"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={ui.label}>Tags</Text>
      <TextInput
        style={ui.input}
        value={tagsText}
        onChangeText={setTagsText}
        editable={!uploading && !shortId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="#ai #testing"
        placeholderTextColor={colors.textMuted}
      />

      {episodes.length > 0 && (
        <>
          <Text style={ui.label}>Related episode (optional)</Text>
          <View style={ui.row}>
            {episodes.map((ep) => (
              <Pressable
                key={ep.id}
                style={[styles.chip, episodeId === ep.id && styles.chipOn]}
                disabled={uploading || !!shortId}
                onPress={() => setEpisodeId((cur) => (cur === ep.id ? null : ep.id))}
                accessibilityState={{ selected: episodeId === ep.id }}
              >
                <Text style={[styles.chipText, episodeId === ep.id && styles.chipTextOn]} numberOfLines={1}>
                  {ep.title}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={ui.hint}>Viewers get a button to play that episode.</Text>
        </>
      )}

      {error && <Text style={ui.error}>{error}</Text>}

      {!shortId ? (
        <>
          <Pressable style={[ui.button, { marginTop: 8 }, (!picked || !title.trim() || uploading) && ui.buttonDisabled]} disabled={!picked || !title.trim() || uploading} onPress={upload}>
            <Text style={ui.buttonText}>{uploading ? `Uploading ${percent}%` : 'Upload'}</Text>
          </Pressable>
          {uploading && (
            <View style={ui.progressTrack}>
              <View style={[ui.progressFill, { width: `${percent ?? 0}%` }]} />
            </View>
          )}
        </>
      ) : (
        <View style={[ui.card, { marginTop: 8 }]}>
          <Text style={[ui.hint, video?.status === 'errored' && ui.error]}>
            {video?.status === 'errored' ? `Processing failed: ${video.error}` : ready ? 'Uploaded and ready.' : 'Uploaded. Processing the video…'}
          </Text>
          <View style={ui.row}>
            <Pressable style={[ui.button, (!ready || publishing) && ui.buttonDisabled]} disabled={!ready || publishing} onPress={publish}>
              <Text style={ui.buttonText}>Publish</Text>
            </Pressable>
            <Pressable style={[ui.button, ui.secondary]} onPress={() => router.back()}>
              <Text style={ui.secondaryText}>Keep as draft</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function Preview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={styles.preview} contentFit="contain" nativeControls={false} />;
}

const styles = StyleSheet.create({
  preview: { width: '60%', aspectRatio: 9 / 16, alignSelf: 'center', borderRadius: 12, backgroundColor: '#000' },
  chip: { maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: colors.accentText },
});
