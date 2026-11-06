import { router } from 'expo-router';
import { noteSource, type Source } from './listening';

// Opens an episode's page, noting where it was opened from for hosts' stats
// (listening.ts).
export function openEpisode(source: Source, path: `/episode/${string}`) {
  noteSource(source);
  router.push(path);
}
