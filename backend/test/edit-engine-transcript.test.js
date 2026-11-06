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

// Transcripts in the edit engine: reading Zoom's, finding words, fillers,
// and cutting by what was said.

const ZOOM_VTT = `WEBVTT

1
00:00:00.500 --> 00:00:03.500
Alice Chen: Um, welcome to AI Wave.

2
00:00:04.000 --> 00:00:07.900
Bob Li: Thanks. So, uh, can you see my screen?

3
00:00:08.000 --> 00:00:11.800
Alice Chen: Yes. Let's talk about testing, um, with AI.
`;

const plan = () => plans.emptyPlan({ video: 'src.mp4', durationSec: 12, width: 320, height: 180, hasAudio: true });
const words = (list) => ({ words: list.map(([text, start, end, speaker = 0]) => ({ text, start, end, speaker })), speakers: { 0: 'Alice' }, approx: false });

test('Zoom’s transcript gives speakers by name, and words timed within each line', () => {
  const t = transcripts.parseTranscript('zoom.vtt', ZOOM_VTT);
  assert.deepStrictEqual(t.speakers, { 0: 'Alice Chen', 1: 'Bob Li' });
  assert.strictEqual(t.approx, true);
  assert.strictEqual(t.words.length, 21);
  assert.deepStrictEqual(t.words[0], { text: 'Um,', start: 0.5, end: 1, speaker: 0 });
  assert.strictEqual(t.words[4].end, 3.5, 'a line’s words fill its time');
  assert.strictEqual(t.words[5].speaker, 1);
});

test('lines that only sometimes start "Word:" aren’t taken for speaker names', () => {
  const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nNote: this matters.\n\n00:00:02.000 --> 00:00:04.000\nAnd so does this.\n\n00:00:04.000 --> 00:00:06.000\nThe end.\n';
  const t = transcripts.parseTranscript('captions.vtt', vtt);
  assert.deepStrictEqual(t.speakers, {});
  assert.strictEqual(t.words[0].text, 'Note:');
  assert.strictEqual(t.words[0].speaker, null);
});

test('word JSON is read as given; junk is refused', () => {
  const t = transcripts.parseTranscript('w.json', JSON.stringify({ words: [{ word: 'b', start: 2, end: 3 }, { word: 'a', start: 1, end: 2, speaker: 1 }, { word: '', start: 3, end: 4 }] }));
  assert.deepStrictEqual(t.words, [{ text: 'a', start: 1, end: 2, speaker: 1 }, { text: 'b', start: 2, end: 3, speaker: null }]);
  assert.strictEqual(t.approx, false);
  assert.throws(() => transcripts.parseTranscript('w.json', '{"words": []}'), /no words/);
  assert.throws(() => transcripts.parseTranscript('w.txt', 'hello'), /isn’t WebVTT or JSON/);
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

test('lines show the speaker and how much of each the edit keeps', () => {
  const t = transcripts.parseTranscript('zoom.vtt', ZOOM_VTT);
  const p = plans.addCut(plan(), { from: 4, to: 8 }).plan;
  const shown = transcripts.lines(p, t, { from: 0, to: 8 });
  assert.deepStrictEqual(shown.map((l) => [l.speaker, l.status]), [['Alice Chen', 'kept'], ['Bob Li', 'cut'], ['Bob Li', 'cut']]);
  assert.strictEqual(shown[0].text, 'Um, welcome to AI Wave.');
});

test('the command line imports a transcript, cuts by what was said, and cuts all fillers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-transcript-test-'));
  const file = path.join(dir, 'ep.json');
  fs.writeFileSync(file, JSON.stringify(plan()));
  await assert.rejects(main(['search', file, '--text', 'screen']), /No transcript yet/);
  fs.writeFileSync(path.join(dir, 'zoom.vtt'), ZOOM_VTT);

  const imported = await main(['import-transcript', file, '--file', path.join(dir, 'zoom.vtt')]);
  assert.strictEqual(imported.transcript, 'ep.transcript.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).source.transcript, 'ep.transcript.json');
  await main(['speaker', file, '1', '--name', 'Bob Li (Markets Tech)']);
  assert.strictEqual((await main(['search', file, '--text', 'screen'])).found[0].speaker, 'Bob Li (Markets Tech)');

  const cut = await main(['cut', file, '--text', 'can you see my screen']);
  assert.deepStrictEqual([cut.change.item.from, cut.change.item.to, cut.change.item.reason], [5.6, 7.9, 'said: "can you see my screen?"']);
  await assert.rejects(main(['cut', file, '--text', 'um']), /said 2 times; cut one with --from and --to/);
  await assert.rejects(main(['cut', file, '--text', 'screen']), /isn’t said anywhere that’s still in the edit/);

  const applied = await main(['fillers', file, '--apply']);
  assert.deepStrictEqual(applied.change.items.map((i) => i.reason), ['filler: "Um,"', 'filler: "uh,"', 'filler: "um,"']);
  assert.match(applied.change.note, /Rough/);
  assert.deepStrictEqual((await main(['fillers', file])).found, []);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).cuts.length, 4);
});

test('the transcriber takes a file on this machine and gives back the words too', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-stt-test-'));
  const audio = path.join(dir, 'a.mp4');
  execFileSync(require('ffmpeg-static'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=d=2', audio]);
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
