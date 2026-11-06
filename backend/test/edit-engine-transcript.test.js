const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const plans = require('../src/edit-engine/plan');
const transcripts = require('../src/edit-engine/transcript');
const { openRouterTranscriber } = require('../src/transcribe');
const { main } = require('../bin/wave-edit');

// Transcripts in the edit engine: words from the AI transcriber, finding
// words and fillers, and cutting by what was said.

const ffmpeg = require('ffmpeg-static');
const plan = (durationSec = 12) => plans.emptyPlan({ video: 'src.mp4', durationSec, width: 320, height: 180, hasAudio: true });
const words = (list) => transcripts.fromWords(list.map(([word, start, end, speaker = 0]) => ({ word, start, end, speaker })), { durationSec: 12 });

// What the transcriber hears in the test recording.
const HEARD = [
  ['Um,', 0.5, 0.8, 0], ['welcome', 0.8, 1.4, 0], ['to', 1.4, 1.5, 0], ['AI', 1.5, 1.8, 0], ['Wave.', 1.8, 2.3, 0],
  ['Thanks.', 4, 4.6, 1], ['So,', 4.8, 5.1, 1], ['uh,', 5.2, 5.5, 1], ['can', 5.6, 5.8, 1], ['you', 5.8, 6], ['see', 6, 6.3, 1], ['my', 6.3, 6.5, 1], ['screen?', 6.5, 7.2, 1],
  ['Yes.', 8, 8.4, 0], ['Let’s', 8.6, 9, 0], ['talk', 9, 9.3, 0], ['about', 9.3, 9.6, 0], ['testing,', 9.6, 10.4, 0], ['um,', 10.6, 11, 0], ['with', 11.1, 11.3, 0], ['AI.', 11.3, 11.8, 0],
].map(([word, start, end, speaker = 1]) => ({ word, start, end, speaker }));

test('in a recording longer than one transcription piece, speakers are kept apart per piece', () => {
  const heard = [{ word: 'a', start: 10, end: 11, speaker: 0 }, { word: 'b', start: 2410, end: 2411, speaker: 0 }, { word: 'c', start: 2420, end: 2421, speaker: 1 }];
  const long = transcripts.fromWords(heard, { durationSec: 3000, pieceSec: 2400 });
  assert.deepStrictEqual(long.words.map((w) => w.speaker), ['0:0', '1:0', '1:1']);
  assert.strictEqual(transcripts.speakerName(long, '1:0'), 'Speaker 1, part 2');
  assert.strictEqual(transcripts.speakerName({ speakers: { '1:0': 'Alice' } }, '1:0'), 'Alice');
  const short = transcripts.fromWords(heard, { durationSec: 2000, pieceSec: 2400 });
  assert.deepStrictEqual(short.words.map((w) => w.speaker), [0, 0, 1]);
  assert.strictEqual(transcripts.speakerName(short, 1), 'Speaker 2');
});

test('a saved transcript is read back as it was; junk is refused', () => {
  const t = transcripts.parseTranscript('t.json', JSON.stringify({ words: [{ text: 'b', start: 2, end: 3, speaker: '1:0' }, { text: 'a', start: 1, end: 2, speaker: 1 }, { text: '', start: 3, end: 4 }], speakers: { 1: 'Bob' } }));
  assert.deepStrictEqual(t.words, [{ text: 'a', start: 1, end: 2, speaker: 1 }, { text: 'b', start: 2, end: 3, speaker: '1:0' }]);
  assert.deepStrictEqual(t.speakers, { 1: 'Bob' });
  assert.throws(() => transcripts.parseTranscript('t.json', '{"words": []}'), /no words/);
  assert.throws(() => transcripts.parseTranscript('t.vtt', 'WEBVTT'), /isn’t JSON/);
});

test('search ignores case and punctuation, and says whether each place is still in the edit', () => {
  const t = words([['We', 0, 0.5], ['use', 0.5, 1], ['Kubernetes,', 1, 2], ['kubernetes', 5, 6], ['everywhere.', 6, 7]]);
  let p = plans.addCut(plan(), { from: 4.5, to: 6.5 }).plan;
  const found = transcripts.search(p, t, 'KUBERNETES');
  assert.deepStrictEqual(found.map((f) => [f.from, f.to, f.status]), [[1, 2, 'kept'], [5, 6, 'cut']]);
  assert.strictEqual(transcripts.search(p, t, 'use kubernetes')[0].said, 'use Kubernetes,');
  p = plans.addCut(plan(), { from: 6.5, to: 8 }).plan;
  assert.strictEqual(transcripts.search(p, t, 'everywhere')[0].status, 'partly cut');
  assert.throws(() => transcripts.search(p, t, ' ,. '), /Say what to look for/);
});

test('fillers are found once each, leaving out ones already cut and phrases not asked for', () => {
  const t = words([['Um,', 0, 0.3], ['so', 0.3, 0.6], ['you', 0.6, 0.8], ['know,', 0.8, 1], ['uh', 1, 1.2], ['tests.', 1.2, 2], ['Erm', 3, 3.4]]);
  const p = plans.addCut(plan(), { from: 2.9, to: 3.5 }).plan;
  assert.deepStrictEqual(transcripts.fillers(p, t).map((f) => f.said), ['Um,', 'uh']);
  assert.deepStrictEqual(transcripts.fillers(p, t, { also: ['you know'] }).map((f) => f.said), ['Um,', 'you know,', 'uh']);
});

test('lines show who spoke and how much of each line the edit keeps', () => {
  const t = transcripts.fromWords(HEARD, { durationSec: 12 });
  const p = plans.addCut(plan(), { from: 3.5, to: 8 }).plan;
  const shown = transcripts.lines(p, t, { from: 0, to: 8 });
  assert.deepStrictEqual(shown.map((l) => [l.speakerId, l.speaker, l.text, l.status]), [
    [0, 'Speaker 1', 'Um, welcome to AI Wave.', 'kept'],
    [1, 'Speaker 2', 'Thanks.', 'cut'],
    [1, 'Speaker 2', 'So, uh, can you see my screen?', 'cut'],
  ]);
});

test('the command line transcribes once, names speakers, cuts by what was said and cuts fillers', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-transcript-test-'));
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=12:r=25', '-f', 'lavfi', '-i', 'sine=d=12', '-shortest', path.join(dir, 'src.mp4')]);
  const file = path.join(dir, 'ep.json');
  await main(['init', file, '--video', path.join(dir, 'src.mp4')]);
  await assert.rejects(main(['search', file, '--text', 'screen']), /No transcript yet; make one with: wave-edit transcribe/);

  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    return Response.json({ words: HEARD, usage: { cost: 0.01 } });
  });
  const old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test';
  try {
    const made = await main(['transcribe', file]);
    assert.deepStrictEqual([made.transcript, made.words, made.cost], ['ep.transcript.json', 21, 0.01]);
    assert.deepStrictEqual(made.speakers, { 0: 'Speaker 1', 1: 'Speaker 2' });
    await assert.rejects(main(['transcribe', file]), /already has a transcript.*--force/);
    assert.strictEqual(calls, 1);
  } finally {
    if (old === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = old;
  }

  await main(['speaker', file, '1', '--name', 'Bob Li']);
  assert.strictEqual((await main(['search', file, '--text', 'screen'])).found[0].speaker, 'Bob Li');

  const cut = await main(['cut', file, '--text', 'can you see my screen']);
  assert.deepStrictEqual([cut.change.item.from, cut.change.item.to, cut.change.item.reason], [5.6, 7.2, 'said: "can you see my screen?"']);
  await assert.rejects(main(['cut', file, '--text', 'um']), /said 2 times; cut one with --from and --to/);
  await assert.rejects(main(['cut', file, '--text', 'screen']), /isn’t said anywhere that’s still in the edit/);

  const applied = await main(['fillers', file, '--apply']);
  assert.deepStrictEqual(applied.change.items.map((i) => i.reason), ['filler: "Um,"', 'filler: "uh,"', 'filler: "um,"']);
  assert.deepStrictEqual((await main(['fillers', file])).found, []);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).cuts.length, 4);

  // A transcript made earlier can be brought into another plan.
  const other = path.join(dir, 'other.json');
  await main(['init', other, '--video', path.join(dir, 'src.mp4')]);
  const imported = await main(['import-transcript', other, '--file', path.join(dir, 'ep.transcript.json')]);
  assert.deepStrictEqual(imported.speakers, { 0: 'Speaker 1', 1: 'Bob Li' });
});

test('the transcriber takes a file on this machine and gives back the words too', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-stt-test-'));
  const audio = path.join(dir, 'a.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=d=2', audio]);
  const calls = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    calls.push(String(url));
    if (String(url).startsWith('https://media.example')) return new Response(fs.readFileSync(audio));
    assert.strictEqual(JSON.parse(opts.body).input_audio.format, 'mp3');
    return Response.json({ words: [{ word: 'Hello', start: 0.1, end: 0.5, speaker: 0 }, { word: 'there.', start: 0.5, end: 0.9, speaker: 0 }] });
  });
  const stt = openRouterTranscriber({ apiKey: 'test' });
  const fromFile = await stt.transcribeFile(audio);
  assert.deepStrictEqual(fromFile.words.map((w) => w.word), ['Hello', 'there.']);
  assert.deepStrictEqual(fromFile.cues, [{ startSec: 0.1, endSec: 0.9, text: 'Hello there.', speaker: 0 }]);
  const { transcribe } = stt;
  const fromUrl = await transcribe('https://media.example/a.m4a');
  assert.strictEqual(fromUrl.words.length, 2);
  assert.strictEqual(calls.length, 3);
});
