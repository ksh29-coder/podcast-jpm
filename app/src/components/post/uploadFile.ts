import { File } from 'expo-file-system';

// Sends a picked or recorded video straight to the video service's upload
// URL (the file never passes through our backend). The web version is
// uploadFile.web.ts.
export async function uploadFile(
  picked: { uri: string },
  url: string,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (percent: number) => void }
) {
  // A Short is small enough to send in one request.
  const task = new File(picked.uri).createUploadTask(url, {
    httpMethod: 'PUT',
    signal,
    onProgress: ({ bytesSent, totalBytes }) => totalBytes > 0 && onProgress(Math.round((bytesSent / totalBytes) * 100)),
  });
  const res = await task.uploadAsync();
  if (res.status >= 300) throw new Error(`Upload failed (${res.status})`);
}
