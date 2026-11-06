const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { TEXT_STYLES, PlanError, timeline, toOutputTime, keptSegments, validate } = require('./plan');

const run = promisify(execFile);

// Turns an edit plan into a video (or one frame of it) with ffmpeg.
// Text is drawn by libass from a generated .ass file, in the Inter font kept
// in assets/fonts, so it looks the same on every machine.

const FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const FONT = 'Inter';

// Full quality is made at most 1920 pixels; --low (quick checks) at most 640.
const QUALITY = {
  full: { maxPx: 1920, preset: process.env.EDIT_PRESET || 'veryfast', crf: '21' },
  low: { maxPx: 640, preset: 'ultrafast', crf: '30' },
};

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
function outputSize({ width, height }, maxPx) {
  const scale = Math.min(1, maxPx / Math.max(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

// "H:MM:SS.cc", the time format of .ass files.
function assTime(sec) {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// Plain text as .ass text. A backslash gets a zero-width space after it so
// it can't start an escape like \N; braces (which would start style codes)
// are escaped as libass allows; line breaks become \N.
const assText = (s) =>
  String(s)
    .replace(/\\/g, '\\​')
    .replace(/[{}]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, '\\N');

// .ass colours are &HAABBGGRR, where AA 00 is solid.
const WHITE = '&H00FFFFFF';
const BOX = '&H40101010';

// The .ass file that draws the plan's texts on a width x height video, at the
// edited video's times.
function buildAss(texts, { width, height }) {
  const styles = Object.entries(TEXT_STYLES).map(([name, s]) => {
    const size = Math.round(s.size * height);
    const pad = Math.max(2, Math.round(size * 0.2));
    // BorderStyle 3: a box behind the text, of the outline's colour and size.
    return `Style: ${name},${FONT},${size},${WHITE},${WHITE},${BOX},${BOX},-1,0,0,0,100,100,0,0,${s.box ? 3 : 1},${pad},0,${s.align},20,20,20,1`;
  });
  const events = texts.map((t) => {
    const s = TEXT_STYLES[t.style];
    const x = Math.round((t.x ?? s.x) * width);
    const y = Math.round((t.y ?? s.y) * height);
    let body = assText(t.text);
    if (t.subtitle) body += `\\N{\\b0\\fs${Math.round((s.subtitleSize || s.size) * height)}}${assText(t.subtitle)}`;
    return `Dialogue: 0,${assTime(t.outFrom)},${assTime(t.outTo)},${t.style},,0,0,0,,{\\an${s.align}\\pos(${x},${y})}${body}`;
  });
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

// Chapters in ffmpeg's metadata format, so players show them.
function buildChapterMetadata(chapters, durationSec) {
  const esc = (s) => String(s).replace(/[=;#\\\n]/g, (c) => `\\${c}`);
  const lines = [';FFMETADATA1'];
  chapters.forEach((c, i) => {
    const end = i + 1 < chapters.length ? chapters[i + 1].outAt : durationSec;
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.outAt * 1000)}`, `END=${Math.round(end * 1000)}`, `title=${esc(c.title)}`);
  });
  return `${lines.join('\n')}\n`;
}

// The filter graph that keeps the plan's segments of input 0, joins them and
// draws the texts. Ends in [v] (and [a] when there is sound).
function buildFilter({ segments, size, hasAudio }) {
  const n = segments.length;
  const parts = [`[0:v]split=${n}${segments.map((_, i) => `[vi${i}]`).join('')}`];
  if (hasAudio) parts.push(`[0:a]asplit=${n}${segments.map((_, i) => `[ai${i}]`).join('')}`);
  segments.forEach((s, i) => {
    parts.push(`[vi${i}]trim=start=${s.from}:end=${s.to},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) parts.push(`[ai${i}]atrim=start=${s.from}:end=${s.to},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const ins = segments.map((_, i) => (hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
  parts.push(`${ins}concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}[vc]${hasAudio ? '[a]' : ''}`);
  parts.push(`[vc]scale=${size.width}:${size.height},setsar=1,ass=texts.ass:fontsdir=fonts,format=yuv420p[v]`);
  return parts.join(';');
}

function ffmpegEngine({ ffmpeg = require('ffmpeg-static') } = {}) {
  const ff = (args, opts = {}) => run(ffmpeg, ['-hide_banner', ...args], { maxBuffer: 64 << 20, ...opts });

  // A temporary folder with the fonts in it; ffmpeg runs inside it so the
  // filter graph can name files without any path escaping.
  async function inTemp(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wave-edit-'));
    try {
      await fs.cp(FONTS_DIR, path.join(dir, 'fonts'), { recursive: true });
      return await fn(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  function checked(plan) {
    const result = validate(plan);
    if (!result.ok) throw new PlanError(`The plan has problems:\n- ${result.errors.join('\n- ')}`);
    return result;
  }

  return {
    // What a recording is: { durationSec, width, height, hasAudio }.
    async probe(video) {
      // ffmpeg exits with an error when given no output; what it prints is enough.
      const { stderr } = await ff(['-i', video, '-frames:v', '1', '-vf', 'showinfo', '-f', 'null', '-']).catch((e) => {
        throw new PlanError(`Couldn’t read ${video}: ${(e.stderr || e.message).trim().split('\n').pop()}`);
      });
      const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
      const s = / s:(\d+)x(\d+) /.exec(stderr);
      if (!d || !s) throw new PlanError(`Couldn’t read the length and size of ${video}`);
      return {
        durationSec: Math.round((Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 1000) / 1000,
        width: Number(s[1]),
        height: Number(s[2]),
        hasAudio: /Stream #\S+.*: Audio:/.test(stderr),
      };
    },

    // Quiet stretches of at least minSec, quieter than noiseDb:
    // [{ from, to, durationSec }] in source time.
    async silences(video, { minSec = 1, noiseDb = -35 } = {}) {
      const { stderr } = await ff(['-i', video, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minSec}`, '-f', 'null', '-']);
      const found = [];
      let start = null;
      for (const line of stderr.split('\n')) {
        const a = /silence_start: (-?[\d.]+)/.exec(line);
        const b = /silence_end: ([\d.]+)/.exec(line);
        if (a) start = Math.max(0, Number(a[1]));
        if (b && start !== null) {
          found.push({ from: start, to: Number(b[1]), durationSec: Math.round((Number(b[1]) - start) * 1000) / 1000 });
          start = null;
        }
      }
      return found;
    },

    // The edited video, as an MP4 at `out`. sourcePath is the source video's
    // path or URL (plans keep it relative to the plan file).
    async render(plan, { sourcePath, out, quality = 'full' }) {
      const { warnings } = checked(plan);
      const q = QUALITY[quality];
      const tl = timeline(plan);
      const size = outputSize(plan.source, q.maxPx);
      const hasAudio = plan.source.hasAudio !== false;
      return inTemp(async (dir) => {
        await fs.writeFile(path.join(dir, 'texts.ass'), buildAss(tl.texts, size));
        await fs.writeFile(path.join(dir, 'chapters.txt'), buildChapterMetadata(tl.chapters, tl.durationSec));
        const started = Date.now();
        await ff(
          [
            '-y', '-loglevel', 'error',
            '-i', sourcePath,
            '-i', 'chapters.txt',
            '-filter_complex', buildFilter({ segments: tl.segments, size, hasAudio }),
            '-map', '[v]', ...(hasAudio ? ['-map', '[a]'] : []),
            // The chapters file's metadata carries the chapter titles.
            '-map_metadata', '1', '-map_chapters', '1',
            '-c:v', 'libx264', '-preset', q.preset, '-crf', q.crf,
            ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
            '-movflags', '+faststart',
            path.resolve(out),
          ],
          { cwd: dir }
        );
        return { out: path.resolve(out), durationSec: tl.durationSec, ...size, seconds: (Date.now() - started) / 1000, warnings };
      });
    },

    // One frame of the edited video, at source time `at`, as a JPEG at `out`:
    // what the edit looks like there, texts included.
    async frame(plan, { sourcePath, at, out, quality = 'low' }) {
      checked(plan);
      const segments = keptSegments(plan);
      const pos = toOutputTime(segments, at);
      if (!pos) throw new PlanError(`${at}s is after the end of the recording`);
      if (pos.cut) {
        const next = segments.find((s) => s.from > at);
        throw new PlanError(`${at}s is cut out${next ? `; the video carries on at ${next.from}s` : ''}`);
      }
      const tl = timeline(plan);
      const size = outputSize(plan.source, QUALITY[quality].maxPx);
      return inTemp(async (dir) => {
        await fs.writeFile(path.join(dir, 'texts.ass'), buildAss(tl.texts, size));
        await ff(
          [
            '-y', '-loglevel', 'error',
            '-ss', String(at), '-i', sourcePath,
            '-frames:v', '1',
            '-vf', `scale=${size.width}:${size.height},setsar=1,setpts=PTS-STARTPTS+${pos.time}/TB,ass=texts.ass:fontsdir=fonts`,
            '-q:v', '3',
            path.resolve(out),
          ],
          { cwd: dir }
        );
        return { out: path.resolve(out), at, outputAt: pos.time, ...size };
      });
    },
  };
}

module.exports = { ffmpegEngine, buildAss, buildFilter, buildChapterMetadata, outputSize, assTime };
