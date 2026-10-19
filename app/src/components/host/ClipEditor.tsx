import { NotOnThisPlatform } from './NotOnThisPlatform';

// Cutting Shorts from episodes happens on the host website (ClipEditor.web.tsx).
export function ClipEditor(_: { episodeId: string }) {
  return <NotOnThisPlatform message="Shorts are cut from episodes on the host website." />;
}
