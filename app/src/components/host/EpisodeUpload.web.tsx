import * as UpChunk from '@mux/upchunk';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatTime, parseChapters, parseTime } from '../../lib/format';
import { parseTags } from '../../lib/host';
import { colors } from '../../theme';
import { useHost } from './HostGate';
import { ui } from './ui';
import { useVideoState } from './useVideoState';

// Web: pick a video file, upload it straight to the video service in chunks
// (so big files survive a flaky connection), and fill in the details meanwhile.
export function EpisodeUpload() {
  const { api } = useHost();
  const [file, setFile] = useState<File | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [uploaded, setUploaded] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const upload = useRef<UpChunk.UpChunk | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [chaptersText, setChaptersText] = useState('0:00 Intro');
  const [thumbText, setThumbText] = useState('0:05');
  const [tagsText, setTagsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { state: video, ready } = useVideoState(api, videoId, { needsAudio: true, uploaded });

  // Closing the tab mid-upload loses it, so ask first.
  useEffect(() => {
    if (!file || uploaded || uploadError) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [file, uploaded, uploadError]);

  useEffect(() => () => upload.current?.abort(), []);

  const start = async (picked: File) => {
    setFile(picked);
    setUploadError(null);
    setPercent(0);
    setUploaded(false);
    if (!title) setTitle(picked.name.replace(/\.[^.]+$/, ''));
    try {
      const { videoId: id, uploadUrl } = await api.createUpload('episode');
      setVideoId(id);
      const up = UpChunk.createUpload({ endpoint: uploadUrl, file: picked, chunkSize: 30720 });
      upload.current = up;
      up.on('progress', (e) => setPercent(Math.round(e.detail as number)));
      up.on('success', () => setUploaded(true));
      up.on('error', (e) => setUploadError((e.detail as { message?: string })?.message || 'Upload failed'));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    }
  };

  const { chapters, bad } = parseChapters(chaptersText);
  const thumbnailSec = parseTime(thumbText);
  const formError = !title.trim()
    ? 'Add a title.'
    : bad.length
      ? `These chapter lines need a time first, like "1:30 Topic": ${bad.join(', ')}`
      : thumbnailSec === null
        ? 'Cover image time should look like 0:05.'
        : null;

  const save = async (publish: boolean) => {
    if (!videoId || formError) return;
    setSaving(true);
    setError(null);
    try {
      const ep = await api.createEpisode({
        title: title.trim(),
        description: description.trim(),
        chapters,
        tags: parseTags(tagsText),
        videoId,
        thumbnailSec: thumbnailSec ?? 0,
      });
      if (publish) await api.updateEpisode(ep.id, { status: 'published' });
      router.replace('/host');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const stage = uploadError
    ? `Upload failed: ${uploadError}`
    : !file
      ? null
      : !uploaded
        ? `Uploading ${file.name}: ${percent}%`
        : video?.status === 'errored'
          ? `Processing failed: ${video.error}`
          : !ready
            ? video?.status === 'ready'
              ? 'Uploaded. Preparing the audio version…'
              : 'Uploaded. Processing video…'
            : `Ready · ${formatTime(video?.durationSec ?? 0)}${video?.hasAudio === false ? ' · no sound, so it will be video-only' : ''}`;

  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Text style={ui.label}>Video file</Text>
      <View style={ui.card}>
        {/* Plain file input: this component only runs on the web. */}
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/*"
          disabled={!!file && !uploaded && !uploadError}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) start(picked);
          }}
          style={{ color: colors.text }}
          aria-label="Video file"
        />
        {stage && <Text style={[ui.hint, (uploadError || video?.status === 'errored') && ui.error]}>{stage}</Text>}
        {file && !uploaded && !uploadError && (
          <View style={ui.progressTrack}>
            <View style={[ui.progressFill, { width: `${percent}%` }]} />
          </View>
        )}
        <Text style={ui.hint}>MP4 or MOV, 16:9. Keep this tab open until the upload reaches 100%; processing then carries on without it.</Text>
      </View>

      <Text style={ui.label}>Title</Text>
      <TextInput style={ui.input} value={title} onChangeText={setTitle} maxLength={200} placeholder="Episode title" placeholderTextColor={colors.textMuted} />

      <Text style={ui.label}>Description</Text>
      <TextInput
        style={[ui.input, ui.multiline]}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="What’s this episode about?"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={ui.label}>Tags</Text>
      <TextInput style={ui.input} value={tagsText} onChangeText={setTagsText} autoCapitalize="none" placeholder="#ai #testing" placeholderTextColor={colors.textMuted} />

      <Text style={ui.label}>Chapters</Text>
      <TextInput
        style={[ui.input, ui.multiline, { fontVariant: ['tabular-nums'] }]}
        value={chaptersText}
        onChangeText={setChaptersText}
        multiline
        placeholder={'0:00 Intro\n4:30 First topic'}
        placeholderTextColor={colors.textMuted}
      />
      <Text style={ui.hint}>One per line: start time, then the chapter title.</Text>

      <Text style={ui.label}>Cover image from</Text>
      <TextInput style={[ui.input, { maxWidth: 140 }]} value={thumbText} onChangeText={setThumbText} placeholder="0:05" placeholderTextColor={colors.textMuted} />
      <Text style={ui.hint}>A frame at this time in the video becomes the episode artwork.</Text>

      {(error || (videoId && formError)) && <Text style={ui.error}>{error || formError}</Text>}
      <View style={[ui.row, { marginTop: 8 }]}>
        <Pressable style={[ui.button, (!ready || !!formError || saving) && ui.buttonDisabled]} disabled={!ready || !!formError || saving} onPress={() => save(true)}>
          <Text style={ui.buttonText}>Publish</Text>
        </Pressable>
        <Pressable
          style={[ui.button, ui.secondary, (!uploaded || !!formError || saving) && ui.buttonDisabled]}
          disabled={!uploaded || !!formError || saving}
          onPress={() => save(false)}
        >
          <Text style={ui.secondaryText}>Save as draft</Text>
        </Pressable>
      </View>
      <Text style={ui.hint}>Once the upload reaches 100% you can save a draft while the video is still processing, and publish it from Host mode once it’s ready.</Text>
    </ScrollView>
  );
}
