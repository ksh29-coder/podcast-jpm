import { NotOnThisPlatform } from './NotOnThisPlatform';

// Long episodes are uploaded on the host website (EpisodeUpload.web.tsx).
export function EpisodeUpload() {
  return <NotOnThisPlatform message="Long episodes are uploaded on the host website, not from the phone." />;
}
