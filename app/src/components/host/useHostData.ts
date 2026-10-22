import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { videoLabel, type HostComment, type HostEpisode, type HostShort, type Status } from '../../lib/host';
import { useHost } from './HostGate';

// Everything host screens show: episodes, Shorts and the comment queue, kept
// fresh when the screen comes back into view and while videos process, plus
// the actions on them.
export function useHostData() {
  const { api } = useHost();
  const [episodes, setEpisodes] = useState<HostEpisode[] | null>(null);
  const [shorts, setShorts] = useState<HostShort[] | null>(null);
  const [comments, setComments] = useState<HostComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [eps, shs, cms] = await Promise.all([api.episodes(), api.shorts(), api.comments()]);
      setEpisodes(eps);
      setShorts(shs);
      setComments(cms);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  // Reload whenever the screen comes back into view, e.g. after a review.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Keep checking while anything is still uploading or processing.
  const stillWorking = (v: HostEpisode['video'], needsAudio: boolean) => !!v && v.status !== 'errored' && !!videoLabel(v, { needsAudio });
  const pending = !!episodes?.some((e) => stillWorking(e.video, true)) || !!shorts?.some((s) => stillWorking(s.video, false));
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [pending, load]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return {
    episodes,
    shorts,
    comments,
    error,
    busyId,
    load,
    // Posted from the app or website and waiting for a host, or reported by viewers.
    toReview: [...(shorts ?? []), ...(episodes ?? [])]
      .filter((x) => (x.author && x.status === 'in_review') || (x.reports?.length && x.status === 'published'))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    setStatus: (kind: 'episode' | 'short', id: string, status: Status) =>
      run(id, () => (kind === 'episode' ? api.updateEpisode(id, { status }) : api.updateShort(id, { status }))),
    reviewComment: (id: string, status: 'approved' | 'rejected') => run(id, () => api.setCommentStatus(id, status)),
  };
}

export type ReviewItem = ReturnType<typeof useHostData>['toReview'][number];
