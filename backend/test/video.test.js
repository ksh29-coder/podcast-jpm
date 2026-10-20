const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { muxVideo } = require('../src/video');

// A throwaway signing key, in the form Mux hands it out (base64 of the PEM).
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const signingKey = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
const NOW = Date.UTC(2026, 9, 20);

const signedMux = () => muxVideo({ tokenId: 'id', tokenSecret: 'secret', signed: true, signingKeyId: 'key1', signingKey, now: () => NOW });

// Checks the token's signature and returns its header and claims.
function readToken(url) {
  const { searchParams } = new URL(url);
  assert.deepStrictEqual([...searchParams.keys()], ['token'], 'a signed link carries nothing but the token');
  const [header, body, signature] = searchParams.get('token').split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${body}`), publicKey, Buffer.from(signature, 'base64url')), 'signature checks out');
  const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());
  return { header: decode(header), claims: decode(body) };
}

test('public videos get plain links', () => {
  const mux = muxVideo({ tokenId: 'id', tokenSecret: 'secret' });
  assert.strictEqual(mux.hlsUrl('abc'), 'https://stream.mux.com/abc.m3u8');
  assert.strictEqual(mux.audioUrl('abc'), 'https://stream.mux.com/abc/audio.m4a');
  assert.strictEqual(mux.thumbnailUrl('abc', 5), 'https://image.mux.com/abc/thumbnail.jpg?time=5&width=800&height=800&fit_mode=smartcrop');
});

test('private videos get signed links that expire', () => {
  const mux = signedMux();
  const video = mux.hlsUrl('s:abc');
  assert.ok(video.startsWith('https://stream.mux.com/abc.m3u8?token='));
  const { header, claims } = readToken(video);
  assert.deepStrictEqual(header, { alg: 'RS256', typ: 'JWT', kid: 'key1' });
  assert.deepStrictEqual(claims, { sub: 'abc', aud: 'v', exp: NOW / 1000 + 12 * 3600 });
  assert.strictEqual(readToken(mux.audioUrl('s:abc')).claims.aud, 'v');
});

test('private thumbnails carry their options inside the token', () => {
  const url = signedMux().thumbnailUrl('s:abc', 7, 32);
  assert.ok(url.startsWith('https://image.mux.com/abc/thumbnail.jpg?token='));
  const { claims } = readToken(url);
  assert.deepStrictEqual({ aud: claims.aud, time: claims.time, width: claims.width, height: claims.height }, { aud: 't', time: 7, width: 32, height: 32 });
});

test('videos from before signing was switched on stay public', () => {
  assert.strictEqual(signedMux().hlsUrl('old'), 'https://stream.mux.com/old.m3u8');
});

test('needs a signing key to switch on', () => {
  assert.throws(() => muxVideo({ tokenId: 'id', tokenSecret: 'secret', signed: true }), /MUX_SIGNING_KEY/);
});

test('new uploads ask for a signed id, and assets report it as private', async (t) => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push({ url, body: init.body && JSON.parse(init.body) });
    const data = url.endsWith('/uploads')
      ? { id: 'up1', url: 'https://upload' }
      : { status: 'ready', playback_ids: [{ id: 'xyz', policy: 'signed' }], tracks: [] };
    return { ok: true, json: async () => ({ data }) };
  });
  const mux = signedMux();
  await mux.createUpload();
  assert.deepStrictEqual(sent[0].body.new_asset_settings.playback_policies, ['signed']);
  assert.strictEqual((await mux.getAsset('asset1')).playbackId, 's:xyz');
});
