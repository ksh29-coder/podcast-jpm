import { getDeviceId } from './device';

// Backend base URL. Set EXPO_PUBLIC_API_URL (e.g. in .env.local) to point at a
// deployed backend; a phone can't reach "localhost" on your computer.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export type Chapter = { title: string; startSec: number };

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
  clips: Clip[];
} & Stats;

export type Short = Clip & Stats & { episodeId: string | null; episodeTitle: string | null; artworkUrl: string | null };

export type Comment = {
  id: string;
  authorName: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  mine?: boolean;
};

export type Cue = { startSec: number; endSec: number; text: string };
// 'generating' while captions are made (a few minutes after publishing);
// 'unavailable' for videos without sound.
export type Transcript = { status: 'none' | 'generating' | 'ready' | 'unavailable'; cues: Cue[] };

// A transcript line that matched a search, linked to the moment it's said.
export type Moment = { episodeId: string; episodeTitle: string; startSec: number; text: string };
export type SearchResults = { episodes: Episode[]; shorts: Short[]; moments: Moment[] };

export type Progress = Record<string, { positionSec: number; updatedAt: string }>;

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
  progress: () => request<Progress>('/api/progress'),
  setLiked: (type: ItemType, id: string, liked: boolean) =>
    request<Stats>(`/api/items/${type}/${id}/like`, { method: liked ? 'PUT' : 'DELETE' }),
  view: (type: ItemType, id: string) => request<void>(`/api/items/${type}/${id}/view`, { method: 'POST' }),
  comments: (type: ItemType, id: string) => request<Comment[]>(`/api/items/${type}/${id}/comments`),
  postComment: (type: ItemType, id: string, name: string, body: string) =>
    request<Comment>(`/api/items/${type}/${id}/comments`, { method: 'POST', body: JSON.stringify({ name, body }) }),
  saveProgress: (episodeId: string, positionSec: number) =>
    request(`/api/progress/${episodeId}`, {
      method: 'PUT',
      body: JSON.stringify({ positionSec }),
    }),
};
