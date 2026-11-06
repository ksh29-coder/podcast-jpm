import { NotOnThisPlatform } from './NotOnThisPlatform';

// Editing an episode's video happens on the host website (VideoEditor.web.tsx).
export function VideoEditor(_: { episodeId: string }) {
  return <NotOnThisPlatform message="Episode videos are edited on the host website." />;
}
