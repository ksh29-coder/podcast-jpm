#!/usr/bin/env node
const { connect, migrate } = require('../src/db');
const { muxVideo } = require('../src/video');
const { createStore } = require('../src/store');
const { ffmpegEditor } = require('../src/edit');
const { ffmpegEngine } = require('../src/edit-engine/ffmpeg');

// Makes edited videos (episodes edited on the website, and Shorts with
// pictures) outside the API's time limit: an hour-long episode takes far
// longer to make than a Vercel function may run. Run it on any machine with
// the API's settings (DATABASE_URL, MUX_*), and set EDIT_WORKER=external on
// the API so it leaves episode edits to this.
//
//   npm run edit-worker            keep checking every 15 seconds
//   npm run edit-worker -- --once  make what's waiting, then stop (for a scheduler)

const EVERY_MS = 15_000;

async function main() {
  const once = process.argv.includes('--once');
  const db = connect();
  await migrate(db);
  const store = createStore({ db, video: muxVideo(), editor: ffmpegEditor(), engine: ffmpegEngine(), editWorker: 'external' });
  console.log(`Edit worker started${once ? ' (once)' : ''}`);
  do {
    try {
      const n = await store.makeQueuedEdits();
      if (n) console.log(`Edit worker: tried ${n} edit${n === 1 ? '' : 's'}`);
    } catch (e) {
      console.warn('edit worker', e.message);
    }
    if (!once) await new Promise((r) => setTimeout(r, EVERY_MS));
  } while (!once);
  await db.end?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
