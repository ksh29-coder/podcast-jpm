export function formatTime(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatDuration(totalSec: number): string {
  const min = Math.round(totalSec / 60);
  return min >= 60 ? `${Math.floor(min / 60)} hr ${min % 60} min` : `${min} min`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// "now", "5m", "3h", "2d", then the date: how long ago, in a short list.
export function formatAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h`;
  if (min < 7 * 24 * 60) return `${Math.floor(min / (24 * 60))}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// "1:02:03", "2:05" or "75" to seconds; null if it isn't a time.
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

// Chapters typed one per line, "0:00 Intro". Returns the bad lines too, so the
// form can point at them.
export function parseChapters(text: string) {
  const chapters: { title: string; startSec: number }[] = [];
  const bad: string[] = [];
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(\S+)\s+(.+)$/);
    const startSec = m ? parseTime(m[1]) : null;
    if (m && startSec !== null) chapters.push({ title: m[2].trim(), startSec });
    else bad.push(line);
  }
  return { chapters: chapters.sort((a, b) => a.startSec - b.startSec), bad };
}
