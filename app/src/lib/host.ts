import { getItem, setItem } from './storage';
import { request, type Chapter, type Clip, type Episode, type Mention, type Stats } from './api';

// What the AI suggested for an episode, waiting for a host to apply it.
export type AiSuggestions = {
  summary: string;
  chapters: Chapter[];
  tags: string[];
  mentions: Mention[];
  shorts: { startSec: number; endSec: number; title: string; why: string }[];
  speakers?: Record<string, string>;
  model: string;
  generatedAt: string;
};

// Host mode: uploading and publishing. Unlocked with the shared host passcode
// until company sign-in exists; the passcode is kept on the device.

const KEY = 'host-passcode';

export const loadPasscode = () => getItem(KEY);
export const savePasscode = (passcode: string | null) => setItem(KEY, passcode);

export type Status = 'draft' | 'in_review' | 'published' | 'rejected';

export type VideoState = {
  id: string;
  status: 'uploading' | 'processing' | 'ready' | 'errored';
  error: string | null;
  audioReady?: boolean;
  // false when the video has no sound, so the episode will be video-only.
  hasAudio?: boolean | null;
  transcriptStatus?: string;
  // 'mux' (Whisper captions) or the speech-to-text model that made it.
  transcriptSource?: string | null;
  durationSec?: number | null;
};

// publishedAt is in the future while a release is scheduled.
type HostFields = { status: Status; video: VideoState | null; createdAt: string; publishedAt: string | null };

// Of everyone who started an episode, how many reached each tenth of it.
export type Reach = { listeners: number; durationSec: number; points: { percent: number; atSec: number; listeners: number; share: number }[] };
export type HostEpisode = Omit<Episode, 'clips'> &
  HostFields & { thumbnailSec?: number; ai?: AiSuggestions | null; speakers?: Record<string, string>; transcriptSpeakers?: string[]; clips: HostShort[] };
export type HostShort = Clip &
  HostFields &
  Stats & {
    episodeId: string | null;
    episodeTitle: string | null;
    artworkUrl: string | null;
    description: string;
    // Posted from the app by someone (null when a host made it).
    author: { name: string } | null;
    coverSec: number | null;
    reviewNote: string | null;
    // The AI's check of what's said, for posted Shorts.
    aiCheck: { status: 'none' | 'generating' | 'ready' | 'unavailable'; concerns: string[] } | null;
  };

export const MAX_SHORT_SEC = 90;

// "#ai, testing  tools" -> ["ai", "testing", "tools"]. The server cleans up further.
export function parseTags(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, '').trim())
    .filter(Boolean);
}

export type HostComment = {
  id: string;
  authorName: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  itemType: 'episode' | 'short';
  itemId: string;
  itemTitle: string | null;
  atSec: number | null;
  // Reasons from viewers who reported it.
  reports: string[];
};

export function hostApi(passcode: string) {
  const call = <T>(method: string, path: string, body?: unknown) =>
    request<T>(`/api/host${path}`, {
      method,
      headers: { 'X-Host-Passcode': passcode },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  return {
    session: () => call<{ ok: true }>('GET', '/session'),
    createUpload: (kind: 'episode' | 'short') => call<{ videoId: string; uploadUrl: string }>('POST', '/uploads', { kind }),
    video: (id: string) => call<VideoState>('GET', `/videos/${id}`),
    episodes: () => call<HostEpisode[]>('GET', '/episodes'),
    episode: (id: string) => call<HostEpisode>('GET', `/episodes/${id}`),
    createEpisode: (body: { title: string; description: string; chapters: Chapter[]; tags: string[]; videoId: string; thumbnailSec: number }) =>
      call<HostEpisode>('POST', '/episodes', body),
    generateAi: (id: string) => call<HostEpisode>('POST', `/episodes/${id}/ai`),
    retranscribe: (id: string) => call<HostEpisode>('POST', `/episodes/${id}/transcribe`),
    updateEpisode: (
      id: string,
      body: Partial<{
        title: string;
        description: string;
        chapters: Chapter[];
        tags: string[];
        thumbnailSec: number;
        status: Status;
        summary: string | null;
        mentions: Mention[];
        speakers: Record<string, string>;
        publishAt: string;
      }>
    ) =>
      call<HostEpisode>('PATCH', `/episodes/${id}`, body),
    shorts: () => call<HostShort[]>('GET', '/shorts'),
    clipShort: (body: { episodeId: string; title: string; startSec: number; endSec: number; focusX: number; tags: string[] }) =>
      call<HostShort>('POST', '/shorts', body),
    uploadShort: (body: { videoId: string; title: string; episodeId?: string; focusX?: number; tags: string[] }) => call<HostShort>('POST', '/shorts', body),
    updateShort: (
      id: string,
      body: Partial<{ title: string; description: string; focusX: number; tags: string[]; coverSec: number; status: Status; publishAt: string; reviewNote: string | null }>
    ) =>
      call<HostShort>('PATCH', `/shorts/${id}`, body),
    reach: (id: string) => call<Reach>('GET', `/episodes/${id}/reach`),
    comments: () => call<HostComment[]>('GET', '/comments'),
    setCommentStatus: (id: string, status: 'approved' | 'rejected') => call<void>('PATCH', `/comments/${id}`, { status }),
  };
}

export type HostApi = ReturnType<typeof hostApi>;

export const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  rejected: 'Rejected',
};

// One line on where a video has got to, for lists and upload screens.
export function videoLabel(v: VideoState | null, { needsAudio = false } = {}) {
  if (!v) return null;
  if (v.status === 'errored') return `Failed: ${v.error || 'processing error'}`;
  if (v.status === 'uploading') return 'Waiting for upload';
  if (v.status === 'processing') return 'Processing video…';
  if (needsAudio && !v.audioReady && v.hasAudio !== false) return 'Preparing audio…';
  return null;
}


// "Scheduled · Tue 21 Oct, 09:00" when published with a future release time.
export function isScheduled(item: { status: Status; publishedAt: string | null }) {
  return item.status === 'published' && !!item.publishedAt && new Date(item.publishedAt).getTime() > Date.now();
}

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
