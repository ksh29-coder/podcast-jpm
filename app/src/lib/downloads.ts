import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { Episode } from './api';

// Downloads live in the app's own document sandbox, one audio file per episode.
export const downloadsSupported = Platform.OS !== 'web';

function downloadsDir() {
  return new Directory(Paths.document, 'downloads');
}

// Seeded episodes have MP3 audio, uploaded ones M4A. The extension has to
// match, or iOS may refuse to play the file.
const EXTENSIONS = ['mp3', 'm4a'];

function audioFile(episodeId: string, ext: string) {
  return new File(downloadsDir(), `${episodeId}.${ext}`);
}

function existingAudioFile(episodeId: string) {
  return EXTENSIONS.map((ext) => audioFile(episodeId, ext)).find((f) => f.exists) ?? null;
}

export function localAudioUri(episodeId: string): string | null {
  if (!downloadsSupported) return null;
  return existingAudioFile(episodeId)?.uri ?? null;
}

export function downloadedSize(episodeId: string): number | null {
  if (!downloadsSupported) return null;
  return existingAudioFile(episodeId)?.size ?? null;
}

export async function downloadEpisode(episode: Episode): Promise<void> {
  if (!episode.audioUrl) throw new Error('This episode is video-only, so there is no audio to download.');
  const dir = downloadsDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const ext = new URL(episode.audioUrl).pathname.split('.').pop()?.toLowerCase();
  await File.downloadFileAsync(episode.audioUrl, audioFile(episode.id, ext && EXTENSIONS.includes(ext) ? ext : 'mp3'), { idempotent: true });
}

export function deleteDownload(episodeId: string): void {
  existingAudioFile(episodeId)?.delete();
}
