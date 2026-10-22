import { File } from 'expo-file-system';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';

// The Short being posted from the ＋ tab, shared by its screens (camera,
// trim, details). The upload starts when the person leaves the trim screen
// and carries on in the background while they fill in the details.

export type Picked = { uri: string; durationSec: number | null };
export type Upload = { videoId: string | null; percent: number; done: boolean; error: string | null };

type PostValue = {
  picked: Picked | null;
  setPicked: (p: Picked | null) => void;
  upload: Upload | null;
  // range: the part to keep, when not the whole video.
  startUpload: (range?: { startSec: number; endSec: number }) => void;
  // Tries again with the same range after a failure.
  retryUpload: () => void;
};

const PostContext = createContext<PostValue | null>(null);

export function usePost() {
  const value = useContext(PostContext);
  if (!value) throw new Error('usePost must be used inside <PostProvider>');
  return value;
}

export function PostProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const abort = useRef<AbortController | null>(null);
  const lastRange = useRef<{ startSec: number; endSec: number } | undefined>(undefined);

  // Closing the ＋ screens stops an unfinished upload.
  useEffect(() => () => abort.current?.abort(), []);

  const startUpload = (range?: { startSec: number; endSec: number }) => {
    if (!picked) return;
    lastRange.current = range;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setUpload({ videoId: null, percent: 0, done: false, error: null });
    (async () => {
      try {
        const { videoId, uploadUrl } = await api.createUpload(range);
        setUpload((u) => u && { ...u, videoId });
        // A Short is small enough to send in one request, straight to the video service.
        const task = new File(picked.uri).createUploadTask(uploadUrl, {
          httpMethod: 'PUT',
          signal: controller.signal,
          onProgress: ({ bytesSent, totalBytes }) =>
            totalBytes > 0 && setUpload((u) => u && { ...u, percent: Math.round((bytesSent / totalBytes) * 100) }),
        });
        const res = await task.uploadAsync();
        if (res.status >= 300) throw new Error(`Upload failed (${res.status})`);
        setUpload((u) => u && { ...u, percent: 100, done: true });
      } catch (e) {
        if (controller.signal.aborted) return;
        setUpload((u) => ({ videoId: u?.videoId ?? null, percent: 0, done: false, error: e instanceof Error ? e.message : String(e) }));
      }
    })();
  };

  return <PostContext.Provider value={{ picked, setPicked, upload, startUpload, retryUpload: () => startUpload(lastRange.current) }}>{children}</PostContext.Provider>;
}
