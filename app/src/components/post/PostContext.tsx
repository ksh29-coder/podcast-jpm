import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { Redirect } from 'expo-router';
import { api, type PlacedPicture, type PostKind } from '../../lib/api';
import { uploadFile } from './uploadFile';

// The Short or episode being posted, shared by the posting screens (camera or
// file choice, trim, pictures for a Short, details). The upload starts when the person leaves the
// trim screen and carries on in the background while they fill in the details.
// Episodes are posted from the website only and are never trimmed.

// `file` is the browser's File on the web; the phone uses `uri`.
export type Picked = { uri: string; durationSec: number | null; kind?: PostKind; file?: Blob };
export type Upload = { videoId: string | null; percent: number; done: boolean; error: string | null };
// The part of the chosen video that's kept.
export type Kept = { startSec: number; durationSec: number };

type PostValue = {
  picked: Picked | null;
  setPicked: (p: Picked | null) => void;
  upload: Upload | null;
  // range: the part to keep, when not the whole video. `video` uploads that
  // instead of `picked` (when it's only just been chosen).
  startUpload: (range?: { startSec: number; endSec: number }, video?: Picked) => void;
  // Tries again with the same range after a failure.
  retryUpload: () => void;
  kept: Kept | null;
  setKept: (k: Kept) => void;
  // Pictures added to a Short, sent with it when it's posted.
  pictures: PlacedPicture[];
  setPictures: (p: PlacedPicture[]) => void;
  // Stops any upload and forgets the video (after posting or discarding).
  reset: () => void;
};

const PostContext = createContext<PostValue | null>(null);

export function usePost() {
  const value = useContext(PostContext);
  if (!value) throw new Error('usePost must be used inside <PostProvider>');
  return value;
}

// For the trim and details screens when there's no video (e.g. the page was
// reloaded): back to the start. It waits a moment first, since the video is
// chosen and the screen opened in the same instant.
export function NoVideo() {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 500);
    return () => clearTimeout(t);
  }, []);
  return waited ? <Redirect href={Platform.OS === 'web' ? '/create' : '/post'} /> : null;
}

export function PostProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [kept, setKept] = useState<Kept | null>(null);
  const [pictures, setPictures] = useState<PlacedPicture[]>([]);
  const abort = useRef<AbortController | null>(null);
  const last = useRef<{ range?: { startSec: number; endSec: number }; video?: Picked }>({});

  const startUpload = (range?: { startSec: number; endSec: number }, video: Picked | null = picked) => {
    if (!video) return;
    last.current = { range, video };
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setUpload({ videoId: null, percent: 0, done: false, error: null });
    (async () => {
      try {
        const { videoId, uploadUrl } = await api.createUpload(video.kind ?? 'short', range);
        setUpload((u) => u && { ...u, videoId });
        await uploadFile(video, uploadUrl, { signal: controller.signal, onProgress: (percent) => setUpload((u) => u && { ...u, percent }) });
        setUpload((u) => u && { ...u, percent: 100, done: true });
      } catch (e) {
        if (controller.signal.aborted) return;
        setUpload((u) => ({ videoId: u?.videoId ?? null, percent: 0, done: false, error: e instanceof Error ? e.message : String(e) }));
      }
    })();
  };

  const reset = () => {
    abort.current?.abort();
    abort.current = null;
    setPicked(null);
    setUpload(null);
    setKept(null);
    setPictures([]);
  };

  return (
    <PostContext.Provider
      value={{ picked, setPicked, upload, startUpload, retryUpload: () => startUpload(last.current.range, last.current.video), kept, setKept, pictures, setPictures, reset }}
    >
      {children}
    </PostContext.Provider>
  );
}
