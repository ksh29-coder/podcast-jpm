const { execFile } = require('child_process');
const { createWriteStream } = require('fs');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');
const { TEXT_STYLES, MAIN, ZOOM_EASE_SEC, PlanError, timeline, toOutputTime, keptSegments, layoutSources, included, suggestions: suggestionsOf, validate } = require('./plan');

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

// Behind a screen share that doesn't fill the picture.
const BACKDROP = '0x111111';
// The speaker in a corner: this much of the picture's width, this far in.
const PIP_WIDTH = 0.26;
const PIP_MARGIN = 0.025;
// In side-by-side, the screen share takes this much of the width.
const SIDE_SCREEN = 0.64;

// The bundled ffmpeg is a static build that can't look up host names (it
// crashes on a link like https://…), so links are downloaded first and ffmpeg
// is given the file. A path is used as it is.
const isLink = (src) => /^https?:\/\//.test(src);
async function download(src, file) {
  if (!isLink(src)) return src;
  const res = await fetch(src);
  if (!res.ok) throw new PlanError(`Couldn’t download ${src.split('?')[0]} (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return file;
}

// Each named recording (paths: { name: path or link }) as a file in dir.
async function downloadAll(paths, dir) {
  const out = {};
  for (const [name, src] of Object.entries(paths)) out[name] = await download(src, path.join(dir, `in-${name}`));
  return out;
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
function outputSize({ width, height }, maxPx) {
  const scale = Math.min(1, maxPx / Math.max(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}
// A picture of width x height made as big as fits in box, keeping its shape.
function fitIn({ width, height }, box) {
  const scale = Math.min(box.width / width, box.height / height);
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
    .replace(/\\/g, '\\\u200b')
    .replace(/[{}]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, '\\N');

// .ass colours are &HAABBGGRR, where AA 00 is solid.
const WHITE = '&H00FFFFFF';
const BOX = '&H40101010';

const assHeader = ({ width, height }, styles) =>
  [
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
  ].join('\n');

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
  return `${assHeader({ width, height }, styles)}\n${events.join('\n')}\n`;
}

// A grid over a picture, labelled with fractions of its width and height,
// so whoever looks at it (often an AI) can say where things are.
function buildGridAss({ width, height }) {
  const size = Math.round(height * 0.028);
  const style = `Style: grid,${FONT},${size},&H0000FFFF,&H0000FFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,3,2,0,7,0,0,0,1`;
  const lines = [];
  const all = `0:00:00.00,9:00:00.00`;
  for (let i = 1; i < 10; i++) {
    const x = Math.round((width * i) / 10);
    const y = Math.round((height * i) / 10);
    lines.push(`Dialogue: 0,${all},grid,,0,0,0,,{\\an7\\pos(0,0)\\bord0\\1c&H0000FFFF&\\1a&H60&\\p1}m ${x} 0 l ${x + 1} 0 ${x + 1} ${height} ${x} ${height}{\\p0}`);
    lines.push(`Dialogue: 0,${all},grid,,0,0,0,,{\\an7\\pos(0,0)\\bord0\\1c&H0000FFFF&\\1a&H60&\\p1}m 0 ${y} l ${width} ${y} ${width} ${y + 1} 0 ${y + 1}{\\p0}`);
    lines.push(`Dialogue: 1,${all},grid,,0,0,0,,{\\an7\\pos(${x + 3},3)}${(i / 10).toFixed(1)}`);
    lines.push(`Dialogue: 1,${all},grid,,0,0,0,,{\\an7\\pos(3,${y + 3})}${(i / 10).toFixed(1)}`);
  }
  return `${assHeader({ width, height }, [style])}\n${lines.join('\n')}\n`;
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

// zoompan expressions for zooms (in edited time) on a picture: each eases in
// over ZOOM_EASE_SEC to show its rect, and back out before it ends.
function zoomExpressions(zooms) {
  const f = (n) => Number(n.toFixed(4));
  const terms = zooms.map((z) => {
    const [x, y, w, h] = z.rect;
    const ramp = `clip((it-${f(z.outFrom)})/${ZOOM_EASE_SEC},0,1)*clip((${f(z.outTo)}-it)/${ZOOM_EASE_SEC},0,1)`;
    return { ramp, zoom: f(1 / Math.max(w, h)), cx: f(x + w / 2), cy: f(y + h / 2) };
  });
  const sum = (part) => terms.map(part).join('+') || '0';
  return {
    z: `1+${sum((t) => `${f(t.zoom - 1)}*${t.ramp}`)}`,
    x: `clip((0.5+${sum((t) => `${f(t.cx - 0.5)}*${t.ramp}`)})*iw-iw/zoom/2,0,iw-iw/zoom)`,
    y: `clip((0.5+${sum((t) => `${f(t.cy - 0.5)}*${t.ramp}`)})*ih-ih/zoom/2,0,ih-ih/zoom)`,
  };
}

// The filter graph for a plan (already without anything not wanted, like
// suggestions). Ends in [v], and [a] with audio.
//
//   inputs:   { [source name]: input number } for the speaker and the
//             sources the scenes show
//   seekFrom: where in the main recording the inputs were started (-ss), to
//             make a single frame without reading everything before it
//   segments: the kept parts to make (all of them, or a sliver for a frame)
//   shift:    the edited time the first segment starts at
function buildGraph(plan, { canvas, fps, inputs, seekFrom = 0, segments, shift = 0, audio = false, overlays = 'texts.ass' }) {
  const tl = timeline(plan);
  const parts = [];
  const n = segments.length;
  const cutUp = (label, name, { withAudio = false } = {}) => {
    parts.push(`[${label}]split=${n}${segments.map((_, i) => `[${name}v${i}]`).join('')}`);
    if (withAudio) parts.push(`[0:a]asplit=${n}${segments.map((_, i) => `[${name}a${i}]`).join('')}`);
    segments.forEach((s, i) => {
      const range = `start=${Math.max(0, s.from - seekFrom)}:end=${s.to - seekFrom}`;
      parts.push(`[${name}v${i}]trim=${range},setpts=PTS-STARTPTS[${name}t${i}]`);
      if (withAudio) parts.push(`[${name}a${i}]atrim=${range},asetpts=PTS-STARTPTS[${name}u${i}]`);
    });
    const ins = segments.map((_, i) => (withAudio ? `[${name}t${i}][${name}u${i}]` : `[${name}t${i}]`)).join('');
    parts.push(`${ins}concat=n=${n}:v=1:a=${withAudio ? 1 : 0}[${name}c]${withAudio ? '[a]' : ''}`);
    parts.push(`[${name}c]setpts=PTS+${shift}/TB[${name}]`);
  };

  // Each recording, on the main recording's clock, at the size it's used at.
  const sizes = { [MAIN]: canvas };
  const streams = {};
  for (const [name, input] of Object.entries(inputs)) {
    const label = `src${input}`;
    if (name === MAIN) {
      parts.push(`[${input}:v]setpts=PTS-STARTPTS,fps=${fps},scale=${canvas.width}:${canvas.height},setsar=1[${label}]`);
    } else {
      const src = plan.sources[name];
      sizes[name] = fitIn(src, canvas);
      // Black before it starts, and its last picture held after it ends.
      const before = Math.max(0, src.offsetSec - seekFrom);
      parts.push(
        `[${input}:v]setpts=PTS-STARTPTS,fps=${fps},scale=${sizes[name].width}:${sizes[name].height},setsar=1,` +
          `tpad=start_duration=${before}:color=black:stop_mode=clone:stop_duration=${Math.ceil(plan.source.durationSec + 5)}[${label}]`
      );
    }
    cutUp(label, `s${input}`, { withAudio: name === MAIN && audio });
    streams[name] = `s${input}`;
  }

  // Zooms, within each recording's own picture.
  for (const name of Object.keys(streams)) {
    const zooms = tl.zooms.filter((z) => z.source === name);
    if (!zooms.length) continue;
    const e = zoomExpressions(zooms);
    const { width, height } = sizes[name];
    // zoompan numbers its frames from 0, so put them back at `shift`.
    parts.push(`[${streams[name]}]zoompan=z='${e.z}':x='${e.x}':y='${e.y}':d=1:s=${width}x${height}:fps=${fps},setpts=PTS+${shift}/TB[${streams[name]}z]`);
    streams[name] = `${streams[name]}z`;
  }

  // One picture per kind of scene, then each shown over the speaker while
  // its scenes are on.
  const groups = new Map();
  for (const s of tl.scenes) {
    if (s.layout === MAIN) continue;
    const key = `${s.layout}|${s.source || 'screen'}|${s.pip || 'bottom-right'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const uses = { [MAIN]: 1 };
  for (const key of groups.keys()) {
    const [layout, source] = key.split('|');
    uses[source] = (uses[source] || 0) + 1;
    if (layout !== 'screen') uses[MAIN] += 1;
  }
  const copies = {};
  for (const [name, count] of Object.entries(uses)) {
    copies[name] = Array.from({ length: count }, (_, i) => `${streams[name]}_${i}`);
    parts.push(count === 1 ? `[${streams[name]}]null[${copies[name][0]}]` : `[${streams[name]}]split=${count}${copies[name].map((c) => `[${c}]`).join('')}`);
  }
  const take = (name) => copies[name].shift();
  const { width: W, height: H } = canvas;
  let current = take(MAIN);
  let g = 0;
  for (const [key, scenes] of groups) {
    const [layout, source, pip] = key.split('|');
    const L = `layout${g}`;
    const screenFull = () => `[${take(source)}]pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BACKDROP}`;
    if (layout === 'screen') parts.push(`${screenFull()}[${L}]`);
    if (layout === 'screen+speaker') {
      const pw = even(W * PIP_WIDTH);
      const ph = even((pw * H) / W);
      const m = Math.round(W * PIP_MARGIN);
      const x = pip.endsWith('left') ? m : W - pw - m;
      const y = pip.startsWith('top') ? m : H - ph - m;
      parts.push(`${screenFull()}[${L}bg]`, `[${take(MAIN)}]scale=${pw}:${ph}[${L}pip]`, `[${L}bg][${L}pip]overlay=${x}:${y}[${L}]`);
    }
    if (layout === 'side-by-side') {
      const lw = even(W * SIDE_SCREEN);
      parts.push(
        `[${take(source)}]scale=${lw}:${H}:force_original_aspect_ratio=decrease,pad=${lw}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BACKDROP}[${L}l]`,
        `[${take(MAIN)}]crop=${W - lw}:${H}[${L}r]`,
        `[${L}l][${L}r]hstack[${L}]`
      );
    }
    const when = scenes.map((s) => `between(t,${s.outFrom},${s.outTo})`).join('+');
    parts.push(`[${current}][${L}]overlay=0:0:enable='${when}'[over${g}]`);
    current = `over${g}`;
    g++;
  }
  parts.push(`[${current}]ass=${overlays}:fontsdir=fonts,format=yuv420p[v]`);
  return parts.join(';');
}

// The recordings a plan's scenes show, besides the speaker.
const sourcesShown = (plan) => [...new Set(timeline(plan).scenes.flatMap(layoutSources))];

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

  // fn with the recording as a file (downloaded first when it's a link).
  const withFile = (src, fn) => (isLink(src) ? inTemp(async (dir) => fn(await download(src, path.join(dir, 'in')))) : fn(src));

  function checked(plan) {
    const result = validate(plan);
    if (!result.ok) throw new PlanError(`The plan has problems:\n- ${result.errors.join('\n- ')}`);
    return result;
  }

  const fpsOf = (plan) => plan.source.fps || 30;

  return {
    // Each recording (by name) as a file in dir, downloading links: to read
    // a long recording once for several steps.
    downloadAll,

    // What a recording is: { durationSec, width, height, fps, hasAudio }.
    async probe(src) {
      return withFile(src, async (video) => {
        // ffmpeg exits with an error when given no output; what it prints is enough.
        const { stderr } = await ff(['-i', video, '-frames:v', '1', '-vf', 'showinfo', '-f', 'null', '-']).catch((e) => {
          throw new PlanError(`Couldn’t read ${src}: ${(e.stderr || e.message).trim().split('\n').pop()}`);
        });
        const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
        const s = / s:(\d+)x(\d+) /.exec(stderr);
        if (!d || !s) throw new PlanError(`Couldn’t read the length and size of ${src}`);
        const fps = /, ([\d.]+) fps,/.exec(stderr);
        return {
          durationSec: Math.round((Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 1000) / 1000,
          width: Number(s[1]),
          height: Number(s[2]),
          fps: fps ? Math.min(60, Number(fps[1])) : 30,
          hasAudio: /Stream #\S+.*: Audio:/.test(stderr),
        };
      });
    },

    // Quiet stretches of at least minSec, quieter than noiseDb:
    // [{ from, to, durationSec }] in source time.
    async silences(src, { minSec = 1, noiseDb = -35 } = {}) {
      return withFile(src, async (video) => {
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
      });
    },

    // What happens on a recording's picture, on the main recording's clock:
    // blank stretches (black, like a screen share that hasn't started) and
    // moments the picture changes a lot (a new slide, window or page).
    async activity(src, { offsetSec = 0, minBlankSec = 1, change = 0.3 } = {}) {
      return withFile(src, async (video) => {
        const { stderr } = await ff(['-i', video, '-an', '-vf', `scale=320:-2,blackdetect=d=${minBlankSec}:pix_th=0.1,select='gt(scene,${change})',showinfo`, '-f', 'null', '-']);
        const at = (t) => Math.round((Number(t) + offsetSec) * 1000) / 1000;
        const blank = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ from: at(m[1]), to: at(m[2]) }));
        const changes = [...stderr.matchAll(/\] n:\s*\d+ pts:\s*\d+ pts_time:([\d.]+)/g)].map((m) => at(m[1]));
        return { blank, changes };
      });
    },

    // The edited video, as an MP4 at `out`. paths are each recording's path or
    // link by name ("speaker" and the plan's sources).
    async render(fullPlan, { paths, out, quality = 'full', suggestions = false }) {
      const { warnings } = checked(fullPlan);
      const plan = included(fullPlan, { suggestions });
      const q = QUALITY[quality];
      const tl = timeline(plan);
      const canvas = outputSize(plan.source, q.maxPx);
      const audio = plan.source.hasAudio !== false;
      const inputs = { [MAIN]: 0 };
      sourcesShown(plan).forEach((name, i) => (inputs[name] = i + 2));
      return inTemp(async (dir) => {
        const files = await downloadAll(Object.fromEntries(Object.keys(inputs).map((name) => [name, paths[name]])), dir);
        await fs.writeFile(path.join(dir, 'texts.ass'), buildAss(tl.texts, canvas));
        await fs.writeFile(path.join(dir, 'chapters.txt'), buildChapterMetadata(tl.chapters, tl.durationSec));
        const started = Date.now();
        const sourceArgs = Object.keys(inputs).filter((name) => name !== MAIN).flatMap((name) => ['-i', files[name]]);
        await ff(
          [
            '-y', '-loglevel', 'error',
            '-i', files[MAIN],
            '-i', 'chapters.txt',
            ...sourceArgs,
            '-filter_complex', buildGraph(plan, { canvas, fps: fpsOf(plan), inputs, segments: tl.segments, audio }),
            '-map', '[v]', ...(audio ? ['-map', '[a]'] : []),
            // The chapters file's metadata carries the chapter titles.
            '-map_metadata', '1', '-map_chapters', '1',
            '-c:v', 'libx264', '-preset', q.preset, '-crf', q.crf,
            ...(audio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
            '-movflags', '+faststart',
            path.resolve(out),
          ],
          { cwd: dir }
        );
        const suggestionsShown = suggestions ? suggestionsOf(fullPlan).length : 0;
        return { out: path.resolve(out), durationSec: tl.durationSec, ...canvas, seconds: (Date.now() - started) / 1000, suggestionsShown, warnings };
      });
    },

    // One frame of the edited video, at main-recording time `at`, as a JPEG
    // at `out`: what the edit looks like there, suggestions included.
    async frame(plan, { paths, at, out, quality = 'low', suggestions = true }) {
      checked(plan);
      const p = included(plan, { suggestions });
      const segments = keptSegments(p);
      const pos = toOutputTime(segments, at);
      if (at > p.source.durationSec) throw new PlanError(`${at}s is after the end of the recording`);
      if (!pos) throw new PlanError(`${at}s is cut out, with the rest of the recording after it`);
      if (pos.cut) {
        const next = segments.find((s) => s.from > at);
        throw new PlanError(`${at}s is cut out${next ? `; the video carries on at ${next.from}s` : ''}`);
      }
      const tl = timeline(p);
      const fps = fpsOf(p);
      const canvas = outputSize(p.source, QUALITY[quality].maxPx);
      const inputs = { [MAIN]: 0 };
      sourcesShown(p).forEach((name, i) => (inputs[name] = i + 1));
      // Start reading a little before, so the frame is exact.
      const seekFrom = Math.max(0, at - 1);
      return inTemp(async (dir) => {
        const files = await downloadAll(Object.fromEntries(Object.keys(inputs).map((name) => [name, paths[name]])), dir);
        const seekArgs = (name) => ['-ss', String(Math.max(0, seekFrom - (name === MAIN ? 0 : p.sources[name].offsetSec))), '-i', files[name]];
        await fs.writeFile(path.join(dir, 'texts.ass'), buildAss(tl.texts, canvas));
        await ff(
          [
            '-y', '-loglevel', 'error',
            ...Object.keys(inputs).flatMap(seekArgs),
            '-filter_complex', buildGraph(p, { canvas, fps, inputs, seekFrom, segments: [{ from: at, to: at + 3 / fps }], shift: pos.time }),
            '-map', '[v]', '-frames:v', '1', '-q:v', '3',
            path.resolve(out),
          ],
          { cwd: dir }
        );
        return { out: path.resolve(out), at, outputAt: pos.time, ...canvas };
      });
    },

    // A recording's own picture at main-recording time `at` (not the edit),
    // with a grid labelled 0.1 … 0.9 when grid is set, to work out where
    // things are on it (say, for a zoom's rect).
    async look(plan, { paths, source = MAIN, at, out, grid = true }) {
      const info = source === MAIN ? plan.source : plan.sources[source];
      if (!info) throw new PlanError(`There's no "${source}" recording`);
      const t = at - (info.offsetSec || 0);
      if (t < 0 || t > info.durationSec) throw new PlanError(`The ${source} recording doesn’t cover ${at}s`);
      const size = outputSize(info, 1280);
      return inTemp(async (dir) => {
        const file = await download(paths[source], path.join(dir, 'in'));
        await fs.writeFile(path.join(dir, 'grid.ass'), buildGridAss(size));
        await ff(['-y', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${size.width}:${size.height}${grid ? ',ass=grid.ass:fontsdir=fonts' : ''}`, '-q:v', '3', path.resolve(out)], { cwd: dir });
        return { out: path.resolve(out), source, at, ...size, grid };
      });
    },
  };
}

module.exports = { ffmpegEngine, buildAss, buildGraph, buildChapterMetadata, zoomExpressions, outputSize, assTime };
