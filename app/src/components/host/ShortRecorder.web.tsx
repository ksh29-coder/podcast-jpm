import * as UpChunk from '@mux/upchunk';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api as publicApi, type Episode } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { MAX_SHORT_SEC, parseTags } from '../../lib/host';
import { colors } from '../../theme';
import { useHost } from './HostGate';
import { ui } from './ui';
import { useVideoState } from './useVideoState';

// Web: record in the browser, either from the camera alone or as a screen
// recording with a movable camera bubble (like Loom). The picture is drawn
// onto a canvas, recorded with the microphone (plus the shared tab's sound,
// if any), then uploaded like any other video. A Short is vertical (9:16) and
// up to 90 seconds; an episode is landscape (16:9) and up to 30 minutes.

type Mode = 'camera' | 'screen';
type Stage = 'choose' | 'ready' | 'countdown' | 'recording' | 'review' | 'details';
export type RecordFormat = 'short' | 'episode';

const FORMATS = {
  short: { w: 720, h: 1280, maxSec: MAX_SHORT_SEC, bitrate: 5_000_000 },
  // Lower bitrate: a long recording is held in the browser's memory until it uploads.
  episode: { w: 1280, h: 720, maxSec: 30 * 60, bitrate: 2_500_000 },
} as const;
const BUBBLE_SIZES = { S: 0.2, M: 0.27, L: 0.36 }; // radius as a fraction of the picture's shorter side
type BubbleSize = keyof typeof BUBBLE_SIZES;
// The camera bubble's radius in pixels on a W×H picture.
const bubbleRadius = (W: number, H: number, size: BubbleSize) => Math.min(W, H) * BUBBLE_SIZES[size];

// Browsers slow timers in background tabs, and you'll be looking at the shared
// window, not this tab. A worker's timer keeps ticking, so drawing (and so the
// recording) keeps going.
function startTicker(fps: number, onTick: () => void) {
  const src = `setInterval(() => postMessage(0), ${Math.round(1000 / fps)});`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = onTick;
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}

// MP4 where the browser can record it (Safari, recent Chrome); WebM otherwise.
// The video service accepts both.
function pickMimeType() {
  const options = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  return options.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

// Draws `video` into a w×h box, cropping to fill it. `panX` (0–1) picks which
// part of a too-wide picture stays in view. `mirror` flips it like a selfie.
function drawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, x: number, y: number, w: number, h: number, panX = 0.5, mirror = false) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(w / vw, h / vh);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (vw - sw) * panX;
  const sy = (vh - sh) / 2;
  ctx.save();
  if (mirror) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
  }
  ctx.restore();
}

// Whole picture, with bars where the shapes differ.
function drawContain(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, W: number, H: number) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.min(W / vw, H / vh);
  const w = vw * scale;
  const h = vh * scale;
  ctx.drawImage(video, (W - w) / 2, (H - h) / 2, w, h);
}

// `onRecorded`: what to do with a finished recording (the New page hands it
// to the posting screens). Without it, as in the Host Studio, the recording
// is uploaded and published from here (Shorts only).
export function ShortRecorder({
  onRecorded,
  format = 'short',
}: { onRecorded?: (r: { uri: string; durationSec: number; blob: Blob }) => void; format?: RecordFormat } = {}) {
  const { w: W, h: H, maxSec: MAX_SEC, bitrate } = FORMATS[format];
  const bubblePx = (size: BubbleSize) => bubbleRadius(W, H, size);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraVideo = useRef<HTMLVideoElement | null>(null);
  const screenVideo = useRef<HTMLVideoElement | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const audio = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  const [mode, setMode] = useState<Mode>('screen');
  const [stage, setStage] = useState<Stage>('choose');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; url: string; durationSec: number } | null>(null);

  // Screen layout: whole screen with bars, or filled and cropped (with pan).
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [panX, setPanX] = useState(0.5);
  // Bubble centre as a fraction of the canvas. Starts in the top-right corner,
  // just inside the edges whatever the picture's shape.
  const [bubble, setBubble] = useState(() => {
    const r = bubbleRadius(W, H, 'M');
    const inset = 0.03 * Math.min(W, H);
    return { x: (W - r - inset) / W, y: (r + inset) / H };
  });
  const [bubbleSize, setBubbleSize] = useState<BubbleSize>('M');
  const [showBubble, setShowBubble] = useState(true);
  const dragging = useRef(false);

  // Latest layout for the draw loop, which runs outside React.
  const layout = useRef({ mode, fit, panX, bubble, bubbleSize, showBubble });
  useEffect(() => {
    layout.current = { mode, fit, panX, bubble, bubbleSize, showBubble };
  }, [mode, fit, panX, bubble, bubbleSize, showBubble]);

  // Stop the camera, screen share and audio when leaving the page.
  useEffect(() => () => stopSources(), []);

  function stopSources() {
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    audio.current?.ctx.close();
    audio.current = null;
  }

  // Draw loop: runs from setup until the page closes or sources stop.
  const [drawing, setDrawing] = useState(false);
  useEffect(() => {
    if (!drawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    return startTicker(30, () => {
      const l = layout.current;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const cam = cameraVideo.current;
      const scr = screenVideo.current;
      if (l.mode === 'camera') {
        if (cam) drawCover(ctx, cam, 0, 0, W, H, 0.5, true);
        return;
      }
      if (scr) {
        if (l.fit === 'contain') drawContain(ctx, scr, W, H);
        else drawCover(ctx, scr, 0, 0, W, H, l.panX);
      }
      if (cam && l.showBubble) {
        const r = bubbleRadius(W, H, l.bubbleSize);
        const cx = l.bubble.x * W;
        const cy = l.bubble.y * H;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        drawCover(ctx, cam, cx - r, cy - r, r * 2, r * 2, 0.5, true);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    });
  }, [drawing, W, H]);

  // Recording clock; stops at the limit.
  useEffect(() => {
    if (stage !== 'recording') return;
    return startTicker(10, () => {
      const sec = (Date.now() - startedAt.current) / 1000;
      setElapsed(sec);
      if (sec >= MAX_SEC) stopRecording();
    });
  }, [stage, MAX_SEC]);

  // 3-2-1 before recording, so you can switch to the window you're sharing.
  useEffect(() => {
    if (stage !== 'countdown') return;
    const t = setTimeout(() => {
      if (countdown > 1) setCountdown((c) => c - 1);
      else beginRecording();
    }, 1000);
    return () => clearTimeout(t);
    // beginRecording reads refs and the current settings; the countdown is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, countdown]);

  const setUp = async (chosen: Mode) => {
    setError(null);
    // Browsers only offer the camera and screen sharing on secure pages
    // (https://, or http://localhost); elsewhere mediaDevices is missing.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        `Your browser only allows the camera and screen recording on secure pages. Open this page at http://localhost:${window.location.port || '8081'}/host/record on this computer, or over https.`
      );
      return;
    }
    if (chosen === 'screen' && !navigator.mediaDevices.getDisplayMedia) {
      setError('This browser can’t record the screen. Use Chrome, Edge or Safari on a computer.');
      return;
    }
    setMode(chosen);
    stopSources();
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streams.current.push(cam);
      cameraVideo.current = await playIn(new MediaStream(cam.getVideoTracks()));

      // Microphone, plus the shared screen's sound when there is any, mixed into one track.
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream(cam.getAudioTracks())).connect(dest);
      audio.current = { ctx, dest };

      if (chosen === 'screen') {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
        streams.current.push(screen);
        screenVideo.current = await playIn(new MediaStream(screen.getVideoTracks()));
        if (screen.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(dest);
        // "Stop sharing" in the browser bar ends the recording too.
        screen.getVideoTracks()[0].addEventListener('ended', () => {
          if (recorder.current?.state === 'recording') stopRecording();
        });
      } else {
        screenVideo.current = null;
      }
      setDrawing(true);
      setStage('ready');
    } catch (e) {
      stopSources();
      const name = e instanceof Error ? e.name : '';
      setError(
        name === 'NotAllowedError'
          ? chosen === 'screen'
            ? 'Screen sharing, camera or microphone was blocked or cancelled. Allow them in the browser and try again.'
            : 'Camera or microphone was blocked. Allow them in the browser and try again.'
          : e instanceof Error
            ? e.message
            : String(e)
      );
    }
  };

  function beginRecording() {
    const canvas = canvasRef.current;
    if (!canvas || !audio.current) return;
    const mimeType = pickMimeType();
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...audio.current.dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: bitrate });
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || 'video/webm' });
      const durationSec = Math.min(MAX_SEC, (Date.now() - startedAt.current) / 1000);
      setResult({ blob, url: URL.createObjectURL(blob), durationSec });
      setStage('review');
    };
    recorder.current = rec;
    startedAt.current = Date.now();
    setElapsed(0);
    rec.start(1000);
    setStage('recording');
  }

  function stopRecording() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  const recordAgain = () => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    // Sources may have ended (e.g. sharing stopped); set up again if so.
    const live = streams.current.length && streams.current.every((s) => s.getTracks().every((t) => t.readyState === 'live'));
    if (live) setStage('ready');
    else {
      setDrawing(false);
      setStage('choose');
    }
  };

  // Drag the bubble on the preview.
  const pointerTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'screen' || !showBubble) return;
    const p = pointerTo(e);
    if (Math.hypot((p.x - bubble.x) * W, (p.y - bubble.y) * H) <= bubblePx(bubbleSize)) {
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    const p = pointerTo(e);
    const rx = bubblePx(bubbleSize) / W;
    const ry = bubblePx(bubbleSize) / H;
    setBubble({ x: Math.min(1 - rx, Math.max(rx, p.x)), y: Math.min(1 - ry, Math.max(ry, p.y)) });
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  if (stage === 'details' && result) {
    return <Details result={result} onBack={() => setStage('review')} />;
  }

  const live = stage === 'ready' || stage === 'countdown' || stage === 'recording';

  return (
    <ScrollView contentContainerStyle={ui.page}>
      {stage === 'choose' && (
        <>
          <Text style={ui.hint}>
            {format === 'episode' ? `Episodes are landscape (16:9) and up to ${MAX_SEC / 60} minutes.` : `Shorts are vertical and up to ${MAX_SEC} seconds.`}
          </Text>
          <View style={ui.row}>
            <ModeCard
              title="Screen + camera"
              detail="Share a screen, window or tab, with you in a bubble you can move. To show your iPhone, open iPhone Mirroring on your Mac and share that window."
              onPress={() => setUp('screen')}
            />
            <ModeCard title="Camera only" detail="A normal video of you, from your webcam." onPress={() => setUp('camera')} />
          </View>
          {error && <Text style={ui.error}>{error}</Text>}
        </>
      )}

      <View style={{ display: stage === 'choose' || stage === 'review' ? 'none' : 'flex', gap: 12 }}>
        <View style={ui.row}>
          <Text style={[ui.label, { marginTop: 0 }]}>{mode === 'screen' ? 'Screen + camera' : 'Camera only'}</Text>
          {stage === 'recording' && (
            <Text style={{ color: '#ff3b5c', fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              ● {formatTime(elapsed)} / {formatTime(MAX_SEC)}
            </Text>
          )}
        </View>
        <div style={{ position: 'relative', alignSelf: 'center', ...previewBox(format), borderRadius: 16, overflow: 'hidden', background: '#000' }}>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            style={{ width: '100%', height: '100%', display: 'block', cursor: mode === 'screen' && showBubble ? 'grab' : 'default', touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            aria-label="Recording preview"
          />
          {stage === 'countdown' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 120, fontWeight: 800, textShadow: '0 0 12px rgba(0,0,0,0.6)' }}>
              {countdown}
            </div>
          )}
        </div>

        {mode === 'screen' && live && (
          <View style={ui.card}>
            <View style={ui.row}>
              <Toggle on={fit === 'contain'} label="Whole screen" onPress={() => setFit('contain')} />
              <Toggle on={fit === 'cover'} label="Fill and crop" onPress={() => setFit('cover')} />
              <Toggle on={showBubble} label={showBubble ? 'Camera bubble on' : 'Camera bubble off'} onPress={() => setShowBubble((b) => !b)} />
            </View>
            {fit === 'cover' && (
              <>
                <Text style={ui.hint}>Which part of the screen to keep</Text>
                <input type="range" min={0} max={1} step={0.01} value={panX} onChange={(e) => setPanX(Number(e.target.value))} style={{ width: '100%', accentColor: colors.accent }} aria-label="Part of the screen to keep" />
              </>
            )}
            {showBubble && (
              <View style={ui.row}>
                <Text style={ui.hint}>Bubble size</Text>
                {(Object.keys(BUBBLE_SIZES) as BubbleSize[]).map((s) => (
                  <Toggle key={s} on={bubbleSize === s} label={s} onPress={() => setBubbleSize(s)} />
                ))}
                <Text style={ui.hint}>Drag the bubble on the preview to move it.</Text>
              </View>
            )}
          </View>
        )}

        <View style={ui.row}>
          {stage === 'ready' && (
            <Pressable
              style={[ui.button, { backgroundColor: '#ff3b5c' }]}
              onPress={() => {
                setCountdown(3);
                setStage('countdown');
              }}
            >
              <Text style={[ui.buttonText, { color: '#fff' }]}>● Start recording</Text>
            </Pressable>
          )}
          {stage === 'countdown' && (
            <Pressable style={[ui.button, ui.secondary]} onPress={() => setStage('ready')}>
              <Text style={ui.secondaryText}>Cancel</Text>
            </Pressable>
          )}
          {stage === 'recording' && (
            <Pressable style={ui.button} onPress={stopRecording}>
              <Text style={ui.buttonText}>■ Stop</Text>
            </Pressable>
          )}
          {stage === 'ready' && (
            <Pressable
              style={[ui.button, ui.secondary]}
              onPress={() => {
                stopSources();
                setDrawing(false);
                setStage('choose');
              }}
            >
              <Text style={ui.secondaryText}>Change mode</Text>
            </Pressable>
          )}
        </View>
        {stage === 'ready' && mode === 'screen' && (
          <Text style={ui.hint}>After you press Start there’s a 3-second countdown, so you can switch to the window you’re sharing.</Text>
        )}
      </View>

      {stage === 'review' && result && (
        <>
          <video src={result.url} controls playsInline style={{ alignSelf: 'center', ...previewBox(format), borderRadius: 16, background: '#000' }} />
          <Text style={ui.hint}>Length {formatTime(result.durationSec)}</Text>
          <View style={ui.row}>
            <Pressable
              style={ui.button}
              onPress={() => {
                if (!onRecorded) return setStage('details');
                stopSources();
                onRecorded({ uri: result.url, durationSec: result.durationSec, blob: result.blob });
              }}
            >
              <Text style={ui.buttonText}>Use this recording</Text>
            </Pressable>
            <Pressable style={[ui.button, ui.secondary]} onPress={recordAgain}>
              <Text style={ui.secondaryText}>Record again</Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

// The preview's size on the page: tall for a Short, wide for an episode.
function previewBox(format: RecordFormat) {
  return format === 'episode' ? { width: 'min(100%, 960px)', aspectRatio: '16 / 9' } : { height: 'min(70vh, 640px)', aspectRatio: '9 / 16' };
}

// A hidden, muted <video> playing a stream, ready to be drawn from.
async function playIn(stream: MediaStream) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  await v.play();
  return v;
}

function ModeCard({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) {
  return (
    <Pressable style={[ui.card, { flex: 1, minWidth: 240 }]} onPress={onPress} accessibilityRole="button">
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
      <Text style={ui.hint}>{detail}</Text>
    </Pressable>
  );
}

function Toggle({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable style={[ui.button, !on && ui.secondary, { paddingVertical: 7, paddingHorizontal: 14 }]} onPress={onPress} accessibilityState={{ selected: on }}>
      <Text style={on ? ui.buttonText : ui.secondaryText}>{label}</Text>
    </Pressable>
  );
}

// After recording: title, tags, related episode, then upload and publish.
function Details({ result, onBack }: { result: { blob: Blob; durationSec: number }; onBack: () => void }) {
  const { api } = useHost();
  const [title, setTitle] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodeId, setEpisodeId] = useState('');
  const [percent, setPercent] = useState<number | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [shortId, setShortId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const { state: video, ready } = useVideoState(api, videoId, { uploaded: !!shortId });

  useEffect(() => {
    publicApi.episodes().then(setEpisodes, () => setEpisodes([]));
  }, []);

  const upload = async () => {
    setError(null);
    setPercent(0);
    try {
      const { videoId: id, uploadUrl } = await api.createUpload('short');
      setVideoId(id);
      const ext = result.blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([result.blob], `short.${ext}`, { type: result.blob.type });
      await new Promise<void>((resolve, reject) => {
        const up = UpChunk.createUpload({ endpoint: uploadUrl, file, chunkSize: 30720 });
        up.on('progress', (e) => setPercent(Math.round(e.detail as number)));
        up.on('success', () => resolve());
        up.on('error', (e) => reject(new Error((e.detail as { message?: string })?.message || 'Upload failed')));
      });
      const short = await api.uploadShort({ videoId: id, title: title.trim(), episodeId: episodeId || undefined, tags: parseTags(tagsText) });
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
      router.replace('/host');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPublishing(false);
    }
  };

  const uploading = percent !== null && !shortId;

  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Text style={ui.hint}>Recording · {formatTime(result.durationSec)}</Text>
      <Text style={ui.label}>Title</Text>
      <TextInput style={ui.input} value={title} onChangeText={setTitle} maxLength={200} editable={!uploading && !shortId} placeholder="What’s this Short about?" placeholderTextColor={colors.textMuted} />
      <Text style={ui.label}>Tags</Text>
      <TextInput style={ui.input} value={tagsText} onChangeText={setTagsText} editable={!uploading && !shortId} autoCapitalize="none" placeholder="#ai #testing" placeholderTextColor={colors.textMuted} />
      {episodes.length > 0 && (
        <>
          <Text style={ui.label}>Related episode (optional)</Text>
          <select
            value={episodeId}
            disabled={uploading || !!shortId}
            onChange={(e) => setEpisodeId(e.target.value)}
            style={{ padding: 10, borderRadius: 10, background: colors.card, color: colors.text, border: `1px solid ${colors.border}`, fontSize: 15 }}
            aria-label="Related episode"
          >
            <option value="">None</option>
            {episodes.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.title}
              </option>
            ))}
          </select>
        </>
      )}
      {error && <Text style={ui.error}>{error}</Text>}
      {!shortId ? (
        <View style={ui.row}>
          <Pressable style={[ui.button, (!title.trim() || uploading) && ui.buttonDisabled]} disabled={!title.trim() || uploading} onPress={upload}>
            <Text style={ui.buttonText}>{uploading ? `Uploading ${percent}%` : 'Upload'}</Text>
          </Pressable>
          <Pressable style={[ui.button, ui.secondary, uploading && ui.buttonDisabled]} disabled={uploading} onPress={onBack}>
            <Text style={ui.secondaryText}>Back to the recording</Text>
          </Pressable>
        </View>
      ) : (
        <View style={ui.card}>
          <Text style={[ui.hint, video?.status === 'errored' && ui.error]}>
            {video?.status === 'errored' ? `Processing failed: ${video.error}` : ready ? 'Uploaded and ready.' : 'Uploaded. Processing the video…'}
          </Text>
          <View style={ui.row}>
            <Pressable style={[ui.button, (!ready || publishing) && ui.buttonDisabled]} disabled={!ready || publishing} onPress={publish}>
              <Text style={ui.buttonText}>Publish</Text>
            </Pressable>
            <Pressable style={[ui.button, ui.secondary]} onPress={() => router.replace('/host')}>
              <Text style={ui.secondaryText}>Keep as draft</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
