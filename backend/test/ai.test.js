const { test } = require('node:test');
const assert = require('node:assert');
const { cleanInsights } = require('../src/ai');

const cues = [
  { startSec: 0, endSec: 4.2, text: 'a' },
  { startSec: 4.2, endSec: 8.7, text: 'b' },
  { startSec: 8.7, endSec: 16.8, text: 'c' },
  { startSec: 16.8, endSec: 30, text: 'd' },
];

test('chapters: sorted, first at 0, snapped to lines, inside the episode', () => {
  const r = cleanInsights({ chapters: [{ startSec: 9, title: 'Two' }, { startSec: 1, title: 'One' }, { startSec: 99, title: 'x' }, { startSec: 10, title: '' }] }, { durationSec: 30, cues });
  assert.deepStrictEqual(r.chapters, [{ startSec: 0, title: 'One' }, { startSec: 9, title: 'Two' }]);
});

test('shorts: kept to 10–90 seconds and inside the episode', () => {
  const r = cleanInsights({ shorts: [{ startSec: 0, endSec: 500, title: 'Long' }, { startSec: 5, endSec: 6, title: 'Tiny' }] }, { durationSec: 300, cues: [...cues, { startSec: 30, endSec: 300, text: 'e' }] });
  assert.strictEqual(r.shorts.length, 1);
  assert.ok(r.shorts[0].endSec - r.shorts[0].startSec <= 90);
});

test('rubbish replies give empty suggestions instead of failing', () => {
  assert.deepStrictEqual(cleanInsights(null, { durationSec: 30, cues }), { summary: '', chapters: [], tags: [], mentions: [], shorts: [] });
  assert.deepStrictEqual(cleanInsights({ chapters: 'nope', tags: [1, null] }, { durationSec: 30, cues }).tags, []);
});
