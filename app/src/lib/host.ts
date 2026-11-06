import { getItem, setItem } from './storage';
import { request, type Captions, type Chapter, type Clip, type Cue, type EditStatus, type Episode, type Mention, type Stats } from './api';

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
  // Pictures the uploader added, being drawn into a Short's video.
  edit?: { status: EditStatus; error: string | null };
  // 'mux' (Whisper captions) or the speech-to-text model that made it.
  transcriptSource?: string | null;
  durationSec?: number | null;
};

// publishedAt is in the future while a release is scheduled.
type HostFields = { status: Status; video: VideoState | null; createdAt: string; publishedAt: string | null };

// Of everyone who started an episode, how many reached each tenth of it.
export type Reach = { listeners: number; durationSec: number; points: { percent: number; atSec: number; listeners: number; share: number }[] };
// The AI's check of what's said in something posted from the app or website.
export type AiCheck = { status: 'none' | 'generating' | 'ready' | 'unavailable'; concerns: string[] } | null;

export type HostEpisode = Omit<Episode, 'clips'> &
  HostFields & {
    thumbnailSec?: number;
    ai?: AiSuggestions | null;
    speakers?: Record<string, string>;
    transcriptSpeakers?: string[];
    clips: HostShort[];
    reviewNote?: string | null;
    aiCheck?: AiCheck;
    // Reasons viewers gave when reporting it.
    reports?: string[];
  };
export type HostShort = Clip &
  HostFields &
  Stats & {
    episodeId: string | null;
    episodeTitle: string | null;
    artworkUrl: string | null;
    description: string;
    // Posted from the app by someone (null when a host made it).
    author: { name: string; key: string } | null;
    coverSec: number | null;
    // How many pictures the uploader added (they're in the video once edit is ready).
    pictureCount: number;
    reports?: string[];
    reviewNote: string | null;
    aiCheck: AiCheck;
  };

// Editing an episode's video on the website: the edit plan (see the backend's
// edit-engine/plan.js), in seconds of the original upload.
export type EditItem = { id: string; from: number; to: number; reason?: string; by?: string; state?: 'suggested' };
export type EditCut = EditItem;
export type TextStyleName = 'lower-third' | 'title' | 'caption' | 'label';
export type EditText = EditItem & { style: TextStyleName; text: string; subtitle?: string; x?: number; y?: number };
export type Layout = 'speaker' | 'screen' | 'screen+speaker' | 'side-by-side';
export type EditScene = EditItem & { layout: Layout; source?: string; pip?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' };
export type EditZoom = EditItem & { source: string; rect: [number, number, number, number] };
export type EditSource = { video: string; durationSec: number; width?: number; height?: number; offsetSec: number };
export type EditPlan = {
  version: 1;
  source: { video: string; durationSec: number; hasAudio?: boolean };
  sources: Record<string, EditSource>;
  cuts: EditCut[];
  texts: EditText[];
  scenes: EditScene[];
  zooms: EditZoom[];
  chapters: unknown[];
};
export type Pause = { from: number; to: number; durationSec: number };
export type EpisodeEdit = {
  plan: EditPlan;
  // The original upload: the plan's times are its times.
  videoUrl: string | null;
  posterUrl: string | null;
  durationSec: number;
  // Why the video can't be edited now (say, it's live), or null.
  locked: string | null;
  // changed: saved changes the episode's video doesn't have yet;
  // processing: the edited video is made and processing at the video service.
  edit: { status: EditStatus; error: string | null; changed: boolean; processing: boolean };
  transcript: {
    status: string;
    lines: { startSec: number; endSec: number; text: string; speaker: number | null }[];
    // [text, start, end], when the speech-to-text service made the transcript.
    words: [string, number, number][] | null;
    speakers: Record<string, string>;
  };
  pauses: Pause[] | null;
  // Other recordings (like the screen share), to play beside the original.
  sources: Record<string, { videoId: string; url: string | null; offsetSec: number; durationSec: number }>;
};
export type Activity = { blank: { from: number; to: number }[]; changes: number[] };

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
    createUpload: (kind: 'episode' | 'short' | 'screen') => call<{ videoId: string; uploadUrl: string }>('POST', '/uploads', { kind }),
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
        reviewNote: string | null;
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
    shortCaptions: (id: string) => call<Captions>('GET', `/shorts/${id}/captions`),
    saveShortCaptions: (id: string, cues: Cue[]) => call<Captions>('PUT', `/shorts/${id}/captions`, { cues }),
    reach: (id: string) => call<Reach>('GET', `/episodes/${id}/reach`),
    episodeEdit: (id: string) => call<EpisodeEdit>('GET', `/episodes/${id}/edit`),
    saveEpisodeEdit: (id: string, plan: EditPlan) => call<{ plan: EditPlan; warnings: string[] }>('PUT', `/episodes/${id}/edit`, { plan }),
    makeEpisodeEdit: (id: string) => call<{ status: EditStatus }>('POST', `/episodes/${id}/edit/make`),
    episodePauses: (id: string) => call<Pause[]>('GET', `/episodes/${id}/edit/pauses`),
    setEditSource: (id: string, name: string, body: { videoId: string; offsetSec: number }) => call<{ plan: EditPlan }>('PUT', `/episodes/${id}/edit/sources/${name}`, body),
    removeEditSource: (id: string, name: string) => call<{ plan: EditPlan }>('DELETE', `/episodes/${id}/edit/sources/${name}`),
    sourceActivity: (id: string, name: string) => call<Activity>('GET', `/episodes/${id}/edit/sources/${name}/activity`),
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
  if (v.edit?.status === 'queued' || v.edit?.status === 'rendering') return needsAudio ? 'Making the edited video…' : 'Adding pictures…';
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
