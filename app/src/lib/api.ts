import { getDeviceId } from './device';

// Backend base URL. Set EXPO_PUBLIC_API_URL (e.g. in .env.local) to point at a
// deployed backend; a phone can't reach "localhost" on your computer.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export type Chapter = { title: string; startSec: number };

// Something named in an episode (a tool, person, paper...), at the moment it's said.
export type Mention = { startSec: number; name: string; kind: string; url: string | null };

// What viewers did with an episode or Short. `liked` is this device's like.
export type Stats = { likes: number; liked: boolean; views: number; comments: number };
export type ItemType = 'episode' | 'short';

export type Clip = {
  id: string;
  title: string;
  // Where the clip sits in its episode; null for Shorts uploaded on their own.
  startSec: number | null;
  endSec: number | null;
  videoUrl: string;
  // Horizontal point (0 left, 1 right) to keep in view when a wide video fills
  // the vertical Shorts feed.
  focusX: number;
  aspectRatio: string | null;
  tags: string[];
};

export type Episode = {
  id: string;
  title: string;
  description: string;
  // Who posted it (key: an anonymous id for hiding their posts); null for
  // episodes made by hosts.
  author: { name: string; key: string } | null;
  publishedAt: string;
  durationSec: number;
  artworkUrl: string;
  // null when the episode is video-only (its video has no sound).
  audioUrl: string | null;
  videoUrl: string;
  chapters: Chapter[];
  tags: string[];
  // Dark backdrop color taken from the artwork; null until the server has worked it out.
  tint: string | null;
  // Shown once a host approves them (often from AI suggestions).
  summary: string | null;
  mentions: Mention[];
  clips: Clip[];
} & Stats;

export type Short = Clip &
  Stats & {
    episodeId: string | null;
    episodeTitle: string | null;
    artworkUrl: string | null;
    description: string;
    // Who posted it (key: an anonymous id for hiding their posts); null for
    // Shorts made by hosts.
    author: { name: string; key: string } | null;
  };

// ---- Posting Shorts (anyone) ----

export type Profile = { name: string | null; acceptedGuidelines: boolean; maxShortSec: number };

// 'generating' while the AI reads what's said; 'unavailable' when there's
// nothing to read (no speech) or the AI couldn't help.
export type Suggestions = {
  status: 'none' | 'generating' | 'ready' | 'unavailable';
  title: string | null;
  description: string | null;
  tags: string[];
  coverSec: number | null;
};

export type UploadState = {
  status: 'uploading' | 'processing' | 'ready' | 'errored';
  error: string | null;
  durationSec: number | null;
  suggestions: Suggestions;
  // Frames to pick the cover from, once the video is ready.
  frames: { sec: number; url: string }[];
};

export type ShortStatus = 'draft' | 'in_review' | 'published' | 'rejected';
export type PostKind = 'short' | 'episode';

// One of this person's own Shorts, with where it is in review.
export type MyShort = Short & {
  status: ShortStatus;
  // Why a host didn't approve it, if they said.
  reviewNote: string | null;
  coverSec: number | null;
  video: { id: string; status: 'uploading' | 'processing' | 'ready' | 'errored'; error: string | null } | null;
  createdAt: string;
  publishedAt: string | null;
};

export type ShortDetails = { title: string; description: string; tags: string[]; coverSec?: number };

// One of this person's own episodes (posted from the website).
export type MyEpisode = Episode & {
  status: ShortStatus;
  reviewNote: string | null;
  video: { id: string; status: 'uploading' | 'processing' | 'ready' | 'errored'; error: string | null } | null;
  createdAt: string;
};

export type Comment = {
  id: string;
  authorName: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  mine?: boolean;
  // Moment in the episode it's about, if any.
  atSec?: number | null;
  // Anonymous key for blocking this author on this device.
  authorKey?: string;
};

// speaker: 0, 1, 2… from speaker detection (null if unknown).
export type Cue = { startSec: number; endSec: number; text: string; speaker?: number | null };
// 'generating' while captions are made (a few minutes after publishing);
// 'unavailable' for videos without sound.
export type Transcript = {
  status: 'none' | 'generating' | 'ready' | 'unavailable';
  cues: Cue[];
  // Names a host gave the speakers, e.g. { "0": "Kai" }.
  speakers?: Record<string, string>;
  source?: string | null;
};

// A Short's caption lines, in the Short's own time. source: 'edited' once a
// person fixed them, 'episode' when taken from the episode it was cut from.
export type Captions = { status: Transcript['status']; source: string | null; cues: Cue[] };
export type CaptionHints = { title?: string; description?: string; tags?: string[] };

// A transcript line that matched a search, linked to the moment it's said.
export type Moment = { episodeId: string; episodeTitle: string; startSec: number; text: string };
export type SearchResults = { episodes: Episode[]; shorts: Short[]; moments: Moment[] };

export type Progress = Record<string, { positionSec: number; updatedAt: string }>;

export type AssistantSession = { token: string; connectUrl: string; expiresAt: number | null; maxSec: number; leftTodaySec: number };

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': await getDeviceId(), ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    // The backend sends { error } with a readable reason; fall back to the status.
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error || `${init?.method || 'GET'} ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export const api = {
  episodes: () => request<Episode[]>('/api/episodes'),
  episode: (id: string) => request<Episode>(`/api/episodes/${id}`),
  shorts: () => request<Short[]>('/api/shorts'),
  transcript: (episodeId: string) => request<Transcript>(`/api/episodes/${episodeId}/transcript`),
  search: (q: string) => request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
  shortCaptions: (id: string) => request<Captions>(`/api/shorts/${id}/captions`),
  progress: () => request<Progress>('/api/progress'),
  setLiked: (type: ItemType, id: string, liked: boolean) =>
    request<Stats>(`/api/items/${type}/${id}/like`, { method: liked ? 'PUT' : 'DELETE' }),
  view: (type: ItemType, id: string) => request<void>(`/api/items/${type}/${id}/view`, { method: 'POST' }),
  comments: (type: ItemType, id: string) => request<Comment[]>(`/api/items/${type}/${id}/comments`),
  postComment: (type: ItemType, id: string, name: string, body: string, atSec?: number) =>
    request<Comment>(`/api/items/${type}/${id}/comments`, { method: 'POST', body: JSON.stringify({ name, body, atSec }) }),
  // Report an episode or Short (one posted from the app or website is hidden until a host looks).
  reportItem: (type: ItemType, id: string, reason: string) =>
    request<void>(`/api/items/${type}/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reportComment: (type: ItemType, id: string, commentId: string, reason: string) =>
    request<void>(`/api/items/${type}/${id}/comments/${commentId}/report`, { method: 'POST', body: JSON.stringify({ reason }) }),
  me: () => request<Profile>('/api/me'),
  saveMe: (name: string, acceptGuidelines?: boolean) => request<Profile>('/api/me', { method: 'PUT', body: JSON.stringify({ name, acceptGuidelines }) }),
  // range: the part of a Short's video to keep, when not all of it.
  createUpload: (kind: PostKind, range?: { startSec: number; endSec: number }) =>
    request<{ videoId: string; uploadUrl: string }>('/api/me/uploads', { method: 'POST', body: JSON.stringify({ kind, ...range }) }),
  upload: (videoId: string) => request<UploadState>(`/api/me/uploads/${videoId}`),
  discardUpload: (videoId: string) => request<void>(`/api/me/uploads/${videoId}`, { method: 'DELETE' }),
  myShorts: () => request<MyShort[]>('/api/me/shorts'),
  postShort: (videoId: string, details: ShortDetails) =>
    request<MyShort>('/api/me/shorts', { method: 'POST', body: JSON.stringify({ videoId, ...details }) }),
  updateMyShort: (id: string, details: Partial<ShortDetails>) => request<MyShort>(`/api/me/shorts/${id}`, { method: 'PATCH', body: JSON.stringify(details) }),
  deleteMyShort: (id: string) => request<void>(`/api/me/shorts/${id}`, { method: 'DELETE' }),
  // Captions to check before posting (by upload), or while in review (by Short).
  uploadCaptions: (videoId: string) => request<Captions>(`/api/me/uploads/${videoId}/captions`),
  saveUploadCaptions: (videoId: string, cues: Cue[]) =>
    request<Captions>(`/api/me/uploads/${videoId}/captions`, { method: 'PUT', body: JSON.stringify({ cues }) }),
  myShortCaptions: (id: string) => request<Captions>(`/api/me/shorts/${id}/captions`),
  saveMyShortCaptions: (id: string, cues: Cue[]) => request<Captions>(`/api/me/shorts/${id}/captions`, { method: 'PUT', body: JSON.stringify({ cues }) }),
  // The AI's fixes for misheard words; nothing is saved.
  tidyCaptions: (cues: Cue[], hints: CaptionHints) =>
    request<{ cues: Cue[] }>('/api/me/captions/tidy', { method: 'POST', body: JSON.stringify({ cues, ...hints }) }),
  myEpisodes: () => request<MyEpisode[]>('/api/me/episodes'),
  postEpisode: (videoId: string, details: ShortDetails) =>
    request<MyEpisode>('/api/me/episodes', { method: 'POST', body: JSON.stringify({ videoId, ...details }) }),
  updateMyEpisode: (id: string, details: Partial<ShortDetails>) =>
    request<MyEpisode>(`/api/me/episodes/${id}`, { method: 'PATCH', body: JSON.stringify(details) }),
  deleteMyEpisode: (id: string) => request<void>(`/api/me/episodes/${id}`, { method: 'DELETE' }),
  // The voice assistant: a short-lived key for one conversation, how long it
  // lasted, and its tools (run on our server).
  assistantSession: (voice?: string) => request<AssistantSession>('/api/assistant/session', { method: 'POST', body: JSON.stringify({ voice }) }),
  assistantUsage: (seconds: number) => request<{ leftTodaySec: number }>('/api/assistant/usage', { method: 'POST', body: JSON.stringify({ seconds }) }),
  assistantTool: (name: string, args: unknown) => request<unknown>(`/api/assistant/tools/${name}`, { method: 'POST', body: JSON.stringify(args ?? {}) }),
  saveProgress: (episodeId: string, positionSec: number) =>
    request(`/api/progress/${episodeId}`, {
      method: 'PUT',
      body: JSON.stringify({ positionSec }),
    }),
};
