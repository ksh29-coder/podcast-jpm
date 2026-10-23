// Work that carries on after the reply has been sent, such as making a video
// with pictures added. On Vercel the function stays alive for it (up to its
// time limit, see vercel.json); elsewhere Node simply carries on. Inside JPM
// this would hand the job to a worker instead.
function inBackground(work) {
  const done = Promise.resolve(work).catch((e) => console.warn('background', e.message));
  try {
    require('@vercel/functions').waitUntil(done);
  } catch {
    // Not on Vercel.
  }
  return done;
}

module.exports = { inBackground };
