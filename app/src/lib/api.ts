// Backend base URL. Set EXPO_PUBLIC_API_URL (e.g. in .env.local) to point at a
// deployed backend; a phone can't reach "localhost" on your computer.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export type Chapter = { title: string; startSec: number };

export type Clip = {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
  videoUrl: string;
};

export type Episode = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSec: number;
  artworkUrl: string;
  audioUrl: string;
  videoUrl: string;
  chapters: Chapter[];
  clips: Clip[];
};

export type Short = Clip & { episodeId: string; episodeTitle: string; artworkUrl: string };

export type Progress = Record<string, { positionSec: number; updatedAt: string }>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  episodes: () => request<Episode[]>('/api/episodes'),
  episode: (id: string) => request<Episode>(`/api/episodes/${id}`),
  shorts: () => request<Short[]>('/api/shorts'),
  progress: () => request<Progress>('/api/progress'),
  saveProgress: (episodeId: string, positionSec: number) =>
    request(`/api/progress/${episodeId}`, {
      method: 'PUT',
      body: JSON.stringify({ positionSec }),
    }),
};
