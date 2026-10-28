import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { AuthError, bearerToken, verifyUserJwt } from '../src/lib/auth.ts';

const issuer = 'https://example.supabase.co/auth/v1';
const user = '7f9c2c1e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
let jwks: JWTVerifyGetKey;
let priv: CryptoKey;
let otherPriv: CryptoKey;

before(async () => {
  const kp = await generateKeyPair('ES256');
  priv = kp.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' };
  jwks = createLocalJWKSet({ keys: [jwk] });
  otherPriv = (await generateKeyPair('ES256')).privateKey as CryptoKey;
});

async function token(claims: Record<string, unknown>, opts: { key?: CryptoKey; exp?: string; iss?: string; aud?: string } = {}) {
  return new SignJWT({ role: 'authenticated', age_ok: true, ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(user)
    .setIssuer(opts.iss ?? issuer)
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(opts.key ?? priv);
}

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AuthError ? e.reason : 'other';
  }
}

test('bearerToken parses only well-formed headers', () => {
  assert.equal(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken('bearer abc'), 'abc');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken('Bearer a b'), null);
  assert.equal(bearerToken(undefined), null);
});

test('a valid adult token passes', async () => {
  const v = await verifyUserJwt(await token({}), { jwks, issuer });
  assert.equal(v.userId, user);
});

test('missing, expired, foreign-key, wrong-issuer and wrong-audience tokens fail', async () => {
  assert.equal(await reason(verifyUserJwt(null, { jwks, issuer })), 'missing_token');
  assert.equal(await reason(verifyUserJwt(await token({}, { exp: '-10m' }), { jwks, issuer })), 'invalid_token');
  assert.equal(await reason(verifyUserJwt(await token({}, { key: otherPriv }), { jwks, issuer })), 'invalid_token');
  assert.equal(await reason(verifyUserJwt(await token({}, { iss: 'https://evil.example/auth/v1' }), { jwks, issuer })), 'invalid_token');
  assert.equal(await reason(verifyUserJwt(await token({}, { aud: 'anon' }), { jwks, issuer })), 'invalid_token');
  assert.equal(await reason(verifyUserJwt('not.a.jwt', { jwks, issuer })), 'invalid_token');
});

test('anon, service-role and anonymous-user tokens are not users', async () => {
  assert.equal(await reason(verifyUserJwt(await token({ role: 'anon' }), { jwks, issuer })), 'not_authenticated');
  assert.equal(await reason(verifyUserJwt(await token({ role: 'service_role' }), { jwks, issuer })), 'not_authenticated');
  assert.equal(await reason(verifyUserJwt(await token({ is_anonymous: true }), { jwks, issuer })), 'not_authenticated');
});

test('age_ok must be exactly true unless the route opts out', async () => {
  assert.equal(await reason(verifyUserJwt(await token({ age_ok: false }), { jwks, issuer })), 'not_adult');
  assert.equal(await reason(verifyUserJwt(await token({ age_ok: 'true' }), { jwks, issuer })), 'not_adult');
  assert.equal(await reason(verifyUserJwt(await token({ age_ok: undefined }), { jwks, issuer })), 'not_adult');
  assert.equal(await reason(verifyUserJwt(await token({ age_ok: false }), { jwks, issuer, requireAdult: false })), 'ok');
});

test('an unsigned (alg none) token is rejected', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: user, role: 'authenticated', age_ok: true, iss: issuer, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  assert.equal(await reason(verifyUserJwt(`${header}.${payload}.`, { jwks, issuer })), 'invalid_token');
});
