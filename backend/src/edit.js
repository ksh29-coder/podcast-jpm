const { execFile } = require('child_process');
const { createWriteStream } = require('fs');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');

const run = promisify(execFile);

// Makes the final video of a Short with pictures added, with ffmpeg on our
// own server (no video-service features), so it moves into JPM as it is.
//
// Two kinds of picture, both shown from startSec to endSec while the video
// and its sound carry on:
// - 'overlay': on top of the video. x and y place its top-left corner and w
//   its width, as fractions of the video's width and height.
// - 'full': fills the video, the whole picture on a blurred copy of itself.

// Pictures are kept at most this big; videos are made at most this big.
const MAX_PICTURE_PX = 1920;
const MAX_VIDEO_PX = 1920;

const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

// What a picture file is, from its first bytes. PNG and WebP can be
// see-through (stickers), so they stay PNG; the rest become JPEG.
function pictureType(buf) {
  const ascii = (from, to) => buf.subarray(from, to).toString('latin1');
  if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(0, 3) === 'GIF') return 'gif';
  return null;
}

// The filter graph for a video of width x height (input 0) and the pictures
// (inputs 1, 2…, each { kind, startSec, endSec, x, y, w, width, height }).
// Ends in [v].
function buildFilter({ width, height, pictures }) {
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const parts = [`[0:v]scale=${width}:${height},setsar=1[b0]`];
  pictures.forEach((p, i) => {
    const input = `[${i + 1}:v]`;
    const when = `enable='between(t,${p.startSec.toFixed(2)},${p.endSec.toFixed(2)})'`;
    if (p.kind === 'full') {
      parts.push(
        `${input}split[s${i}a][s${i}b]`,
        `[s${i}a]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=40[bg${i}]`,
        `[s${i}b]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg${i}]`,
        `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2[p${i}]`,
        `[b${i}][p${i}]overlay=0:0:${when}[b${i + 1}]`
      );
    } else {
      const w = even(p.w * width);
      const h = even((w * p.height) / p.width);
      parts.push(`${input}scale=${w}:${h}[p${i}]`, `[b${i}][p${i}]overlay=${Math.round(p.x * width)}:${Math.round(p.y * height)}:${when}[b${i + 1}]`);
    }
  });
  parts.push(`[b${pictures.length}]format=yuv420p[v]`);
  return parts.join(';');
}

// The video's size as shown (after rotation), made smaller to fit
// MAX_VIDEO_PX, in even numbers as H.264 needs.
function outputSize({ width, height }) {
  const scale = Math.min(1, MAX_VIDEO_PX / Math.max(width, height));
  const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

function ffmpegEditor({ ffmpeg = require('ffmpeg-static'), preset = process.env.EDIT_PRESET || 'veryfast' } = {}) {
  // Width and height of the first frame, as ffmpeg shows it (rotated upright).
  async function frameSize(file, filters = '') {
    const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', file, '-frames:v', '1', '-vf', `${filters}showinfo`, '-f', 'null', '-'], { maxBuffer: 16 << 20 });
    const m = / s:(\d+)x(\d+) /.exec(stderr);
    if (!m) throw new Error('Couldn’t read the size of the file');
    return { width: Number(m[1]), height: Number(m[2]) };
  }

  async function inTemp(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edit-'));
    try {
      return await fn(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  return {
    // A picture someone added, checked and made a sensible size:
    // -> { data, mime, width, height }.
    async normalizePicture(buf) {
      const kind = pictureType(buf);
      if (!kind) throw httpError(400, 'Use a JPEG, PNG, WebP or GIF picture');
      return inTemp(async (dir) => {
        const input = path.join(dir, 'in');
        const png = kind !== 'jpeg';
        const output = path.join(dir, png ? 'out.png' : 'out.jpg');
        await fs.writeFile(input, buf);
        const fit = `scale='min(iw,${MAX_PICTURE_PX}*iw/max(iw,ih))':-2,`;
        try {
          await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', input, '-frames:v', '1', '-vf', fit.slice(0, -1), ...(png ? [] : ['-q:v', '3']), output]);
          const size = await frameSize(output);
          return { data: await fs.readFile(output), mime: png ? 'image/png' : 'image/jpeg', ...size };
        } catch (e) {
          if (e.status) throw e;
          throw httpError(400, 'That picture couldn’t be read. Try another one.');
        }
      });
    },

    // The video at videoUrl with the pictures ({ data, ...placement }) added.
    // `use` gets the finished MP4's path before the temporary files go.
    async render({ videoUrl, pictures }, use) {
      return inTemp(async (dir) => {
        const input = path.join(dir, 'in.mp4');
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`Couldn’t download the video (${res.status})`);
        await pipeline(Readable.fromWeb(res.body), createWriteStream(input));
        const size = outputSize(await frameSize(input));
        const files = [];
        for (let i = 0; i < pictures.length; i++) {
          files.push(path.join(dir, `p${i}${pictures[i].mime === 'image/png' ? '.png' : '.jpg'}`));
          await fs.writeFile(files[i], pictures[i].data);
        }
        const output = path.join(dir, 'out.mp4');
        const started = Date.now();
        await run(
          ffmpeg,
          [
            '-y',
            '-loglevel',
            'error',
            '-i',
            input,
            ...files.flatMap((f) => ['-i', f]),
            '-filter_complex',
            buildFilter({ ...size, pictures }),
            '-map',
            '[v]',
            '-map',
            '0:a?',
            '-c:v',
            'libx264',
            '-preset',
            preset,
            '-crf',
            '21',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-movflags',
            '+faststart',
            output,
          ],
          { maxBuffer: 16 << 20 }
        );
        console.log('edit render', { ...size, pictures: pictures.length, seconds: (Date.now() - started) / 1000 });
        return use(output);
      });
    },
  };
}

module.exports = { ffmpegEditor, buildFilter, outputSize, pictureType };
