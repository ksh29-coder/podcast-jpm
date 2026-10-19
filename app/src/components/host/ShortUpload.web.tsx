import { NotOnThisPlatform } from './NotOnThisPlatform';

// Shorts filmed on a phone are uploaded from the phone app (ShortUpload.tsx).
export function ShortUpload() {
  return <NotOnThisPlatform message="Shorts filmed on a phone are uploaded from the phone app." />;
}
