import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/app.ts';
import type { Env } from '../src/env.ts';
import { hmacSha256Hex } from '../src/lib/crypto.ts';
import { sweepIngest } from '../src/webhooks/stream.ts';

// Each test file mocks fetch for its own Supabase URL.
const SUPA = 'https://stream-webhook.supabase.co';
const SECRET = 'whsec_test';
const EP = '66666666-6666-4666-8666-666666666666';
const UID = 'd'.repeat(32);

const realFetch = globalThis.fetch;
let rpcCalls: { fn: string; args: Record<string, unknown>; profile: string }[] = [];
let rpc: (fn: string, args: Record<string, unknown>) => { status?: number; body: unknown } = () => ({ body: null });

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const m = url.match(/^https:\/\/stream-webhook\.supabase\.co\/rest\/v1\/rpc\/(\w+)$/);
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

function env(over: { create?: () => Promise<unknown>; get?: () => Promise<unknown> } = {}) {
  const created: { id: string; params: unknown }[] = [];
  const e = {
    ASSETS: { fetch: async () => new Response('') } as unknown as Fetcher,
    EPISODE_INGEST: {
      async create(o: { id: string; params: unknown }) {
        if (over.create) await over.create();
        created.push(o);
        return { id: o.id };
      },
      async get(id: string) {
        if (over.get) return over.get();
        throw new Error(`instance ${id} not found`);
      },
    } as unknown as Workflow<{ episodeId: string; assetId: string }>,
    APP_ENV: 'development', APP_ORIGIN: 'https://reeltale.net', MEDIA_ORIGIN: 'https://media.reeltale.net',
    SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test',
    STREAM_WEBHOOK_SECRET: SECRET, CF_ACCOUNT_ID: 'acc', STREAM_CUSTOMER_CODE: '', APPLE_TEAM_ID: 'T', IOS_BUNDLE_ID: 'b',
    ANDROID_PACKAGE: 'b', ANDROID_CERT_SHA256: '', ADMOB_PUBLISHER_ID: 'pub-1',
  } as Env;
  return { e, created };
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

async function deliver(e: Env, over: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    uid: UID, readyToStream: true, status: { state: 'ready' }, duration: 44.6,
    meta: { episode_id: EP, env: 'development', kind: 'episode' }, ...over,
  });
  const time = Math.floor(Date.now() / 1000);
  const sig = await hmacSha256Hex(SECRET, `${time}.${body}`);
  const res = await worker.fetch(new Request('https://reeltale.net/api/webhooks/stream', {
    method: 'POST', body, headers: { 'Webhook-Signature': `time=${time},sig1=${sig}` },
  }), e, ctx);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

const refused = { status: 400, body: { message: 'episode_not_accepting_media', code: '22023' } };

test('a ready upload is attached and its ingest workflow started, one instance per upload', async () => {
  rpc = () => ({ body: null });
  const { e, created } = env();
  assert.deepEqual(await deliver(e), { status: 200, body: { ok: true } });
  assert.deepEqual(rpcCalls, [{
    fn: 'attach_episode_media', profile: 'svc',
    args: { p_episode: EP, p_provider: 'cf_stream', p_asset_id: UID, p_duration_s: 45, p_poster_key: null, p_preview_key: null, p_manifest_key: null },
  }]);
  assert.deepEqual(created, [{ id: `ingest-${UID}`, params: { episodeId: EP, assetId: UID } }]);
});

test('a redelivered webhook for media that is already attached starts the workflow again; an existing instance is fine', async () => {
  rpc = (fn) => fn === 'attach_episode_media' ? refused : { body: { asset_id: UID, provider: 'cf_stream', status: 'ready' } };
  const first = env();
  assert.deepEqual(await deliver(first.e), { status: 200, body: { ok: true } });
  assert.deepEqual(rpcCalls.map((c) => [c.fn, c.args.p_episode]), [['attach_episode_media', EP], ['ingest_context', EP]]);
  assert.deepEqual(first.created.map((c) => c.id), [`ingest-${UID}`]);

  const exists = env({ create: async () => { throw new Error('instance.already_exists: Instance already exists'); } });
  assert.deepEqual(await deliver(exists.e), { status: 200, body: { ok: true } });

  // Whatever the error text says, an instance we can find means it was started before.
  const found = env({ create: async () => { throw new Error('conflict'); }, get: async () => ({ id: `ingest-${UID}` }) });
  assert.deepEqual(await deliver(found.e), { status: 200, body: { ok: true } });
});

test('a refused upload is acknowledged and ignored, and starts nothing', async () => {
  for (const ctxBody of [
    { asset_id: 'e'.repeat(32), provider: 'cf_stream', status: 'ready' },   // another upload is the media
    { asset_id: UID, provider: 'cf_stream', status: 'published' },          // approved media is never re-processed
    null,
  ]) {
    rpc = (fn) => fn === 'attach_episode_media' ? refused : { body: ctxBody };
    const { e, created } = env();
    assert.deepEqual(await deliver(e), { status: 200, body: { ok: true, ignored: 'episode_not_accepting_media' } });
    assert.deepEqual(created, []);
  }
});

test('if the workflow cannot be started (or the check fails), Stream is asked to deliver again', async () => {
  rpc = () => ({ body: null });
  const broken = env({ create: async () => { throw new Error('workflows unavailable'); } });
  assert.deepEqual(await deliver(broken.e), { status: 500, body: { error: 'processing_failed' } });

  rpc = (fn) => fn === 'attach_episode_media' ? refused : { status: 503, body: { message: 'upstream' } };
  const { e, created } = env();
  assert.deepEqual(await deliver(e), { status: 500, body: { error: 'processing_failed' } });
  assert.deepEqual(created, []);

  rpc = () => ({ status: 500, body: { message: 'boom' } });
  assert.deepEqual(await deliver(env().e), { status: 500, body: { error: 'processing_failed' } });
});

test('the cron backstop starts the ingest of uploads still waiting for a first review after 10 minutes', async () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const old = '2026-10-28T11:30:00Z';
  const items = [
    { target: 'episode', id: EP, version: 2, since: old, content: { provider: 'cf_stream', asset_id: UID } },
    { target: 'episode', id: '77777777-7777-4777-8777-777777777777', version: 1, since: '2026-10-28T11:55:00Z', content: { provider: 'cf_stream', asset_id: 'f'.repeat(32) } },
    { target: 'episode', id: '88888888-8888-4888-8888-888888888888', version: 1, since: old, content: { provider: 'cf_stream', asset_id: '../x' } },
    { target: 'episode', id: '99999999-9999-4999-8999-999999999999', version: 1, since: old, content: { provider: 'r2_manifest', asset_id: null } },
  ];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = { async rpc<T>(fn: string, args: Record<string, unknown>) { calls.push({ fn, args }); return items as T; } };
  const { e, created } = env();
  assert.equal(await sweepIngest(e, db, now), 1);
  assert.deepEqual(calls, [{ fn: 'moderation_queue', args: { p_limit: 20, p_targets: ['episode'], p_for_editor: false } }]);
  assert.deepEqual(created, [{ id: `ingest-${UID}`, params: { episodeId: EP, assetId: UID } }]);

  const running = env({ create: async () => { throw new Error('Instance already exists'); } });
  assert.equal(await sweepIngest(running.e, db, now), 0, 'a running ingest is left alone');
});

test('the cron hands an upload to an editor when its ingest stopped without a verdict; a live ingest is left alone', async () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const item = { target: 'episode', id: EP, version: 2, since: '2026-10-28T11:30:00Z', content: { provider: 'cf_stream', asset_id: UID } };
  const waiting = { episode_id: EP, content_version: 3, asset_id: UID, provider: 'cf_stream', status: 'ready', moderation_status: 'pending', awaiting_editor: false };
  const sweep = async (status: string, ctxBody: unknown = waiting) => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const db = {
      async rpc<T>(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return (fn === 'moderation_queue' ? [item] : fn === 'ingest_context' ? ctxBody : 'held') as T;
      },
    };
    const { e, created } = env({
      create: async () => { throw new Error('Instance already exists'); },
      get: async () => ({ id: `ingest-${UID}`, status: async () => ({ status }) }),
    });
    assert.equal(await sweepIngest(e, db, now), 0);
    assert.deepEqual(created, []);
    return calls.filter((c) => c.fn === 'record_verdict').map((c) => c.args);
  };
  // A run that failed (the database was down), or ended before a later title change: nobody would
  // ever review this version, so an editor gets it (no model call, model null in the log).
  for (const status of ['errored', 'terminated', 'complete']) {
    assert.deepEqual(await sweep(status), [{
      p_target: 'episode', p_id: EP, p_version: 3, p_source: 'auto', p_model: null, p_decision: 'needs_editor',
      p_categories: [], p_reason: 'ingest_stopped', p_editor: null,
    }], status);
  }
  for (const status of ['queued', 'running', 'waiting', 'paused']) assert.deepEqual(await sweep(status), [], status);
  // The episode moved on since the queue was read: nothing is recorded.
  for (const ctxBody of [{ ...waiting, awaiting_editor: true }, { ...waiting, moderation_status: 'approved' }, { ...waiting, asset_id: 'e'.repeat(32) }, null]) {
    assert.deepEqual(await sweep('complete', ctxBody), []);
  }
});

test('uploads for the other environment, unready videos and bad signatures change nothing', async () => {
  rpc = () => { throw new Error('no database call expected'); };
  const { e, created } = env();
  assert.deepEqual((await deliver(e, { meta: { episode_id: EP, env: 'production', kind: 'episode' } })).body, { ok: true, ignored: 'other_env' });
  assert.deepEqual((await deliver(e, { readyToStream: false })).body, { ok: true, ignored: 'not_ready' });
  const res = await worker.fetch(new Request('https://reeltale.net/api/webhooks/stream', {
    method: 'POST', body: '{}', headers: { 'Webhook-Signature': `time=${Math.floor(Date.now() / 1000)},sig1=00` },
  }), e, ctx);
  assert.equal(res.status, 401);
  assert.deepEqual(created, []);
  assert.deepEqual(rpcCalls, []);
});
