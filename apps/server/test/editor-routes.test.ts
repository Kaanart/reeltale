import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import worker from '../src/app.ts';
import type { Env } from '../src/env.ts';
import { RECREDIT_MAX_PAGES, RECREDIT_PAGE_SIZE } from '../src/routes/editor.ts';

// The JWKS cache is per Supabase URL, so this file uses its own.
const SUPA = 'https://editor-routes.supabase.co';
const USER = '5a5a5a5a-1b1b-4c2c-8d3d-4e4e4e4e4e4e';
const SERIES = '33333333-3333-4333-8333-333333333333';
const EP1 = '55555555-5555-4555-8555-555555555555';
const EP2 = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';

let bearer: string;
const realFetch = globalThis.fetch;
let rpcCalls: { fn: string; args: Record<string, unknown>; profile: string }[] = [];
let role: string | null = 'editor';
let rpc: (fn: string, args: Record<string, unknown>) => { status?: number; body: unknown } = () => ({ body: null });

before(async () => {
  const kp = await generateKeyPair('ES256');
  const jwk: JWK = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' };
  bearer = `Bearer ${await new SignJWT({ role: 'authenticated', age_ok: true })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject(USER).setIssuer(`${SUPA}/auth/v1`)
    .setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(kp.privateKey)}`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${SUPA}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    const m = url.match(/^https:\/\/editor-routes\.supabase\.co\/rest\/v1\/rpc\/(\w+)$/);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
    rpcCalls.push({ fn: m[1]!, args, profile: (init?.headers as Record<string, string>)['Content-Profile']! });
    if (m[1] === 'editor_role') return Response.json(role);
    const r = rpc(m[1]!, args);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  rpcCalls = [];
  role = 'editor';
  rpc = () => ({ body: null });
});

const e = {
  ASSETS: { fetch: async () => new Response('') } as unknown as Fetcher,
  AI_ASSETS: {} as unknown as R2Bucket,
  STORY_SCENE: {} as unknown as Workflow<{ jobId: string }>,
  APP_ENV: 'development', APP_ORIGIN: 'https://reeltale.net', MEDIA_ORIGIN: 'https://media.reeltale.net',
  SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test',
  CF_ACCOUNT_ID: 'acc', STREAM_CUSTOMER_CODE: '', APPLE_TEAM_ID: 'T', IOS_BUNDLE_ID: 'b', ANDROID_PACKAGE: 'b',
  ANDROID_CERT_SHA256: '', ADMOB_PUBLISHER_ID: 'pub-1',
} as Env;

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
function call(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.auth !== false) headers.Authorization = bearer;
  const body = init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  return worker.fetch(new Request(`https://reeltale.net/api/editor${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body }), e, ctx);
}

const takedown = {
  target: 'series', id: SERIES, ground: 'terms', reference: 'Terms §7.2', facts: 'Explicit scenes in episode 1.', report_ids: [12, 13],
};

const requests: [string, { method?: string; body?: unknown }][] = [
  ['/queue', {}],
  ['/verdict', { body: { target: 'series', id: SERIES, version: 2, decision: 'approved' } }],
  ['/takedown', { body: takedown }],
  ['/editors-pick', { body: { series_id: SERIES, on: true } }],
  ['/reports/12/dismiss', { method: 'POST' }],
  ['/nope', {}],
];

test('non-editors get the same bare 403 everywhere, and nothing else is called', async () => {
  for (const r of [null, 'user']) {
    role = r;
    for (const [path, init] of requests) {
      rpcCalls = [];
      const res = await call(path, init);
      assert.equal(res.status, 403, `${r} ${path}`);
      assert.deepEqual(await res.json(), { error: 'forbidden' });
      assert.deepEqual(rpcCalls.map((c) => [c.fn, c.profile, c.args]), [['editor_role', 'svc', { p_user: USER }]]);
    }
  }
  rpcCalls = [];
  for (const [path, init] of requests) assert.equal((await call(path, { ...init, auth: false })).status, 401, path);
  assert.equal(rpcCalls.length, 0);
  role = 'editor';
  const unknown = await call('/nope');
  assert.deepEqual([unknown.status, await unknown.json()], [404, { error: 'not_found' }], 'editors see a plain 404 for unknown paths');
});

test('the queue is the database\'s editor queue', async () => {
  const queue = { items: [{ target: 'series', id: SERIES, version: 2 }], reports: [] };
  rpc = () => ({ body: queue });
  for (const role_ of ['editor', 'admin']) {
    role = role_;
    rpcCalls = [];
    const r = await call('/queue?limit=20');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), queue);
    assert.match(r.headers.get('Cache-Control') ?? '', /no-store/);
    assert.deepEqual(rpcCalls.at(-1), { fn: 'editor_queue', profile: 'svc', args: { p_limit: 20 } });
  }
  await call('/queue');
  assert.deepEqual(rpcCalls.at(-1)?.args, { p_limit: 50 });
  for (const q of ['0', '201', 'x']) assert.equal((await call(`/queue?limit=${q}`)).status, 400, q);
});

test('verdicts are recorded as the signed-in editor, never as anyone named in the body', async () => {
  rpc = () => ({ body: 'applied' });
  const r = await call('/verdict', { body: { target: 'episode', id: EP1, version: 3, decision: 'rejected', categories: ['sexual'],
    reason: 'explicit', editor: OTHER, p_editor: OTHER } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { outcome: 'applied' });
  // svc.editor_verdict (not record_verdict directly): it refuses the editor's own content.
  assert.deepEqual(rpcCalls.at(-1), { fn: 'editor_verdict', profile: 'svc', args: {
    p_target: 'episode', p_id: EP1, p_version: 3, p_decision: 'rejected', p_categories: ['sexual'], p_reason: 'explicit',
    p_editor: USER } });
  rpc = () => ({ status: 403, body: { message: 'conflict_of_interest', code: '42501' } });
  const own = await call('/verdict', { body: { target: 'series', id: SERIES, version: 2, decision: 'approved' } });
  assert.deepEqual([own.status, await own.json()], [403, { error: 'conflict_of_interest' }]);
  rpcCalls = [];
  for (const body of [
    { target: 'series', id: SERIES, version: 2, decision: 'needs_editor' },
    { target: 'comment', id: SERIES, version: 2, decision: 'approved' },
    { target: 'series', id: 'nope', version: 2, decision: 'approved' },
    { target: 'series', id: SERIES, version: -1, decision: 'approved' },
    { target: 'series', id: SERIES, version: 2, decision: 'approved', categories: ['Not A Category'] },
    { target: 'series', id: SERIES, version: 2, decision: 'approved', reason: 'r'.repeat(301) },
  ]) {
    assert.equal((await call('/verdict', { body })).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(rpcCalls.map((c) => c.fn), Array(6).fill('editor_role'));
});

test('a takedown re-credits buyers in bounded pages and returns what is left to repeat', async () => {
  const pages: string[] = [];
  rpc = (fn, args) => {
    if (fn === 'take_down') return { body: { outcome: 'removed', recredit: [EP1, EP2], reports_resolved: 2 } };
    pages.push(String(args.p_episode));
    // EP1: one full page, then the rest, then nothing left. EP2: never finishes within this request.
    if (args.p_episode === EP1) return { body: [RECREDIT_PAGE_SIZE, 3, 0][pages.filter((p) => p === EP1).length - 1] };
    return { body: RECREDIT_PAGE_SIZE };
  };
  const r = await call('/takedown', { body: { ...takedown, editor: OTHER } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { outcome: 'removed', reports_resolved: 2, remaining: [EP2] });
  assert.deepEqual(rpcCalls[1], { fn: 'take_down', profile: 'svc', args: {
    p_target: 'series', p_id: SERIES, p_editor: USER, p_ground: 'terms', p_reference: 'Terms §7.2',
    p_facts: 'Explicit scenes in episode 1.', p_report_ids: [12, 13] } });
  assert.equal(pages.length, RECREDIT_MAX_PAGES, 'never more pages than the budget');
  assert.deepEqual(rpcCalls.filter((c) => c.fn === 'recredit_episode').map((c) => c.args)[0],
    { p_episode: EP1, p_reason: 'moderation', p_limit: RECREDIT_PAGE_SIZE });

  // Repeating finds the takedown done and only the re-crediting left.
  rpc = (fn) => ({ body: fn === 'take_down' ? { outcome: 'already_removed', recredit: [EP2], reports_resolved: 0 } : 0 });
  const again = await call('/takedown', { body: takedown });
  assert.deepEqual(await again.json(), { outcome: 'already_removed', reports_resolved: 0, remaining: [] });
});

test('a short re-credit page is not the end: only 0 is (a concurrent run may have taken part of the page)', async () => {
  const answers = [150, RECREDIT_PAGE_SIZE, 40, 0];
  rpc = (fn) => (fn === 'take_down'
    ? { body: { outcome: 'already_removed', recredit: [EP1], reports_resolved: 0 } }
    : { body: answers.shift() });
  const r = await call('/takedown', { body: { ...takedown, target: 'episode', id: EP1 } });
  assert.deepEqual(await r.json(), { outcome: 'already_removed', reports_resolved: 0, remaining: [] });
  assert.equal(rpcCalls.filter((c) => c.fn === 'recredit_episode').length, 4);
  assert.deepEqual(answers, []);
});

test('a failed re-credit page stops the loop and leaves those episodes for the next try', async () => {
  rpc = (fn, args) => {
    if (fn === 'take_down') return { body: { outcome: 'removed', recredit: [EP1, EP2], reports_resolved: 0 } };
    return args.p_episode === EP1 ? { status: 503, body: { message: 'timeout' } } : { body: 0 };
  };
  const r = await call('/takedown', { body: { ...takedown, target: 'episode', id: EP1, report_ids: undefined } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { outcome: 'removed', reports_resolved: 0, remaining: [EP1, EP2] });
  assert.equal(rpcCalls.filter((c) => c.fn === 'recredit_episode').length, 1);
  assert.deepEqual(rpcCalls[1]?.args.p_report_ids, []);
});

test('takedown bodies are validated: target, ground and a statement of reasons are required', async () => {
  for (const body of [
    { ...takedown, target: 'profile' }, { ...takedown, ground: 'feelings' }, { ...takedown, reference: '  ' },
    { ...takedown, facts: '' }, { ...takedown, facts: 'f'.repeat(2001) }, { ...takedown, report_ids: [0] },
    { ...takedown, report_ids: Array(101).fill(1) }, { ...takedown, id: undefined }, 'not json',
  ]) {
    assert.equal((await call('/takedown', { body })).status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.ok(rpcCalls.every((c) => c.fn === 'editor_role'));
});

test('Editor\'s Pick and dismissals pass the editor from the token', async () => {
  rpc = () => ({ body: 'applied' });
  assert.equal((await call('/editors-pick', { body: { series_id: SERIES, on: false, note: ' Withdrawn ' } })).status, 200);
  assert.deepEqual(rpcCalls.at(-1)?.args, { p_series: SERIES, p_on: false, p_editor: USER, p_note: 'Withdrawn' });
  for (const body of [{ series_id: SERIES }, { series_id: SERIES, on: 'yes' }, { series_id: 'x', on: true }]) {
    assert.equal((await call('/editors-pick', { body })).status, 400, JSON.stringify(body));
  }

  rpc = () => ({ body: 'dismissed' });
  const d = await call('/reports/42/dismiss', { method: 'POST' });
  assert.deepEqual([d.status, await d.json()], [200, { outcome: 'dismissed' }]);
  assert.deepEqual(rpcCalls.at(-1)?.args, { p_report: 42, p_editor: USER, p_note: null });
  await call('/reports/42/dismiss', { body: { note: 'Parody, clearly labelled.' } });
  assert.deepEqual(rpcCalls.at(-1)?.args, { p_report: 42, p_editor: USER, p_note: 'Parody, clearly labelled.' });
  rpcCalls = [];
  for (const id of ['0', '-1', 'abc', '1e3', '9999999999999999']) {
    assert.equal((await call(`/reports/${id}/dismiss`, { method: 'POST' })).status, 400, id);
  }
  assert.equal((await call('/reports/42/dismiss', { body: 'not json' })).status, 400);
  assert.equal((await call('/reports/42/dismiss', { body: { note: 'n'.repeat(2001) } })).status, 400);
  assert.ok(rpcCalls.every((c) => c.fn === 'editor_role'));
});

test('database errors map to safe statuses', async () => {
  const cases: [string, string, number][] = [
    ['set_editors_pick', 'not_eligible', 409],
    ['set_editors_pick', 'conflict_of_interest', 403],
    ['set_editors_pick', 'not_found', 404],
    ['dismiss_report', 'report_not_found', 404],
    ['take_down', 'report_mismatch', 409],
    ['take_down', 'invalid_statement', 400],
    ['take_down', 'not_an_editor', 403],
    ['take_down', 'permission denied for schema app_private', 500],
  ];
  const paths: Record<string, [string, unknown]> = {
    set_editors_pick: ['/editors-pick', { series_id: SERIES, on: true }],
    dismiss_report: ['/reports/7/dismiss', {}],
    take_down: ['/takedown', takedown],
  };
  for (const [fn, message, status] of cases) {
    rpc = () => ({ status: 400, body: { message, code: 'P0001' } });
    const [path, body] = paths[fn]!;
    const r = await call(path, { body });
    assert.equal(r.status, status, message);
    assert.deepEqual(await r.json(), { error: status === 500 ? 'internal_error' : message });
  }
  // If the role check itself fails, nobody gets in.
  const roleFails = { ...e, SUPABASE_SECRET_KEY: undefined } as Env;
  const r = await worker.fetch(new Request('https://reeltale.net/api/editor/queue', { headers: { Authorization: bearer } }), roleFails, ctx);
  assert.equal(r.status, 503);
});
