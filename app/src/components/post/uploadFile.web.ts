import * as UpChunk from '@mux/upchunk';

// In the browser: the chosen file, in chunks, so a long episode can resume
// after a network blip.
export function uploadFile(
  picked: { file?: Blob },
  url: string,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (percent: number) => void }
) {
  if (!picked.file) return Promise.reject(new Error('No file to upload'));
  const file = picked.file instanceof File ? picked.file : new File([picked.file], 'video.mp4', { type: picked.file.type || 'video/mp4' });
  return new Promise<void>((resolve, reject) => {
    const up = UpChunk.createUpload({ endpoint: url, file, chunkSize: 30720 });
    signal.addEventListener('abort', () => up.abort());
    up.on('progress', (e) => onProgress(Math.round(e.detail)));
    up.on('success', () => resolve());
    up.on('error', (e) => reject(new Error(e.detail?.message || 'Upload failed')));
  });
}
