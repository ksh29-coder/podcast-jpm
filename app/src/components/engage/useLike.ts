import { useState } from 'react';
import { api, type ItemType, type Stats } from '../../lib/api';

// Like/unlike with the heart flipping straight away; the count is corrected
// from the server's answer, or put back if the request fails.
export function useLike(type: ItemType, id: string, initial: Pick<Stats, 'liked' | 'likes'>) {
  const [state, setState] = useState({ liked: initial.liked, likes: initial.likes });
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const before = state;
    const liked = !state.liked;
    setState({ liked, likes: Math.max(0, state.likes + (liked ? 1 : -1)) });
    setBusy(true);
    try {
      const s = await api.setLiked(type, id, liked);
      setState({ liked: s.liked, likes: s.likes });
    } catch {
      setState(before);
    } finally {
      setBusy(false);
    }
  };

  return { ...state, toggle };
}
