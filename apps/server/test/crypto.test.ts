import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { derToP1363, hmacSha256Hex, timingSafeEqual, verifyTimestampedHmac } from '../src/lib/crypto.ts';

const secret = 'whsec_test_secret';
const body = '{"event":{"id":"e1"}}';

async function header(ts: number, sigKey = 'v1', tsKey = 't', bodyText = body, key = secret) {
  return `${tsKey}=${ts},${sigKey}=${await hmacSha256Hex(key, `${ts}.${bodyText}`)}`;
}

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
});

test('a valid RevenueCat-style signature passes', async () => {
  const now = 1_790_000_000;
  const r = await verifyTimestampedHmac({ header: await header(now), rawBody: body, secret, tsKey: 't', sigKey: 'v1', nowSec: now + 10 });
  assert.deepEqual(r, { ok: true });
});

test('a tampered body, wrong secret, stale timestamp or garbage header fails', async () => {
  const now = 1_790_000_000;
  const h = await header(now);
  const base = { secret, tsKey: 't', sigKey: 'v1', nowSec: now };
  assert.deepEqual(await verifyTimestampedHmac({ ...base, header: h, rawBody: body + ' ' }), { ok: false, reason: 'mismatch' });
  assert.deepEqual(await verifyTimestampedHmac({ ...base, header: h, rawBody: body, secret: 'other' }), { ok: false, reason: 'mismatch' });
  assert.deepEqual(await verifyTimestampedHmac({ ...base, header: h, rawBody: body, nowSec: now + 301 }), { ok: false, reason: 'stale' });
  assert.deepEqual(await verifyTimestampedHmac({ ...base, header: h, rawBody: body, nowSec: now - 301 }), { ok: false, reason: 'stale' });
  assert.deepEqual(await verifyTimestampedHmac({ ...base, header: 'nonsense', rawBody: body }), { ok: false, reason: 'missing' });
  assert.deepEqual(await verifyTimestampedHmac({ ...base, header: 't=abc,v1=00', rawBody: body }), { ok: false, reason: 'malformed' });
  assert.deepEqual(await verifyTimestampedHmac({ ...base, header: null, rawBody: body }), { ok: false, reason: 'missing' });
});

test('the signed timestamp is bound to the signature (no swapping in a fresh one)', async () => {
  const old = 1_790_000_000;
  const now = old + 10_000;
  const sig = (await header(old)).split(',')[1];
  const forged = `t=${now},${sig}`;
  assert.deepEqual(
    await verifyTimestampedHmac({ header: forged, rawBody: body, secret, tsKey: 't', sigKey: 'v1', nowSec: now }),
    { ok: false, reason: 'mismatch' });
});

test('Stream-style headers and rotated secrets (two signatures) work', async () => {
  const now = 1_790_000_000;
  const good = await hmacSha256Hex(secret, `${now}.${body}`);
  const h = `time=${now},sig1=deadbeef,sig1=${good}`;
  assert.deepEqual(await verifyTimestampedHmac({ header: h, rawBody: body, secret, tsKey: 'time', sigKey: 'sig1', nowSec: now }), { ok: true });
});

test('DER ECDSA signatures convert to P1363 and verify with WebCrypto', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const msg = Buffer.from('ad_network=1&ad_unit=2&reward_amount=1');
  for (let i = 0; i < 20; i++) {
    const der = nodeSign('sha256', msg, { key: privateKey, dsaEncoding: 'der' });
    const p1363 = derToP1363(new Uint8Array(der));
    assert.equal(p1363.length, 64);
    const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, p1363, msg), true);
  }
  assert.throws(() => derToP1363(new Uint8Array([1, 2, 3])));
});
