const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { wordsToCues, cuesToVtt } = require('../src/transcribe');
const { cleanInsights } = require('../src/ai');
const { fakeVideo } = require('./fake-video');

test('words become read-along lines: split at sentences, speaker changes and ~10 s', () => {
  const w = (word, start, speaker = 0) => ({ word, start, end: start + 0.4, speaker });
  const cues = wordsToCues([w('Hello', 0), w('there.', 0.5), w('Hi', 1, 1), w('Kai', 1.5, 1), w('and', 2, 1), w('welcome', 13, 1), w('back', 13.5, 1)]);
  assert.deepStrictEqual(
    cues.map((c) => [c.text, c.speaker]),
    [
      ['Hello there.', 0],
      ['Hi Kai and', 1],
      ['welcome back', 1],
    ]
  );
});

test('captions are valid WebVTT', () => {
  const vtt = cuesToVtt([{ startSec: 3661.5, endSec: 3663, text: 'Hi' }]);
  assert.match(vtt, /^WEBVTT\n\n01:01:01\.500 --> 01:01:03\.000\nHi\n$/);
});

test('AI speaker names only for speakers in the transcript', () => {
  const cues = [{ startSec: 0, endSec: 2, text: 'I am Kai', speaker: 0 }];
  assert.deepStrictEqual(cleanInsights({ speakers: { 0: 'Kai', S1: 'Ghost', 2: '' } }, { durationSec: 10, cues }).speakers, { 0: 'Kai' });
});

const PASSCODE = 'pc';
let server, base, video;
const transcriber = {
  model: 'test/stt',
  fail: false,
  calls: 0,
  async transcribe() {
    this.calls++;
    if (this.fail) throw new Error('service down');
    return {
      cues: [
        { startSec: 0.7, endSec: 3.9, text: 'This is the first episode.', speaker: 0 },
        { startSec: 4.8, endSec: 6.5, text: 'Hello there.', speaker: 1 },
      ],
    };
  },
};

before(async () => {
  video = fakeVideo();
  server = createApp({ db: new PGlite(), video, transcriber, tint: async () => '#334455', hostPasscode: PASSCODE }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const host = async (method, path, body) => {
  const res = await fetch(`${base}/api/host${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Host-Passcode': PASSCODE }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const get = async (p) => (await fetch(`${base}${p}`)).json();

async function publishedEpisode(title) {
  const up = await host('POST', '/uploads', { kind: 'episode' });
  const ep = (await host('POST', '/episodes', { title, videoId: up.body.videoId })).body;
  await host('PATCH', `/episodes/${ep.id}`, { status: 'published' });
  return { ep, videoId: up.body.videoId };
}

test('publishing transcribes with speakers; names come from the host', async () => {
  const { ep, videoId } = await publishedEpisode('With speakers');
  const t = await get(`/api/episodes/${ep.id}/transcript`);
  assert.strictEqual(t.status, 'ready');
  assert.strictEqual(t.source, 'test/stt');
  assert.deepStrictEqual(t.cues.map((c) => c.speaker), [0, 1]);

  await host('PATCH', `/episodes/${ep.id}`, { speakers: { 0: 'Kai', 1: 'Isabella' } });
  assert.deepStrictEqual((await get(`/api/episodes/${ep.id}/transcript`)).speakers, { 0: 'Kai', 1: 'Isabella' });
  assert.strictEqual((await host('PATCH', `/episodes/${ep.id}`, { speakers: { kai: 'x' } })).status, 400);

  const vtt = await (await fetch(`${base}/api/captions/${videoId}.vtt`)).text();
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /Hello there\./);
  assert.strictEqual((await fetch(`${base}/api/captions/nope.vtt`)).status, 404);
});

test('if transcription fails, Mux captions are used instead', async () => {
  transcriber.fail = true;
  try {
    const { ep } = await publishedEpisode('Fallback');
    const t = await get(`/api/episodes/${ep.id}/transcript`);
    assert.strictEqual(t.status, 'ready');
    assert.strictEqual(t.source, 'mux');
  } finally {
    transcriber.fail = false;
  }
});

test('a host can re-transcribe; it replaces the old transcript', async () => {
  transcriber.fail = true;
  const { ep } = await publishedEpisode('Redo');
  transcriber.fail = false;
  assert.strictEqual((await get(`/api/episodes/${ep.id}/transcript`)).source, 'mux');
  const before = transcriber.calls;
  assert.strictEqual((await host('POST', `/episodes/${ep.id}/transcribe`)).status, 200);
  assert.strictEqual(transcriber.calls, before + 1);
  assert.strictEqual((await get(`/api/episodes/${ep.id}/transcript`)).source, 'test/stt');
  assert.strictEqual((await host('POST', '/episodes/nope/transcribe')).status, 404);
});
