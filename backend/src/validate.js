const { httpError } = require('./store');

// Checks for request bodies; each throws a 400 with a readable reason.

function str(value, name, { required = false, max = 5000 } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) throw httpError(400, `${name} is required`);
  if (value.length > max) throw httpError(400, `${name} is too long (max ${max} characters)`);
  return value.trim();
}

function num(value, name, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw httpError(400, `${name} must be a number${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}`);
  }
  return value;
}

// "#AI, Testing ,ai" -> ["ai", "testing"]. Up to 10 tags of 30 characters.
function tags(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((t) => typeof t !== 'string')) throw httpError(400, 'tags must be a list of words');
  const clean = [...new Set(value.map((t) => t.trim().replace(/^#+/, '').toLowerCase()).filter(Boolean))];
  if (clean.length > 10) throw httpError(400, 'Up to 10 tags');
  if (clean.some((t) => t.length > 30)) throw httpError(400, 'Tags can be at most 30 characters');
  return clean;
}

// Caption lines from an editor: [{ startSec, endSec, text }], in the video's
// time. Lines left empty are dropped.
function cues(value) {
  if (!Array.isArray(value) || value.length > 500) throw httpError(400, 'cues must be a list of up to 500 lines');
  return value
    .map((c, i) => {
      const startSec = num(c?.startSec, `line ${i + 1} start`, { required: true, min: 0, max: 4 * 3600 });
      const endSec = num(c?.endSec, `line ${i + 1} end`, { required: true, min: startSec, max: 4 * 3600 });
      const text = (str(c?.text ?? '', `line ${i + 1}`, { max: 300 }) || '').replace(/\s+/g, ' ');
      return { startSec, endSec, text };
    })
    .filter((c) => c.text);
}

// Pictures on a Short, in its own time: [{ pictureId, kind, startSec,
// endSec }], plus for 'overlay' its top-left corner (x, y) and width (w) as
// fractions of the video's size. It may hang off the edges a little.
const MAX_PICTURES = 5;
function pictures(value) {
  if (!Array.isArray(value) || value.length > MAX_PICTURES) throw httpError(400, `pictures must be a list of up to ${MAX_PICTURES}`);
  return value.map((p, i) => {
    const name = `picture ${i + 1}`;
    const pictureId = str(p?.pictureId, `${name} pictureId`, { required: true, max: 64 });
    if (!['overlay', 'full'].includes(p.kind)) throw httpError(400, `${name} kind must be "overlay" or "full"`);
    const startSec = num(p.startSec, `${name} startSec`, { required: true, min: 0, max: 600 });
    const endSec = num(p.endSec, `${name} endSec`, { required: true, min: startSec + 0.2, max: 600 });
    const round = (n) => Math.round(n * 1000) / 1000;
    if (p.kind === 'full') return { pictureId, kind: 'full', startSec: round(startSec), endSec: round(endSec) };
    return {
      pictureId,
      kind: 'overlay',
      startSec: round(startSec),
      endSec: round(endSec),
      x: round(num(p.x, `${name} x`, { required: true, min: -0.5, max: 1 })),
      y: round(num(p.y, `${name} y`, { required: true, min: -0.5, max: 1 })),
      w: round(num(p.w, `${name} w`, { required: true, min: 0.05, max: 1 })),
    };
  });
}

module.exports = { str, num, tags, cues, pictures, MAX_PICTURES };
