// eslint-disable-next-line import/no-named-as-default -- hls.js only has a default export in its types.
import Hls from 'hls.js';

// Plays an HLS (.m3u8) stream in a <video> element. hls.js runs wherever the
// browser has Media Source Extensions (desktop Chrome, Firefox, Safari);
// iPhone Safari has none, but plays HLS by itself. Some Chrome versions answer
// "maybe" to the native HLS check without actually playing it, so hls.js goes
// first. Returns a cleanup function.
export function attachHls(video: HTMLVideoElement, src: string) {
  const mse = typeof window.MediaSource !== 'undefined' || 'ManagedMediaSource' in window;
  if (!src.includes('.m3u8') || !mse) {
    video.src = src;
    return () => video.removeAttribute('src');
  }
  const hls = new Hls();
  hls.loadSource(src);
  hls.attachMedia(video);
  return () => hls.destroy();
}
