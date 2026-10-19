const { test } = require('node:test');
const assert = require('node:assert');
const jpeg = require('jpeg-js');
const { tintFromJpeg } = require('../src/tint');

const solid = (r, g, b) => {
  const w = 8, h = 8, d = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([r, g, b, 255], i * 4);
  return jpeg.encode({ data: d, width: w, height: h }, 90).data;
};

test('picks a dark version of the artwork color', () => {
  const red = tintFromJpeg(solid(200, 40, 40));
  assert.match(red, /^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(red.slice(i, i + 2), 16));
  assert.ok(r > g && r > b, red);
  assert.ok(r < 160, 'dark enough for white text');
});

test('gives up on unreadable or colorless images', () => {
  assert.strictEqual(tintFromJpeg(Buffer.from('not a jpeg')), null);
  assert.strictEqual(tintFromJpeg(solid(0, 0, 0)), null);
});
