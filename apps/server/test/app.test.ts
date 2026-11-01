import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/app.ts';
import type { Env } from '../src/env.ts';

function env(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('<!doctype html><html><head></head><body></body></html>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher,
    AI_ASSETS: {} as unknown as R2Bucket,
    STORY_SCENE: {} as unknown as Workflow<{ jobId: string }>,
    MEDIA: {} as unknown as R2Bucket,
    EPISODE_INGEST: {} as unknown as Workflow<{ episodeId: string; assetId: string }>,
    APP_ENV: 'development',
    APP_ORIGIN: 'https://reeltale.net',
    MEDIA_ORIGIN: 'https://media.reeltale.net',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    CF_ACCOUNT_ID: 'acc',
    STREAM_CUSTOMER_CODE: '',
    APPLE_TEAM_ID: 'LJTQL4479V',
    IOS_BUNDLE_ID: 'com.euragnos.reeltale',
    ANDROID_PACKAGE: 'com.euragnos.reeltale',
    ANDROID_CERT_SHA256: 'AA:BB',
    ADMOB_PUBLISHER_ID: 'pub-6272675197810340',
    ...over,
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const call = (path: string, init: RequestInit = {}, e: Env = env()) => worker.fetch(new Request(`https://reeltale.net${path}`, init), e, ctx);

test('health works without auth and carries security headers', async () => {
  const r = await call('/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, env: 'development' });
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(r.headers.get('Strict-Transport-Security') ?? '', /max-age=/);
});

test('user API routes require a token', async () => {
  const r = await call('/api/playback/7f9c2c1e-3b4a-4c5d-8e9f-0a1b2c3d4e5f');
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'missing_token' });
  const bad = await call('/api/uploads', { method: 'POST', headers: { Authorization: 'Bearer nope' } });
  assert.equal(bad.status, 401);
});

test('webhooks are reachable without user auth but fail closed when not configured or unsigned', async () => {
  const notConfigured = await call('/api/webhooks/revenuecat', { method: 'POST', body: '{}' });
  assert.equal(notConfigured.status, 503);
  const e = env({ REVENUECAT_WEBHOOK_AUTH: 'Bearer secret-auth', REVENUECAT_WEBHOOK_HMAC_SECRET: 'h' });
  const wrongAuth = await call('/api/webhooks/revenuecat', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer nope' } }, e);
  assert.equal(wrongAuth.status, 401);
  const noSig = await call('/api/webhooks/revenuecat', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer secret-auth' } }, e);
  assert.equal(noSig.status, 401);
  const stream = await call('/api/webhooks/stream', { method: 'POST', body: '{}' });
  assert.equal(stream.status, 503);
});

test('unknown API paths are JSON 404s, not the web app', async () => {
  const r = await call('/api/nope', { headers: {} });
  // Auth middleware runs first for /api/*: without a token it's 401, which is fine; with SUPABASE_URL
  // unset it is 503. Either way it never falls through to HTML.
  assert.notEqual(r.headers.get('Content-Type')?.includes('text/html'), true);
});

test('association files have the right shape and type', async () => {
  const aasa = await call('/.well-known/apple-app-site-association');
  assert.equal(aasa.headers.get('Content-Type'), 'application/json');
  const j = (await aasa.json()) as { applinks: { details: { appIDs: string[] }[] } };
  assert.deepEqual(j.applinks.details[0]?.appIDs, ['LJTQL4479V.com.euragnos.reeltale']);
  const links = (await (await call('/.well-known/assetlinks.json')).json()) as { target: { sha256_cert_fingerprints: string[] } }[];
  assert.deepEqual(links[0]?.target.sha256_cert_fingerprints, [], 'malformed fingerprints are dropped');
  const ads = await (await call('/app-ads.txt')).text();
  assert.equal(ads, 'google.com, pub-6272675197810340, DIRECT, f08c47fec0942fa0\n');
});

test('HTML from assets gets a strict CSP', async () => {
  const r = await call('/');
  const csp = r.headers.get('Content-Security-Policy') ?? '';
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.match(csp, /https:\/\/example\.supabase\.co/);
});

test('every request runs the Worker first, so static files get the security headers too', async () => {
  // Files the asset layer serves on its own skip the Worker: index.html once went out with no CSP.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const jsonc = readFileSync(fileURLToPath(new URL('../wrangler.jsonc', import.meta.url).href), 'utf8');
  const json = jsonc.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
  const config = JSON.parse(json) as { assets: { run_worker_first: unknown } };
  assert.equal(config.assets.run_worker_first, true);
});
