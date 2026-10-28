import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import worker from '../src/app.ts';
import type { Env } from '../src/env.ts';

// The JWKS cache is per Supabase URL, so this file uses its own.
const SUPA = 'https://ai-routes.supabase.co';
const USER = '7f9c2c1e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const STORY = '11111111-1111-4111-8111-111111111111';
const SCENE = '22222222-2222-4222-8222-222222222222';
const JOB = '44444444-4444-4444-8444-444444444444';
const PREMISE = 'A lighthouse keeper finds letters from someone not born yet.';

let jwk: JWK;
let priv: CryptoKey;
let bearer: string;
const realFetch = globalThis.fetch;
let rpcCalls: { fn: string; args: Record<string, unknown>; profile: string }[] = [];
let rpc: (fn: string, args: Record<string, unknown>) => { status?: number; body: unknown } = () => ({ body: null });

before(async () => {
  const kp = await generateKeyPair('ES256');
  priv = kp.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' };
  bearer = `Bearer ${await new SignJWT({ role: 'authenticated', age_ok: true })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject(USER).setIssuer(`${SUPA}/auth/v1`)
    .setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(priv)}`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${SUPA}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    const m = url.match(/^https:\/\/ai-routes\.supabase\.co\/rest\/v1\/rpc\/(\w+)$/);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
    rpcCalls.push({ fn: m[1]!, args, profile: (init?.headers as Record<string, string>)['Content-Profile']! });
    const r = rpc(m[1]!, args);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  rpcCalls = [];
});

function bucket(objects: Record<string, string>) {
  const gets: string[] = [];
  return {
    gets,
    async get(key: string) {
      gets.push(key);
      const v = objects[key];
      if (v === undefined) return null;
      return { text: async () => v, body: new Response(v).body };
    },
  };
}

function env(over: { create?: (o: { id: string }) => Promise<unknown>; objects?: Record<string, string> } = {}) {
  const created: { id: string; params: unknown }[] = [];
  const assets = bucket(over.objects ?? {});
  const e = {
    ASSETS: { fetch: async () => new Response('') } as unknown as Fetcher,
    AI_ASSETS: assets as unknown as R2Bucket,
    STORY_SCENE: {
      async create(o: { id: string; params: unknown }) {
        if (over.create) await over.create(o);
        created.push(o);
        return { id: o.id };
      },
    } as unknown as Workflow<{ jobId: string }>,
    APP_ENV: 'development', APP_ORIGIN: 'https://reeltale.net', MEDIA_ORIGIN: 'https://media.reeltale.net',
    SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test',
    CF_ACCOUNT_ID: 'acc', STREAM_CUSTOMER_CODE: '', APPLE_TEAM_ID: 'T', IOS_BUNDLE_ID: 'b', ANDROID_PACKAGE: 'b',
    ANDROID_CERT_SHA256: '', ADMOB_PUBLISHER_ID: 'pub-1',
  } as Env;
  return { e, created, assets };
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
function call(e: Env, path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.auth !== false) headers.Authorization = bearer;
  const body = init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  return worker.fetch(new Request(`https://reeltale.net${path}`, { method: init.method ?? 'GET', headers, body }), e, ctx);
}

const started = { story_id: STORY, scene_id: SCENE, job_id: JOB };

test('starting a story calls the service RPC as the signed-in user and launches the workflow', async () => {
  rpc = () => ({ body: started });
  const { e, created } = env();
  const r = await call(e, '/api/ai/stories', { method: 'POST', body: { premise: PREMISE, tags: ['mystery'] } });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), started);
  assert.deepEqual(rpcCalls.map((c) => [c.fn, c.profile, c.args.p_user]), [['ai_start_story', 'svc', USER]]);
  assert.deepEqual(created, [{ id: JOB, params: { jobId: JOB } }]);
});

test('bad bodies are refused before any database call', async () => {
  const { e } = env();
  for (const body of [{ premise: 'too short' }, { premise: PREMISE, mode: 'video' }, { premise: PREMISE, tags: ['Bad Tag'] }, 'not json']) {
    const r = await call(e, '/api/ai/stories', { method: 'POST', body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(rpcCalls.length, 0);
  assert.equal((await call(e, '/api/ai/stories', { method: 'POST', body: { premise: PREMISE }, auth: false })).status, 401);
});

test('if the workflow cannot start, the job is failed (refunded) at once', async () => {
  rpc = (fn) => ({ body: fn === 'ai_start_story' ? started : { status: 'refunded' } });
  const { e } = env({ create: async () => { throw new Error('boom'); } });
  const r = await call(e, '/api/ai/stories', { method: 'POST', body: { premise: PREMISE } });
  assert.equal(r.status, 503);
  assert.deepEqual(rpcCalls.at(-1), { fn: 'ai_job_failed', profile: 'svc', args: { p_job: JOB, p_error_code: 'launch_failed', p_blocked: false } });

  rpcCalls = [];
  const dup = env({ create: async () => { throw new Error('instance already exists'); } });
  assert.equal((await call(dup.e, '/api/ai/stories', { method: 'POST', body: { premise: PREMISE } })).status, 202);
  assert.ok(!rpcCalls.some((c) => c.fn === 'ai_job_failed'), 'a duplicate start is not a failure');
});

test('database errors map to safe statuses; unknown ones are hidden', async () => {
  const { e } = env();
  const cases: [string, string | undefined, number, unknown][] = [
    ['ai_consent_required', undefined, 403, { error: 'ai_consent_required' }],
    ['insufficient_coins', '20', 409, { error: 'insufficient_coins', detail: 20 }],
    ['rate_limited', undefined, 429, { error: 'rate_limited' }],
    ['relation "app_private.x" does not exist', undefined, 500, { error: 'internal_error' }],
  ];
  for (const [message, details, status, body] of cases) {
    rpc = () => ({ status: 400, body: { message, code: 'P0001', details } });
    const r = await call(e, '/api/ai/stories', { method: 'POST', body: { premise: PREMISE } });
    assert.equal(r.status, status, message);
    assert.deepEqual(await r.json(), body);
  }
});

test('choosing an existing scene does not launch another workflow', async () => {
  const { e, created } = env();
  rpc = () => ({ body: { ...started, existing: true, status: 'ready' } });
  assert.equal((await call(e, `/api/ai/scenes/${SCENE}/choose`, { method: 'POST', body: { choice: 'b' } })).status, 202);
  assert.equal(created.length, 0);
  rpc = () => ({ body: { ...started, existing: false, status: 'queued' } });
  assert.equal((await call(e, `/api/ai/scenes/${SCENE}/choose`, { method: 'POST', body: { choice: 'b' } })).status, 202);
  assert.equal(created.length, 1);
  assert.equal((await call(e, '/api/ai/scenes/not-a-uuid/choose', { method: 'POST', body: { choice: 'b' } })).status, 400);
  assert.equal((await call(e, `/api/ai/scenes/${SCENE}/choose`, { method: 'POST', body: { choice: 'd' } })).status, 400);
});

test('manifests and panels are served only through the access check, only next to the manifest', async () => {
  const manifestKey = `ai/${STORY}/${SCENE}/manifest.json`;
  const { e, assets } = env({ objects: { [manifestKey]: '{"version":1}', [`ai/${STORY}/${SCENE}/panel-2.webp`]: 'img' } });
  rpc = () => ({ body: { allowed: true, manifest_key: manifestKey } });
  const m = await call(e, `/api/ai/scenes/${SCENE}/manifest`);
  assert.equal(m.status, 200);
  assert.equal(await m.text(), '{"version":1}');
  assert.match(m.headers.get('Cache-Control') ?? '', /private/);
  const p = await call(e, `/api/ai/scenes/${SCENE}/assets/panel-2.webp`);
  assert.equal(p.status, 200);
  assert.equal(p.headers.get('Content-Type'), 'image/webp');
  assert.equal(assets.gets.at(-1), `ai/${STORY}/${SCENE}/panel-2.webp`);
  for (const file of ['panel-5.webp', 'manifest.json', '..%2Fmanifest.json', 'sheet-mara.webp']) {
    assert.equal((await call(e, `/api/ai/scenes/${SCENE}/assets/${file}`)).status, 400, file);
  }
  rpc = () => ({ body: { allowed: false, reason: 'not_available' } });
  assert.equal((await call(e, `/api/ai/scenes/${SCENE}/manifest`)).status, 404);
  assert.equal((await call(e, `/api/ai/scenes/${SCENE}/assets/panel-2.webp`)).status, 404);
});
