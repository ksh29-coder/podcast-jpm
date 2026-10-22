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

module.exports = { str, num, tags };
