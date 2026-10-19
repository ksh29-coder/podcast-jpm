// eslint-disable-next-line import/no-named-as-default -- hls.js only has a default export in its types.
import Hls from 'hls.js';

// Plays an HLS (.m3u8) stream in a <video> element. Safari plays HLS itself;
// Chrome and Firefox need hls.js. Returns a cleanup function.
export function attachHls(video: HTMLVideoElement, src: string) {
  if (!src.includes('.m3u8') || video.canPlayType('application/vnd.apple.mpegurl') || typeof window.MediaSource === 'undefined') {
    video.src = src;
    return () => video.removeAttribute('src');
  }
  const hls = new Hls();
  hls.loadSource(src);
  hls.attachMedia(video);
  return () => hls.destroy();
}
