import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { Episode } from './api';

// Downloads live in the app's own document sandbox, one audio file per episode.
export const downloadsSupported = Platform.OS !== 'web';

function downloadsDir() {
  return new Directory(Paths.document, 'downloads');
}

function audioFile(episodeId: string) {
  return new File(downloadsDir(), `${episodeId}.mp3`);
}

export function localAudioUri(episodeId: string): string | null {
  if (!downloadsSupported) return null;
  const file = audioFile(episodeId);
  return file.exists ? file.uri : null;
}

export function downloadedSize(episodeId: string): number | null {
  if (!downloadsSupported) return null;
  const file = audioFile(episodeId);
  return file.exists ? file.size : null;
}

export async function downloadEpisode(episode: Episode): Promise<void> {
  const dir = downloadsDir();
  if (!dir.exists) dir.create({ intermediates: true });
  await File.downloadFileAsync(episode.audioUrl, audioFile(episode.id), { idempotent: true });
}

export function deleteDownload(episodeId: string): void {
  const file = audioFile(episodeId);
  if (file.exists) file.delete();
}
