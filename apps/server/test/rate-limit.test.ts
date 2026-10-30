import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import worker from '../src/app.ts';
import type { Env } from '../src/env.ts';
import { clientIpKey, underLimit } from '../src/lib/rate-limit.ts';

// The JWKS cache is per Supabase URL, so this file uses its own.
const SUPA = 'https://rate-limit.supabase.co';
const ALICE = '7f9c2c1e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const BOB = '8e0d3d2f-4c5b-4d6e-9fa0-1b2c3d4e5f60';
const realFetch = globalThis.fetch;
let tokens: Record<string, string> = {};
const rpcCalls: string[] = [];

before(async () => {
  const kp = await generateKeyPair('ES256');
  const jwk: JWK = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' };
  const sign = (sub: string) => new SignJWT({ role: 'authenticated', age_ok: true })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject(sub).setIssuer(`${SUPA}/auth/v1`)
    .setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(kp.privateKey);
  tokens = { [ALICE]: `Bearer ${await sign(ALICE)}`, [BOB]: `Bearer ${await sign(BOB)}` };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${SUPA}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    const m = /\/rest\/v1\/rpc\/(\w+)$/.exec(url);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    rpcCalls.push(m[1]!);
    return Response.json(null);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

/** A fake Rate Limiting binding: `limit` calls per key, then refusals. */
function limiter(limit: number) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const binding: RateLimit = {
    async limit({ key }) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
  return { binding, keys };
}

function env(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('<!doctype html><html><head></head><body></body></html>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher,
    AI_ASSETS: {} as unknown as R2Bucket,
    STORY_SCENE: {} as unknown as Workflow<{ jobId: string }>,
    MEDIA: {} as unknown as R2Bucket,
    EPISODE_INGEST: {} as unknown as Workflow<{ episodeId: string; assetId: string }>,
    APP_ENV: 'development', APP_ORIGIN: 'https://reeltale.net', MEDIA_ORIGIN: 'https://media.reeltale.net',
    SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test',
    CF_ACCOUNT_ID: 'acc', STREAM_CUSTOMER_CODE: '', APPLE_TEAM_ID: 'T', IOS_BUNDLE_ID: 'b', ANDROID_PACKAGE: 'b',
    ANDROID_CERT_SHA256: '', ADMOB_PUBLISHER_ID: 'pub-1',
    ...over,
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
function call(e: Env, path: string, init: RequestInit & { user?: string; ip?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.user) headers.set('Authorization', tokens[init.user]!);
  headers.set('CF-Connecting-IP', init.ip ?? '203.0.113.7');
  return worker.fetch(new Request(`https://reeltale.net${path}`, { ...init, headers }), e, ctx);
}

async function expect429(r: Response) {
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('Retry-After'), '60');
  assert.deepEqual(await r.json(), { error: 'rate_limited' });
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff', 'security headers still apply');
}

test('signed-in API calls are limited per user', async () => {
  const user = limiter(2);
  const e = env({ RATE_LIMIT_USER: user.binding });
  assert.equal((await call(e, '/api/playback/nope', { user: ALICE })).status, 400);
  assert.equal((await call(e, '/api/playback/nope', { user: ALICE })).status, 400);
  await expect429(await call(e, '/api/playback/nope', { user: ALICE }));
  assert.equal((await call(e, '/api/playback/nope', { user: BOB })).status, 400, 'each user has their own count');
  assert.deepEqual(user.keys, [`user:${ALICE}`, `user:${ALICE}`, `user:${ALICE}`, `user:${BOB}`]);
  // Same user from another address: still the same count (users are not keyed by address).
  await expect429(await call(e, '/api/playback/nope', { user: ALICE, ip: '198.51.100.9' }));
});

test('POST /api/ai/* also counts against the strict AI limit; reads under /api/ai do not', async () => {
  const user = limiter(100);
  const ai = limiter(1);
  const e = env({ RATE_LIMIT_USER: user.binding, RATE_LIMIT_AI: ai.binding });
  const post = () => call(e, '/api/ai/stories', { method: 'POST', user: ALICE, body: '{}', headers: { 'Content-Type': 'application/json' } });
  assert.equal((await post()).status, 400, 'the first start reaches the route (bad body here)');
  await expect429(await post());
  assert.equal((await call(e, '/api/ai/scenes/nope/manifest', { user: ALICE })).status, 400);
  assert.deepEqual(ai.keys, [`ai:${ALICE}`, `ai:${ALICE}`]);
  assert.equal(user.keys.length, 3, 'every call also counts per user');
  // The strict limit is the AI one only: other POSTs are fine.
  assert.equal((await call(e, '/api/uploads', { method: 'POST', user: ALICE, body: '{}' })).status, 400);
});

test('calls without a valid token are limited per client address; signed-in ones never are', async () => {
  const ip = limiter(1);
  const e = env({ RATE_LIMIT_IP: ip.binding });
  assert.equal((await call(e, '/api/playback/nope')).status, 401);
  await expect429(await call(e, '/api/playback/nope', { headers: { Authorization: 'Bearer forged' } }));
  assert.equal((await call(e, '/api/playback/nope', { ip: '2001:db8:1:2:aaaa::1' })).status, 401);
  await expect429(await call(e, '/api/playback/nope', { ip: '2001:db8:1:2:bbbb::9' }));
  assert.equal((await call(e, '/api/playback/nope', { user: ALICE })).status, 400);
  assert.deepEqual(ip.keys, ['api:203.0.113.7', 'api:203.0.113.7', 'api:2001:db8:1:2::/64', 'api:2001:db8:1:2::/64']);
});

test('health, signed webhooks and association files are never limited', async () => {
  const none = limiter(0);
  const e = env({ RATE_LIMIT_USER: none.binding, RATE_LIMIT_AI: none.binding, RATE_LIMIT_IP: none.binding });
  assert.equal((await call(e, '/api/health')).status, 200);
  assert.equal((await call(e, '/api/webhooks/revenuecat', { method: 'POST', body: '{}' })).status, 503, 'not configured, not 429');
  assert.equal((await call(e, '/api/webhooks/stream', { method: 'POST', body: '{}' })).status, 503);
  assert.equal((await call(e, '/.well-known/apple-app-site-association')).status, 200);
  assert.equal((await call(e, '/app-ads.txt')).status, 200);
  assert.deepEqual(none.keys, []);
});

test('over the limit, share pages are the plain web app without the database lookup', async () => {
  rpcCalls.length = 0;
  const ip = limiter(1);
  const e = env({ RATE_LIMIT_IP: ip.binding });
  const first = await call(e, '/series/the-lighthouse');
  assert.equal(first.status, 200);
  assert.deepEqual(rpcCalls, ['series_share_card']);
  const second = await call(e, '/series/the-lighthouse');
  assert.equal(second.status, 200);
  assert.match(second.headers.get('Content-Type') ?? '', /text\/html/);
  assert.deepEqual(rpcCalls, ['series_share_card'], 'no second lookup');
  assert.deepEqual(ip.keys, ['share:203.0.113.7', 'share:203.0.113.7']);
});

test('without bindings nothing is limited, and a failing limiter lets requests through', async () => {
  const e = env();
  for (let i = 0; i < 5; i++) assert.equal((await call(e, '/api/playback/nope')).status, 401);
  const broken: RateLimit = { async limit() { throw new Error('binding unavailable'); } };
  const b = env({ RATE_LIMIT_USER: broken, RATE_LIMIT_IP: broken, RATE_LIMIT_AI: broken });
  assert.equal((await call(b, '/api/playback/nope', { user: ALICE })).status, 400);
  assert.equal((await call(b, '/api/playback/nope')).status, 401);
  assert.equal(await underLimit(undefined, 'k'), true);
  assert.equal(await underLimit(limiter(0).binding, 'k'), false);
});

test('client address keys: IPv4 as is, IPv6 by /64, everything else shares one key', () => {
  assert.equal(clientIpKey('203.0.113.7'), '203.0.113.7');
  assert.equal(clientIpKey(' 203.0.113.7 '), '203.0.113.7');
  assert.equal(clientIpKey('2001:db8:85a3:0:0:8a2e:370:7334'), '2001:db8:85a3:0::/64');
  assert.equal(clientIpKey('2001:DB8:85a3:0000:ffff::2'), '2001:db8:85a3:0::/64');
  assert.equal(clientIpKey('2001:db8:85a3::1'), '2001:db8:85a3:0::/64');
  assert.equal(clientIpKey('::1'), '0:0:0:0::/64');
  assert.equal(clientIpKey('fe80::1%en0'), 'fe80:0:0:0::/64');
  assert.equal(clientIpKey('::ffff:198.51.100.4'), '198.51.100.4');
  for (const bad of ['', null, undefined, 'garbage', '1.2.3.256', '1.2.3', '1:2:3:4:5:6:7:8:9', '1::2::3', '1:2:3:4:5:6:7', 'g::1']) {
    assert.equal(clientIpKey(bad), 'unknown', String(bad));
  }
});
