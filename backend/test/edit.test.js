const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { ffmpegEditor, outputSize, pictureType } = require('../src/edit');

// Adding pictures to a video with the real ffmpeg, on a tiny video.

const ffmpeg = require('ffmpeg-static');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-test-'));
const make = (name, args) => {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args, path.join(dir, name)]);
  return path.join(dir, name);
};
// The colour (r, g, b) at a point of a frame of a video.
const pixel = (file, sec, x, y) => {
  const raw = execFileSync(ffmpeg, ['-loglevel', 'error', '-ss', String(sec), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [...raw.subarray(0, 3)];
};
const near = (actual, expected) => actual.every((c, i) => Math.abs(c - expected[i]) < 40);

test('pictures are recognised by their first bytes', () => {
  assert.strictEqual(pictureType(fs.readFileSync(make('a.png', ['-f', 'lavfi', '-i', 'color=c=red:s=8x8', '-frames:v', '1']))), 'png');
  assert.strictEqual(pictureType(fs.readFileSync(make('a.jpg', ['-f', 'lavfi', '-i', 'color=c=red:s=8x8', '-frames:v', '1']))), 'jpeg');
  assert.strictEqual(pictureType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});

test('videos are made at most 1920 pixels, in even sizes', () => {
  assert.deepStrictEqual(outputSize({ width: 1080, height: 1920 }), { width: 1080, height: 1920 });
  assert.deepStrictEqual(outputSize({ width: 2160, height: 3840 }), { width: 1080, height: 1920 });
  assert.deepStrictEqual(outputSize({ width: 719, height: 1279 }), { width: 720, height: 1280 });
});

test('a big photo is made smaller; a see-through picture stays PNG', async () => {
  const editor = ffmpegEditor();
  const photo = await editor.normalizePicture(fs.readFileSync(make('big.jpg', ['-f', 'lavfi', '-i', 'color=c=blue:s=4000x3000', '-frames:v', '1'])));
  assert.deepStrictEqual([photo.mime, photo.width, photo.height], ['image/jpeg', 1920, 1440]);
  const sticker = await editor.normalizePicture(fs.readFileSync(make('s.png', ['-f', 'lavfi', '-i', 'color=c=black@0:s=300x100,format=rgba', '-frames:v', '1'])));
  assert.deepStrictEqual([sticker.mime, sticker.width, sticker.height], ['image/png', 300, 100]);
  await assert.rejects(editor.normalizePicture(Buffer.from('GIF89a broken')), /couldn’t be read/);
});

test('pictures show on top or fill the video only while they should, with the sound kept', async () => {
  // 3 seconds of blue, 180x320, with a tone.
  const source = make('in.mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=180x320:r=25:d=3', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest']);
  const red = fs.readFileSync(make('red.png', ['-f', 'lavfi', '-i', 'color=c=red:s=100x100', '-frames:v', '1']));
  const yellow = fs.readFileSync(make('yellow.jpg', ['-f', 'lavfi', '-i', 'color=c=yellow:s=200x100', '-frames:v', '1']));
  const server = http.createServer((req, res) => fs.createReadStream(source).pipe(res)).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const out = path.join(dir, 'out.mp4');
    await ffmpegEditor().render(
      {
        videoUrl: `http://127.0.0.1:${server.address().port}/in.mp4`,
        pictures: [
          // Bottom-right quarter, from 0.5 to 1.5 seconds.
          { kind: 'overlay', startSec: 0.5, endSec: 1.5, x: 0.5, y: 0.5, w: 0.5, data: red, mime: 'image/png', width: 100, height: 100 },
          { kind: 'full', startSec: 2, endSec: 2.6, data: yellow, mime: 'image/jpeg', width: 200, height: 100 },
        ],
      },
      (file) => fs.copyFileSync(file, out)
    );
    const BLUE = [0, 0, 255];
    assert.ok(near(pixel(out, 0.2, 150, 250), BLUE), 'nothing yet');
    assert.ok(near(pixel(out, 1, 150, 200), [255, 0, 0]), 'the picture on top');
    assert.ok(near(pixel(out, 1, 20, 20), BLUE), 'only where it was put');
    assert.ok(near(pixel(out, 1.8, 150, 250), BLUE), 'gone again');
    assert.ok(near(pixel(out, 2.3, 90, 160), [255, 255, 0]), 'the whole picture in the middle');
    assert.ok(!near(pixel(out, 2.3, 90, 10), BLUE), 'its blurred copy behind, not the video');
    // ffmpeg -i lists the streams (on stderr).
    const streams = spawnSync(ffmpeg, ['-hide_banner', '-i', out]).stderr.toString();
    assert.match(streams, /Video: h264.*180x320/);
    assert.match(streams, /Audio: aac/);
  } finally {
    server.close();
  }
});
