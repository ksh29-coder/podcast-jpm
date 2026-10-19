const jpeg = require('jpeg-js');

// The app tints each episode's screens with a color taken from its artwork
// (the "Studio" look). This picks that color from a tiny copy of the image:
// the average of its most colorful pixels, then darkened so white text on it
// stays readable.

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// JPEG bytes -> "#rrggbb", or null if it can't be read.
function tintFromJpeg(buffer) {
  let img;
  try {
    img = jpeg.decode(buffer, { useTArray: true, maxResolutionInMP: 2 });
  } catch {
    return null;
  }
  const px = [];
  for (let i = 0; i < img.data.length; i += 4) {
    const [h, s, l] = rgbToHsl(img.data[i], img.data[i + 1], img.data[i + 2]);
    // Skip near-black and near-white pixels; they say nothing about the art's color.
    if (l > 0.08 && l < 0.92) px.push({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2], s, h });
  }
  if (!px.length) return null;
  // Average the most saturated third so the color isn't washed out to grey.
  px.sort((a, b) => b.s - a.s);
  const top = px.slice(0, Math.max(1, Math.ceil(px.length / 3)));
  const avg = ['r', 'g', 'b'].map((k) => top.reduce((sum, p) => sum + p[k], 0) / top.length);
  const [h, s] = rgbToHsl(...avg);
  // Dark, moderately saturated: a backdrop, not a highlight.
  return hslToHex(h, Math.min(0.65, Math.max(0.25, s)), 0.3);
}

async function tintFromUrl(url, { timeoutMs = 4000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return tintFromJpeg(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { tintFromJpeg, tintFromUrl };
