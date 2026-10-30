import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/app.ts';
import type { Env } from '../src/env.ts';
import { dailyIpHash, ipBucket } from '../src/lib/ip-hash.ts';

const SUPA = 'https://report-route.supabase.co';
const SERIES = '33333333-3333-4333-8333-333333333333';
const IP = '203.0.113.9';
const SECRET = 'ip-hash-test-secret';

const realFetch = globalThis.fetch;
let rpcCalls: { fn: string; args: Record<string, unknown>; profile: string; apikey: string }[] = [];
let turnstileCalls: FormData[] = [];
let rpc: (fn: string) => { status?: number; body: unknown } = () => ({ body: 'received' });
let turnstile: () => unknown = () => ({ success: true, action: 'report' });
let otherFetches: string[] = [];

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      turnstileCalls.push(init?.body as FormData);
      return Response.json(turnstile());
    }
    const m = url.match(/^https:\/\/report-route\.supabase\.co\/rest\/v1\/rpc\/(\w+)$/);
    if (!m) {
      otherFetches.push(url);
      throw new Error(`unexpected fetch ${url}`);
    }
    const headers = init?.headers as Record<string, string>;
    rpcCalls.push({ fn: m[1]!, args: JSON.parse(String(init?.body)), profile: headers['Content-Profile']!, apikey: headers.apikey! });
    const r = rpc(m[1]!);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  rpcCalls = [];
  turnstileCalls = [];
  otherFetches = [];
  rpc = () => ({ body: 'received' });
  turnstile = () => ({ success: true, action: 'report' });
});

function env(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('') } as unknown as Fetcher,
    AI_ASSETS: {} as unknown as R2Bucket,
    STORY_SCENE: {} as unknown as Workflow<{ jobId: string }>,
    APP_ENV: 'development', APP_ORIGIN: 'https://reeltale.net', MEDIA_ORIGIN: 'https://media.reeltale.net',
    SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test',
    CF_ACCOUNT_ID: 'acc', STREAM_CUSTOMER_CODE: '', APPLE_TEAM_ID: 'T', IOS_BUNDLE_ID: 'b', ANDROID_PACKAGE: 'b',
    ANDROID_CERT_SHA256: '', ADMOB_PUBLISHER_ID: 'pub-1', TURNSTILE_SECRET: 'ts-secret', IP_HASH_SECRET: SECRET,
    ...over,
  } as Env;
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
function post(body: unknown, opts: { origin?: string | null; e?: Env; path?: string; method?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP, ...opts.headers };
  if (opts.origin !== null) headers.Origin = opts.origin ?? 'https://reeltale.net';
  return worker.fetch(new Request(`https://reeltale.net${opts.path ?? '/api/report'}`, {
    method: opts.method ?? 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
  }), opts.e ?? env(), ctx);
}

const valid = {
  target_type: 'series', target_id: SERIES, reason: 'copyright', details: 'This is my film, uploaded without my permission.',
  name: 'Ann Example', email: 'ann@example.com', good_faith: true, turnstile_token: 'turnstile-token-ok',
};

test('a notice is stored through the service RPC with a hashed IP, never the address itself', async () => {
  const r = await post(valid);
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { status: 'received' });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal(rpcCalls.length, 1);
  const call = rpcCalls[0]!;
  assert.deepEqual([call.fn, call.profile, call.apikey], ['submit_notice', 'svc', 'sb_secret_test']);
  assert.deepEqual({ ...call.args, p_ip_hash: undefined }, {
    p_target_type: 'series', p_target_id: SERIES, p_reason: 'copyright', p_details: valid.details,
    p_notifier_name: 'Ann Example', p_notifier_email: 'ann@example.com', p_ip_hash: undefined,
  });
  assert.equal(call.args.p_ip_hash, await dailyIpHash(SECRET, IP));
  assert.match(String(call.args.p_ip_hash), /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(call.args).includes(IP), 'the raw address never reaches the database');
  assert.equal(turnstileCalls[0]?.get('remoteip'), IP);
  assert.equal(turnstileCalls[0]?.get('response'), 'turnstile-token-ok');
});

test('the answer is the same whether or not the target exists; the daily cap is a 429', async () => {
  rpc = () => ({ body: 'not_reportable' });
  const r = await post(valid);
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { status: 'received' });
  rpc = () => ({ status: 400, body: { message: 'rate_limited', code: '54000' } });
  const limited = await post(valid);
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: 'rate_limited' });
  rpc = () => ({ status: 400, body: { message: 'relation "app_private.report_notices" does not exist' } });
  const hidden = await post(valid);
  assert.equal(hidden.status, 500);
  assert.deepEqual(await hidden.json(), { error: 'internal_error' });
});

test('child-safety notices may be anonymous; every other notice needs a name and an email', async () => {
  const { name: _n, email: _e, ...anonymous } = valid;
  assert.equal((await post({ ...anonymous, reason: 'minor_safety' })).status, 202);
  assert.deepEqual([rpcCalls[0]?.args.p_notifier_name, rpcCalls[0]?.args.p_notifier_email], [null, null]);
  rpcCalls = [];
  for (const body of [anonymous, { ...valid, email: undefined }, { ...valid, name: undefined }, { ...valid, name: '   ' }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(rpcCalls.length, 0);
});

test('bad bodies are refused before Turnstile or the database', async () => {
  const bad: unknown[] = [
    'not json', {}, { ...valid, good_faith: false }, { ...valid, good_faith: undefined }, { ...valid, details: 'too short' },
    { ...valid, details: 'x'.repeat(2001) }, { ...valid, reason: 'meh' }, { ...valid, target_type: 'comment' },
    { ...valid, target_id: 'not-a-uuid' }, { ...valid, email: 'not-an-email' }, { ...valid, name: 'n'.repeat(101) },
    { ...valid, turnstile_token: '' },
  ];
  for (const body of bad) assert.equal((await post(body)).status, 400, JSON.stringify(body));
  const huge = await post({ ...valid, padding: 'x'.repeat(17 * 1024) });
  assert.equal(huge.status, 413);
  assert.equal(turnstileCalls.length + rpcCalls.length, 0);
});

test('an oversized body is refused without reading it all', async () => {
  // A streamed body (no Content-Length) of 4 MB: reading stops just past the 16 KB cap.
  let pulled = 0;
  const chunk = new Uint8Array(1024).fill(0x20);
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (pulled >= 4 * 1024 * 1024) return ctrl.close();
      pulled += chunk.byteLength;
      ctrl.enqueue(chunk);
    },
  });
  const r = await worker.fetch(new Request('https://reeltale.net/api/report', {
    method: 'POST', headers: { Origin: 'https://reeltale.net', 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
  } as RequestInit), env(), ctx);
  assert.equal(r.status, 413);
  assert.ok(pulled <= 20 * 1024, `read ${pulled} bytes`);

  // A declared Content-Length over the cap is refused before any of the body is read.
  let touched = false;
  const declared = await worker.fetch(new Request('https://reeltale.net/api/report', {
    method: 'POST', headers: { Origin: 'https://reeltale.net', 'Content-Length': String(64 * 1024) },
    body: new ReadableStream({ pull() { touched = true; } }, { highWaterMark: 0 }), duplex: 'half',
  } as RequestInit), env(), ctx);
  assert.equal(declared.status, 413);
  assert.equal(touched, false);
  assert.equal(turnstileCalls.length + rpcCalls.length, 0);
});

test('only our own web origin may post, and only a human (Turnstile with the report action)', async () => {
  for (const origin of [null, 'https://evil.example', 'https://reeltale.net.evil.example']) {
    const r = await post(valid, { origin });
    assert.equal(r.status, 403, String(origin));
    assert.deepEqual(await r.json(), { error: 'web_only' });
  }
  for (const verdict of [{ success: false }, { success: true, action: 'redeem' }]) {
    turnstile = () => verdict;
    const r = await post(valid);
    assert.equal(r.status, 403, JSON.stringify(verdict));
    assert.deepEqual(await r.json(), { error: 'turnstile_failed' });
  }
  assert.equal(rpcCalls.length, 0);
});

test('fails closed when Turnstile or the IP-hash secret is not configured', async () => {
  for (const missing of ['TURNSTILE_SECRET', 'IP_HASH_SECRET'] as const) {
    const r = await post(valid, { e: env({ [missing]: undefined }) });
    assert.equal(r.status, 503, missing);
  }
  assert.equal(turnstileCalls.length + rpcCalls.length, 0);
});

test('only POST /api/report skips user auth; anything next to it still needs a token', async () => {
  const get = await worker.fetch(new Request('https://reeltale.net/api/report'), env(), ctx);
  assert.equal(get.status, 401);
  for (const path of ['/api/report/x', '/api/reports', '/api/report/']) {
    const r = await post(valid, { path });
    assert.equal(r.status, 401, path);
  }
  assert.equal(rpcCalls.length + turnstileCalls.length, 0);
});

test('IP hashes: one bucket per IPv4 address or IPv6 /64, stable within a UTC day, unrelated across days', async () => {
  assert.equal(ipBucket('203.0.113.9'), '203.0.113.9');
  assert.equal(ipBucket('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipBucket('2001:db8:abcd:12:1::5'), '2001:db8:abcd:12::/64');
  assert.equal(ipBucket('2001:0DB8:abcd:0012:ffff:ffff:ffff:1'), '2001:db8:abcd:12::/64');
  assert.equal(ipBucket('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipBucket(null), 'unknown');

  const day = new Date('2026-10-28T00:00:01Z');
  const later = new Date('2026-10-28T23:59:59Z');
  const next = new Date('2026-10-29T00:00:01Z');
  const h = await dailyIpHash(SECRET, '2001:db8:abcd:12:1::5', day);
  assert.equal(await dailyIpHash(SECRET, '2001:db8:abcd:12:ffff::9', later), h, 'same /64, same day');
  assert.notEqual(await dailyIpHash(SECRET, '2001:db8:abcd:12:1::5', next), h, 'a new day, a new hash');
  assert.notEqual(await dailyIpHash(SECRET, '2001:db8:abcd:13::1', day), h, 'another /64');
  assert.notEqual(await dailyIpHash('another-secret', '2001:db8:abcd:12:1::5', day), h, 'the secret matters');
});
