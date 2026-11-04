import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import worker from '../src/app.ts';
import type { Env } from '../src/env.ts';
import { MetaApiError } from '../src/ai/meta.ts';
import { checkWav, cleanTranscript, metaFailure, TRANSCRIPT_MAX_CHARS, VOICE_MAX_BYTES } from '../src/routes/voice.ts';
// The app's own encoder and checker: what the browser sends must pass here (contract test).
import { checkWav as appCheckWav, encodeWav } from '../../mobile/src/core/wav.ts';

// POST /api/ai/transcribe (src/routes/voice.ts): auth, audio checks before anything else, the voice consent in
// the database, Muse Voice Transcribe through the Meta client, and nothing but { text } back.

// The JWKS cache is per Supabase URL, so this file uses its own.
const SUPA = 'https://voice-route.supabase.co';
const USER = '6a1d0c5e-2b3f-4c4d-9e8f-1a2b3c4d5e6f';
const META_KEY = 'meta-test-key-not-real';

let jwk: JWK;
let bearer: string;
const realFetch = globalThis.fetch;
const realLog = console.log;
const realError = console.error;
let logs: string[] = [];
let rpcCalls: { fn: string; args: Record<string, unknown>; profile: string }[] = [];
let rpc: (fn: string, args: Record<string, unknown>) => { status?: number; body: unknown } = () => ({ body: true });
let metaCalls: { auth: string | null; request: Record<string, unknown>; audio: Uint8Array; filename: string | null }[] = [];
let meta: () => Response | Promise<Response> = () => Response.json({ transcript: 'the second one', audioDurationMs: 1000, turns: [] });

before(async () => {
  const kp = await generateKeyPair('ES256');
  jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' };
  bearer = `Bearer ${await new SignJWT({ role: 'authenticated', age_ok: true })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject(USER).setIssuer(`${SUPA}/auth/v1`)
    .setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(kp.privateKey)}`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${SUPA}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    const m = url.match(/^https:\/\/voice-route\.supabase\.co\/rest\/v1\/rpc\/(\w+)$/);
    if (m) {
      const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
      rpcCalls.push({ fn: m[1]!, args, profile: (init?.headers as Record<string, string>)['Content-Profile']! });
      const r = rpc(m[1]!, args);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }
    if (url === 'https://api.meta.ai/v1/asr/transcribe') {
      assert.ok(init?.signal, 'every Meta call has a time limit');
      const form = init?.body as FormData;
      const audio = form.get('audio') as unknown as File;
      metaCalls.push({
        auth: new Headers(init?.headers).get('Authorization'),
        request: JSON.parse(await (form.get('request') as unknown as Blob).text()) as Record<string, unknown>,
        audio: new Uint8Array(await audio.arrayBuffer()),
        filename: audio.name ?? null,
      });
      return meta();
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
});
after(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.error = realError;
});
beforeEach(() => {
  rpcCalls = [];
  metaCalls = [];
  logs = [];
  rpc = () => ({ body: true });
  meta = () => Response.json({ transcript: 'the second one', audioDurationMs: 1000, turns: [] });
});

function env(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher,
    APP_ENV: 'development', APP_ORIGIN: 'https://reeltale.net', MEDIA_ORIGIN: 'https://media.reeltale.net',
    SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test',
    CF_ACCOUNT_ID: 'acc', STREAM_CUSTOMER_CODE: '', APPLE_TEAM_ID: 'T', IOS_BUNDLE_ID: 'b', ANDROID_PACKAGE: 'b',
    ANDROID_CERT_SHA256: '', ADMOB_PUBLISHER_ID: 'pub-1', META_API_KEY: META_KEY,
    ...over,
  } as Env;
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
function post(e: Env, body: BodyInit | null, init: { type?: string | null; auth?: boolean; headers?: Record<string, string>; method?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.type !== null) headers['Content-Type'] = init.type ?? 'audio/wav';
  if (init.auth !== false) headers.Authorization = bearer;
  return worker.fetch(new Request('https://reeltale.net/api/ai/transcribe', { method: init.method ?? 'POST', headers, body }), e, ctx);
}

/** A WAV of `ms` milliseconds at `rate`, from the app's encoder. */
const wavOf = (ms: number, rate = 16_000) => encodeWav(new Int16Array(Math.round((rate * ms) / 1000)).fill(1000), rate);

test('a signed-in adult with voice consent gets { text } and nothing else', async () => {
  const wav = wavOf(1500);
  const r = await post(env(), wav);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { text: 'the second one' });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(rpcCalls, [{ fn: 'voice_allowed', args: { p_user: USER }, profile: 'svc' }]);
  assert.equal(metaCalls.length, 1);
  const call = metaCalls[0]!;
  assert.equal(call.auth, `Bearer ${META_KEY}`);
  assert.equal(call.request.model, 'muse-voice-transcribe-1.0');
  assert.equal(call.request.audioEncoding, 'WAV');
  assert.deepEqual(call.audio, wav, 'the recording is sent as it came');
});

test('the logs carry lengths and latency only: no words, no ids, no keys', async () => {
  meta = () => Response.json({ transcript: 'my secret plan is the third one', audioDurationMs: 2000, turns: [] });
  assert.equal((await post(env(), wavOf(2000))).status, 200);
  meta = () => new Response(JSON.stringify({ error: { code: 'server_error', message: 'upstream said the third one' } }), { status: 500 });
  assert.equal((await post(env(), wavOf(2000))).status, 503);
  const all = logs.join('\n');
  assert.match(all, /audio_ms/);
  assert.match(all, /latency_ms/);
  for (const secret of ['secret plan', 'third one', USER, META_KEY, bearer.slice(7)]) assert.ok(!all.includes(secret), secret);
});

test('without a valid session nothing is read, checked or sent', async () => {
  const r = await post(env(), wavOf(1000), { auth: false });
  assert.equal(r.status, 401);
  assert.equal(rpcCalls.length + metaCalls.length, 0);
});

test('no voice consent (or not a live adult): 403 voice_consent_required, nothing sent to Meta', async () => {
  rpc = () => ({ body: false });
  const r = await post(env(), wavOf(1000));
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'voice_consent_required' });
  assert.equal(rpcCalls.length, 1);
  assert.equal(metaCalls.length, 0);
});

test('anything but a short PCM16 mono WAV is refused before the database or Meta', async () => {
  const e = env();
  const stereo = wavOf(1000);
  new DataView(stereo.buffer).setUint16(22, 2, true);
  const float = wavOf(1000);
  new DataView(float.buffer).setUint16(20, 3, true);
  const cases: [BodyInit | null, string | null, number, string][] = [
    [wavOf(1000), 'application/json', 415, 'unsupported_media_type'],
    [wavOf(1000), 'audio/mpeg', 415, 'unsupported_media_type'],
    [wavOf(1000), null, 415, 'unsupported_media_type'],
    [new TextEncoder().encode('{"text":"hi"}'), 'audio/wav', 400, 'bad_audio'],
    [new Uint8Array(0), 'audio/wav', 400, 'bad_audio'],
    [stereo, 'audio/wav', 400, 'bad_audio'],
    [float, 'audio/wav', 400, 'bad_audio'],
    [wavOf(1000, 96_000), 'audio/wav', 400, 'bad_audio'],
    [wavOf(50), 'audio/wav', 400, 'bad_audio'],
    [wavOf(10_500), 'audio/wav', 400, 'audio_too_long'],
    [wavOf(1000).slice(0, 2000), 'audio/wav', 400, 'bad_audio'],
  ];
  for (const [body, type, status, error] of cases) {
    const r = await post(e, body, { type });
    assert.equal(r.status, status, `${type} ${error}`);
    assert.deepEqual(await r.json(), { error }, `${type} ${error}`);
  }
  assert.equal((await post(e, wavOf(1000), { type: 'audio/wav; codecs=1' })).status, 200, 'parameters are fine');
  assert.equal(rpcCalls.length, 1, 'only the last, valid one reached the database');
});

test('bodies over 600 KB are refused, by header or by what is actually sent', async () => {
  const e = env();
  const big = new Uint8Array(VOICE_MAX_BYTES + 1);
  const r1 = await post(e, wavOf(1000), { headers: { 'Content-Length': String(VOICE_MAX_BYTES + 1) } });
  assert.equal(r1.status, 413);
  assert.deepEqual(await r1.json(), { error: 'audio_too_large' });
  // A stream with no length that keeps going.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(big.subarray(0, 400_000));
      controller.enqueue(big.subarray(400_000));
      controller.close();
    },
  });
  const r2 = await worker.fetch(new Request('https://reeltale.net/api/ai/transcribe', {
    method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: bearer }, body: stream, duplex: 'half',
  } as RequestInit), e, ctx);
  assert.equal(r2.status, 413);
  // 48 kHz for 8 s is 768 KB: too big even though it is short enough.
  assert.equal((await post(e, wavOf(8000, 48_000))).status, 413);
  assert.equal(rpcCalls.length + metaCalls.length, 0);
});

test('Meta failures become safe codes; nothing of Meta’s message reaches the app', async () => {
  const e = env();
  const cases: [() => Response | Promise<Response>, number, string][] = [
    [() => Response.json({ error: { code: 'server_error', message: 'internal detail' } }, { status: 503 }), 503, 'transcribe_unavailable'],
    [() => Response.json({ error: { code: 'rate_limit', message: 'slow down' } }, { status: 429 }), 503, 'transcribe_unavailable'],
    [() => Response.json({ error: { code: 'invalid_api_key', message: 'bad key' } }, { status: 401 }), 503, 'transcribe_unavailable'],
    [() => Response.json({ error: { code: 'invalid_audio', message: 'could not decode' } }, { status: 400 }), 422, 'audio_unreadable'],
    [() => Response.json({ error: { code: 'content_policy_violation', message: 'no' } }, { status: 400 }), 422, 'audio_unreadable'],
    [() => { throw new TypeError('connection reset'); }, 503, 'transcribe_unavailable'],
  ];
  for (const [respond, status, error] of cases) {
    meta = respond;
    const r = await post(e, wavOf(1000));
    assert.equal(r.status, status, error);
    assert.deepEqual(await r.json(), { error }, error);
  }
});

test('no Meta key: 503 before the database is asked; a database outage is not a consent refusal', async () => {
  const r = await post(env({ META_API_KEY: undefined }), wavOf(1000));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'transcribe_unavailable' });
  assert.equal(rpcCalls.length, 0);

  rpc = () => ({ status: 503, body: { message: 'upstream' } });
  const down = await post(env(), wavOf(1000));
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { error: 'service_unavailable' });
  rpc = () => ({ status: 400, body: { message: 'relation "x" does not exist', code: '42P01' } });
  assert.equal((await post(env(), wavOf(1000))).status, 500);
  assert.equal(metaCalls.length, 0);
});

test('the AI rate limit applies, and only POST exists', async () => {
  const limited = env({ RATE_LIMIT_AI: { limit: async () => ({ success: false }) } as unknown as RateLimit });
  const r = await post(limited, wavOf(1000));
  assert.equal(r.status, 429);
  assert.equal(rpcCalls.length + metaCalls.length, 0);
  const get = await worker.fetch(new Request('https://reeltale.net/api/ai/transcribe', { headers: { Authorization: bearer } }), env(), ctx);
  assert.equal(get.status, 404);
});

test('the transcript is folded, stripped of control characters and cut short', async () => {
  meta = () => Response.json({ transcript: '  The\nsecond\u0000 one  ', audioDurationMs: 1000, turns: [] });
  assert.deepEqual(await (await post(env(), wavOf(1000))).json(), { text: 'The second one' });
  assert.equal(cleanTranscript('x'.repeat(TRANSCRIPT_MAX_CHARS + 50)).length, TRANSCRIPT_MAX_CHARS);
  meta = () => Response.json({ audioDurationMs: 1000 });
  assert.deepEqual(await (await post(env(), wavOf(1000))).json(), { text: '' }, 'nothing heard');
});

test('every response lets our own pages use the microphone, and nobody else', async () => {
  const api = await post(env(), wavOf(1000));
  assert.match(api.headers.get('Permissions-Policy') ?? '', /(^|, )microphone=\(self\)(,|$)/);
  const page = await worker.fetch(new Request('https://reeltale.net/story/x'), env(), ctx);
  assert.match(page.headers.get('Permissions-Policy') ?? '', /microphone=\(self\)/);
  assert.match(page.headers.get('Content-Security-Policy') ?? '', /script-src 'self' https:\/\/challenges\.cloudflare\.com;/, 'CSP unchanged');
});

test('the server and the app agree on what a good recording is', () => {
  for (const ms of [100, 300, 1000, 8000, 10_000]) {
    const wav = wavOf(ms);
    assert.deepEqual(checkWav(wav), appCheckWav(wav), `${ms} ms`);
    assert.equal(checkWav(wav).ok, true, `${ms} ms`);
  }
  for (const rate of [8000, 22_050, 44_100, 48_000]) assert.equal(checkWav(wavOf(1000, rate)).ok, true, `${rate} Hz`);
  for (const bad of [wavOf(50), wavOf(10_100), wavOf(1000, 7000), new Uint8Array(44)]) {
    assert.deepEqual(checkWav(bad), appCheckWav(bad));
    assert.equal(checkWav(bad).ok, false);
  }
});

test('metaFailure keeps Meta’s words out of the answer', () => {
  assert.deepEqual(metaFailure(new MetaApiError(503, 'x', 'secret detail', true)), { status: 503, error: 'transcribe_unavailable', log: 'meta 503 x' });
  assert.equal(metaFailure(new DOMException('t', 'TimeoutError')).log, 'meta request timed out');
});
