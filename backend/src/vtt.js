// Minimal WebVTT reader: cues -> [{ startSec, endSec, text }].
// Enough for generated captions (no styling, regions or nested tags needed).

function toSec(stamp) {
  const parts = stamp.trim().split(':').map(Number);
  return parts.reduce((total, p) => total * 60 + p, 0);
}

function parseVtt(vtt) {
  const cues = [];
  for (const block of vtt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i === -1) continue;
    const [start, rest] = lines[i].split('-->');
    const end = rest.trim().split(/\s+/)[0];
    const text = lines
      .slice(i + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (text) cues.push({ startSec: toSec(start), endSec: toSec(end), text });
  }
  return cues;
}

module.exports = { parseVtt };
