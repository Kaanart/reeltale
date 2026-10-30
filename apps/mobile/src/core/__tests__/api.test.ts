import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import {
  ApiError, assetFileFromKey, createApiClient, isAbortError, isApiError, isSceneAssetFile, panelAssetFiles,
  type ApiClientOptions,
} from '../api.ts';
import { makeManifest, SCENE_ID, STORY_ID } from './comic-fixture.ts';

const BASE = 'https://reeltale.net';
const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln-_x';
const EP = '33333333-3333-4333-8333-333333333333';
const JOB = '44444444-4444-4444-8444-444444444444';

interface Call { url: string; init: RequestInit & { headers: Record<string, string> } }

/** A fake fetch that records requests and answers with whatever `answer` returns. */
function fake(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init as Call['init'] };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(answer: (call: Call) => Response | Promise<Response>, over: Partial<ApiClientOptions> = {}) {
  const f = fake(answer);
  const api = createApiClient({ baseUrl: BASE, getAccessToken: () => TOKEN, fetchImpl: f.fetchImpl, ...over });
  return { api, calls: f.calls };
}

async function fails(p: Promise<unknown>, status: number, code: string, detail?: number): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    assert.equal(err.detail, detail);
    assert.equal(err.message, code, 'the message is the code, never server text');
    return err;
  }
  throw new assert.AssertionError({ message: `expected ApiError ${code}, but the call succeeded` });
}

// ---- Construction --------------------------------------------------------------------------------

test('baseUrl must be an https origin (http only for local development hosts)', () => {
  const make = (baseUrl: string) => createApiClient({ baseUrl, getAccessToken: () => TOKEN, fetchImpl: fake(() => json({})).fetchImpl });
  for (const bad of ['http://reeltale.net', 'reeltale.net', 'ftp://reeltale.net', 'https://reeltale.net/api', 'https://u:p@reeltale.net',
    'https://reeltale.net?x=1', 'https://', '', 'http://localhost.evil.com', 'http://evil.com/localhost', 'javascript:alert(1)']) {
    assert.throws(() => make(bad), TypeError, `should refuse ${JSON.stringify(bad)}`);
  }
  for (const good of ['https://reeltale.net', 'https://reeltale.net/', 'https://staging.reeltale.net', 'http://localhost:8787',
    'http://127.0.0.1:8787', 'http://10.0.2.2:8787', 'http://[::1]:8787', 'http://dev.localhost:3000']) {
    assert.doesNotThrow(() => make(good), good);
  }
});

test('the trailing slash of baseUrl is dropped and the scheme lower-cased', async () => {
  const { api, calls } = client(() => json({ ok: true, env: 'production' }), { baseUrl: 'HTTPS://reeltale.net/' });
  await api.health();
  assert.equal(calls[0]?.url, 'https://reeltale.net/api/health');
});

// ---- Requests: auth, headers, safety -------------------------------------------------------------

test('health needs no token and sends none', async () => {
  let asked = 0;
  const { api, calls } = client(() => json({ ok: true, env: 'production' }), { getAccessToken: () => { asked++; return TOKEN; } });
  assert.deepEqual(await api.health(), { ok: true, env: 'production' });
  assert.equal(asked, 0);
  assert.equal(calls[0]?.init.headers.Authorization, undefined);
  assert.equal(calls[0]?.init.method, 'GET');
});

test('signed-in calls send the Bearer token and ask for JSON, without cookies or redirects', async () => {
  const { api, calls } = client(() => json({ hls: 'https://customer-x.cloudflarestream.com/tok/manifest/video.m3u8', expires_at: 1790000000 }));
  await api.getPlayback(EP);
  const c = calls[0]!;
  assert.equal(c.url, `${BASE}/api/playback/${EP}`);
  assert.equal(c.init.method, 'GET');
  assert.equal(c.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(c.init.headers.Accept, 'application/json');
  assert.equal(c.init.headers['Content-Type'], undefined);
  assert.equal(c.init.body, undefined);
  assert.equal(c.init.credentials, 'omit');
  assert.equal(c.init.redirect, 'error');
});

test('the token is read fresh for every call (it may have been refreshed)', async () => {
  let n = 0;
  const { api, calls } = client(() => json({ ok: true }), { getAccessToken: async () => `tok${++n}` });
  await api.chooseScene(SCENE_ID, 'a').catch(() => {});
  await api.chooseScene(SCENE_ID, 'a').catch(() => {});
  assert.deepEqual(calls.map((c) => c.init.headers.Authorization), ['Bearer tok1', 'Bearer tok2']);
});

test('no token: nothing is sent, and the error says so', async () => {
  for (const missing of [null, '']) {
    const { api, calls } = client(() => json({}), { getAccessToken: () => missing });
    await fails(api.getPlayback(EP), 401, 'missing_token');
    assert.equal(calls.length, 0);
  }
});

test('a token that is not a plain JWT is never put in a header', async () => {
  for (const bad of ['a b', 'tok\r\nX-Evil: 1', 'tok\n', 'tok"', 'ünï']) {
    const { api, calls } = client(() => json({}), { getAccessToken: () => bad });
    await fails(api.getPlayback(EP), 401, 'invalid_token');
    assert.equal(calls.length, 0);
  }
});

test('a token getter that fails is reported as not signed in, not as a network problem', async () => {
  const { api, calls } = client(() => json({}), { getAccessToken: async () => { throw new Error('keychain locked'); } });
  await fails(api.getPlayback(EP), 401, 'not_authenticated');
  assert.equal(calls.length, 0);
});

// ---- Errors from the Worker ----------------------------------------------------------------------

test('Worker error bodies become ApiError with the code and the number', async () => {
  const cases: [number, unknown, string, number | undefined][] = [
    [402, { error: 'locked', price: 30 }, 'locked', 30],
    [409, { error: 'insufficient_coins', detail: 12 }, 'insufficient_coins', 12],
    [409, { error: 'price_changed', detail: 22 }, 'price_changed', 22],
    [403, { error: 'mature_opt_in_required' }, 'mature_opt_in_required', undefined],
    [401, { error: 'invalid_token' }, 'invalid_token', undefined],
    [403, { error: 'not_adult' }, 'not_adult', undefined],
    [404, { error: 'not_available' }, 'not_available', undefined],
    [429, { error: 'rate_limited' }, 'rate_limited', undefined],
    [503, { error: 'generation_unavailable' }, 'generation_unavailable', undefined],
    [500, { error: 'internal_error' }, 'internal_error', undefined],
  ];
  for (const [status, body, code, detail] of cases) {
    const { api } = client(() => json(body, status));
    await fails(api.getPlayback(EP), status, code, detail);
  }
});

test('an error body that is not ours never leaks its text: the code comes from the status instead', async () => {
  const cases: [number, string | object, string][] = [
    [502, '<html><body>Bad gateway from the CDN</body></html>', 'server_error'],
    [500, 'Internal Server Error: SELECT * FROM secrets', 'server_error'],
    [401, '', 'not_authenticated'],
    [404, 'nope', 'not_found'],
    [429, 'slow down', 'rate_limited'],
    [418, 'teapot', 'unknown_error'],
    [400, { error: 'Insufficient Coins!' }, 'unknown_error'],            // not a code-shaped name
    [500, { error: '<script>alert(1)</script>' }, 'server_error'],
    [400, { error: 'x'.repeat(200) }, 'unknown_error'],
    [500, { message: 'db password is hunter2' }, 'server_error'],
    [400, { error: 5 }, 'unknown_error'],
  ];
  for (const [status, body, code] of cases) {
    const { api } = client(() => (typeof body === 'string' ? new Response(body, { status }) : json(body, status)));
    const err = await fails(api.getPlayback(EP), status, code);
    assert.ok(!/hunter2|SELECT|script|Bad gateway/.test(`${err.message} ${JSON.stringify(err)}`));
  }
});

test('a detail that is not a whole number is dropped', async () => {
  for (const detail of [-1, 1.5, 'x', null]) {
    const { api } = client(() => json({ error: 'insufficient_coins', detail }, 409));
    await fails(api.getPlayback(EP), 409, 'insufficient_coins', undefined);
  }
  const { api } = client(() => json({ error: 'insufficient_coins', detail: 0 }, 409));
  await fails(api.getPlayback(EP), 409, 'insufficient_coins', 0);
});

// ---- Network, timeout, cancel ----------------------------------------------------------------------

test('a failed fetch is network_error with status 0', async () => {
  const { api } = client(() => { throw new TypeError('Network request failed'); });
  await fails(api.getPlayback(EP), 0, 'network_error');
});

test('a request that takes too long is timeout, and its timer and listener are cleaned up', async () => {
  const hang = (call: Call) => new Promise<Response>((_, reject) => {
    (call.init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted by us')));
  });
  const { api } = client(hang, { timeoutMs: 20 });
  await fails(api.getPlayback(EP), 0, 'timeout');
});

test('a very long timeout (or Infinity) means a long wait, not an instant timeout', async () => {
  // setTimeout treats any delay above 2^31-1 ms as 1 ms, which would fail every request at once.
  for (const timeoutMs of [Infinity, 3_000_000_000, 2 ** 31]) {
    const slow = (call: Call) => new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(json({ ok: true, env: 'x' })), 30);
      (call.init.signal as AbortSignal).addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted by us')); });
    });
    const { api } = client(slow, { timeoutMs });
    assert.deepEqual(await api.health(), { ok: true, env: 'x' }, String(timeoutMs));
  }
});

test('the caller can cancel: the error is aborted, and isAbortError says to stay quiet', async () => {
  const hang = (call: Call) => new Promise<Response>((_, reject) => {
    (call.init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('cancelled')));
  });
  const { api } = client(hang);
  const ctl = new AbortController();
  const p = api.getPlayback(EP, { signal: ctl.signal });
  ctl.abort();
  const err = await fails(p, 0, 'aborted');
  assert.equal(isAbortError(err), true);
  assert.equal(isAbortError(new ApiError(500, 'internal_error')), false);
  assert.equal(isAbortError(new Error('aborted')), false);
  assert.equal(getEventListeners(ctl.signal, 'abort').length, 0, 'the listener on the caller’s signal is removed');
});

test('an already cancelled call sends nothing and does not even read the token (which could trigger a refresh)', async () => {
  let asked = 0;
  const { api, calls } = client(() => json({}), { getAccessToken: () => { asked++; return TOKEN; } });
  const ctl = new AbortController();
  ctl.abort();
  await fails(api.getPlayback(EP, { signal: ctl.signal }), 0, 'aborted');
  assert.equal(calls.length, 0);
  assert.equal(asked, 0);
});

test('cancelling while the token is being read still stops the request', async () => {
  let release: (t: string) => void = () => {};
  const slowToken = new Promise<string>((resolve) => { release = resolve; });
  const { api, calls } = client(() => json({}), { getAccessToken: () => slowToken });
  const ctl = new AbortController();
  const p = api.getPlayback(EP, { signal: ctl.signal });
  ctl.abort();
  release(TOKEN);
  await fails(p, 0, 'aborted');
  assert.equal(calls.length, 0, 'no request was sent');
});

test('listeners on the caller’s signal are removed after a normal call too', async () => {
  const { api } = client(() => json({ ok: true, env: 'x' }));
  const ctl = new AbortController();
  await api.health({ signal: ctl.signal });
  assert.equal(getEventListeners(ctl.signal, 'abort').length, 0);
});

// ---- Responses are checked ----------------------------------------------------------------------------

test('a 2xx body that is not what we expect is invalid_response', async () => {
  for (const body of [{ nope: 1 }, [], 'text', null, { hls: 'not a url', expires_at: 1 }, { hls: 'https://x.test/a.m3u8', expires_at: 1.5 }]) {
    const { api } = client(() => json(body));
    await fails(api.getPlayback(EP), 200, 'invalid_response');
  }
  const { api } = client(() => new Response('<html>captive portal</html>', { status: 200 }));
  await fails(api.getPlayback(EP), 200, 'invalid_response');
  const empty = client(() => new Response('', { status: 200 }));
  await fails(empty.api.getPlayback(EP), 200, 'invalid_response');
});

test('playback and upload URLs must be https', async () => {
  const { api } = client(() => json({ hls: 'http://customer-x.cloudflarestream.com/t/video.m3u8', expires_at: 1790000000 }));
  await fails(api.getPlayback(EP), 200, 'invalid_response');
  const file = client(() => json({ hls: 'file:///etc/passwd', expires_at: 1790000000 }));
  await fails(file.api.getPlayback(EP), 200, 'invalid_response');
  const up = client(() => json({ upload_url: 'http://upload.example.test/x', max_duration_s: 120, max_bytes: 1000 }));
  await fails(up.api.createUpload(EP), 200, 'invalid_response');
});

// ---- Each route ---------------------------------------------------------------------------------------

test('getPlayback: only real episode ids are put in the path', async () => {
  for (const bad of ['', 'abc', '../../admin', `${EP}/../x`, `${EP}?x=1`, 'not-a-uuid']) {
    const { api, calls } = client(() => json({}));
    await fails(api.getPlayback(bad), 400, 'bad_request');
    assert.equal(calls.length, 0);
  }
});

test('createUpload posts the episode id as JSON and validates the answer', async () => {
  const reply = { upload_url: 'https://upload.cloudflarestream.com/abc', max_duration_s: 120, max_bytes: 209_715_200 };
  const { api, calls } = client(() => json(reply));
  assert.deepEqual(await api.createUpload(EP), reply);
  const c = calls[0]!;
  assert.equal(c.url, `${BASE}/api/uploads`);
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(c.init.body)), { episode_id: EP });
  await fails(client(() => json({})).api.createUpload('nope'), 400, 'bad_request');
});

test('redeemCode (web only) trims and checks the code locally, then posts it with the human-check token', async () => {
  const { api, calls } = client(() => json({ status: 'redeemed', coins: 1500, coins_expire_at: '2026-11-15T00:00:00Z', ai_days: 30 }));
  const out = await api.redeemCode({ code: '  JUDGE-2026  ', turnstileToken: 'x'.repeat(30) });
  assert.deepEqual(out, { status: 'redeemed', coins: 1500, coins_expire_at: '2026-11-15T00:00:00Z', ai_days: 30 });
  assert.equal(calls[0]?.url, `${BASE}/api/codes/redeem`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { code: 'JUDGE-2026', turnstile_token: 'x'.repeat(30) });
  for (const bad of [{ code: 'abc', turnstileToken: 'x'.repeat(30) }, { code: 'has space!', turnstileToken: 'x'.repeat(30) },
    { code: 'A'.repeat(41), turnstileToken: 'x'.repeat(30) }, { code: 'JUDGE-2026', turnstileToken: 'short' }, { code: '', turnstileToken: '' }]) {
    const { api: a, calls: c } = client(() => json({}));
    await fails(a.redeemCode(bad), 400, 'bad_request');
    assert.equal(c.length, 0);
  }
  const web = client(() => json({ error: 'web_only' }, 403));
  await fails(web.api.redeemCode({ code: 'JUDGE-2026', turnstileToken: 'x'.repeat(30) }), 403, 'web_only');
  const used = client(() => json({ error: 'code_used_up' }, 409));
  await fails(used.api.redeemCode({ code: 'JUDGE-2026', turnstileToken: 'x'.repeat(30) }), 409, 'code_used_up');
});

const PREMISE = 'A lighthouse keeper finds letters from someone not born yet.';

test('startAiStory sends defaults, trims the premise, and returns the job', async () => {
  const reply = { story_id: STORY_ID, scene_id: SCENE_ID, job_id: JOB };
  const { api, calls } = client(() => json(reply, 202));
  assert.deepEqual(await api.startAiStory({ premise: `  ${PREMISE}  ` }), reply);
  assert.equal(calls[0]?.url, `${BASE}/api/ai/stories`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { premise: PREMISE, tags: [], mode: 'comic' });
  await api.startAiStory({ premise: PREMISE, tags: ['mystery', 'slow-burn'] });
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)).tags, ['mystery', 'slow-burn']);
  const rid = '55555555-5555-4555-8555-555555555555';
  await api.startAiStory({ premise: PREMISE, request_id: rid });
  assert.equal(JSON.parse(String(calls[2]?.init.body)).request_id, rid, 'the retry key reaches the Worker');
  await assert.rejects(api.startAiStory({ premise: PREMISE, request_id: 'not-a-uuid' }));
});

test('startAiStory refuses bad input before anything is sent (same limits as the Worker)', async () => {
  const bad = [
    { premise: 'too short' },
    { premise: 'x'.repeat(19) },
    { premise: ' '.repeat(40) },
    { premise: 'x'.repeat(1001) },
    { premise: PREMISE, tags: ['Has Caps'] },
    { premise: PREMISE, tags: ['a'] },
    { premise: PREMISE, tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
    { premise: PREMISE, mode: 'video' as unknown as 'comic' },
    { premise: 5 as unknown as string },
  ];
  for (const input of bad) {
    const { api, calls } = client(() => json({}));
    await fails(api.startAiStory(input), 400, 'bad_request');
    assert.equal(calls.length, 0, JSON.stringify(input).slice(0, 60));
  }
  const edge = client(() => json({ story_id: STORY_ID, scene_id: SCENE_ID, job_id: JOB }));
  await edge.api.startAiStory({ premise: 'x'.repeat(20) });
  await edge.api.startAiStory({ premise: 'x'.repeat(1000), tags: Array.from({ length: 10 }, (_, i) => `tag-${i}`) });
  assert.equal(edge.calls.length, 2);
});

test('startAiStory: Worker refusals keep their codes', async () => {
  const cases: [number, string, number | undefined][] = [
    [403, 'ai_access_required', undefined], [403, 'ai_consent_required', undefined], [429, 'rate_limited', undefined],
    [409, 'insufficient_coins', 20], [503, 'generation_unavailable', undefined], [400, 'mode_unavailable', undefined],
  ];
  for (const [status, code, detail] of cases) {
    const { api } = client(() => json(detail === undefined ? { error: code } : { error: code, detail }, status));
    await fails(api.startAiStory({ premise: PREMISE }), status, code, detail);
  }
});

test('a start answer without all three ids is invalid_response', async () => {
  for (const reply of [{ story_id: STORY_ID, scene_id: SCENE_ID }, { story_id: 'x', scene_id: SCENE_ID, job_id: JOB }, {}]) {
    await fails(client(() => json(reply, 202)).api.startAiStory({ premise: PREMISE }), 202, 'invalid_response');
  }
});

test('chooseScene posts the choice to the scene, and reports an existing job', async () => {
  const reply = { story_id: STORY_ID, scene_id: SCENE_ID, job_id: JOB, existing: true };
  const { api, calls } = client(() => json(reply, 202));
  assert.deepEqual(await api.chooseScene(SCENE_ID, 'b'), reply);
  assert.equal(calls[0]?.url, `${BASE}/api/ai/scenes/${SCENE_ID}/choose`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { choice: 'b' });
  for (const [scene, choice] of [[SCENE_ID, 'd'], [SCENE_ID, ''], ['nope', 'a'], ['../x', 'a']] as const) {
    const { api: a, calls: c } = client(() => json({}));
    await fails(a.chooseScene(scene, choice as 'a'), 400, 'bad_request');
    assert.equal(c.length, 0);
  }
  await fails(client(() => json({ error: 'scene_in_progress' }, 409)).api.chooseScene(SCENE_ID, 'a'), 409, 'scene_in_progress');
});

test('chooseScene keeps the scene status svc.ai_choose sends, so a ready or blocked scene needs no extra lookup', async () => {
  for (const status of ['queued', 'generating', 'ready', 'blocked'] as const) {
    const reply = { story_id: STORY_ID, scene_id: SCENE_ID, job_id: JOB, existing: true, status };
    assert.deepEqual(await client(() => json(reply, 202)).api.chooseScene(SCENE_ID, 'a'), reply);
  }
  // A status this build doesn't know is dropped; the choice itself still went through.
  const odd = await client(() => json({ story_id: STORY_ID, scene_id: SCENE_ID, job_id: JOB, existing: false, status: 'teleporting' }, 202))
    .api.chooseScene(SCENE_ID, 'a');
  assert.deepEqual(odd, { story_id: STORY_ID, scene_id: SCENE_ID, job_id: JOB, existing: false, status: undefined });
});

test('getSceneManifest validates with StoryManifestSchema and checks it is the scene asked for', async () => {
  const m = makeManifest([{ caption: 'Low tide.' }]);
  const { api, calls } = client(() => json(m));
  assert.deepEqual(await api.getSceneManifest(SCENE_ID), m);
  assert.equal(calls[0]?.url, `${BASE}/api/ai/scenes/${SCENE_ID}/manifest`);
  // Upper-case ids are the same scene.
  assert.deepEqual(await api.getSceneManifest(SCENE_ID.toUpperCase()), m);
  // A manifest of another scene is refused even though it is a valid manifest.
  await fails(client(() => json({ ...m, scene_id: '55555555-5555-4555-8555-555555555555' })).api.getSceneManifest(SCENE_ID), 200, 'invalid_response');
  // So is a manifest that breaks the schema.
  await fails(client(() => json({ ...m, panels: m.panels.slice(0, 3) })).api.getSceneManifest(SCENE_ID), 200, 'invalid_response');
  await fails(client(() => json({ ...m, provenance: { ...m.provenance, ai_generated: false } })).api.getSceneManifest(SCENE_ID), 200, 'invalid_response');
  await fails(client(() => json({ error: 'not_available' }, 404)).api.getSceneManifest(SCENE_ID), 404, 'not_available');
  await fails(client(() => json({})).api.getSceneManifest('nope'), 400, 'bad_request');
});

// ---- Scene assets -------------------------------------------------------------------------------------

test('scene asset names: only panel-1..4 and plate-1..4 as .webp', () => {
  for (const ok of ['panel-1.webp', 'panel-4.webp', 'plate-2.webp']) assert.equal(isSceneAssetFile(ok), true, ok);
  for (const bad of ['panel-0.webp', 'panel-5.webp', 'panel-1.png', 'panel-1.webp/', '../panel-1.webp', 'manifest.json', 'Panel-1.webp', 'panel-1.webp?x=1', '']) {
    assert.equal(isSceneAssetFile(bad), false, bad);
  }
});

test('assetFileFromKey takes a storage key or a file name, and never a URL', () => {
  assert.equal(assetFileFromKey(`ai/${STORY_ID}/${SCENE_ID}/panel-2.webp`), 'panel-2.webp');
  assert.equal(assetFileFromKey(`ai/${STORY_ID}/${SCENE_ID}/plate-4.webp`), 'plate-4.webp');
  assert.equal(assetFileFromKey('panel-1.webp'), 'panel-1.webp');
  for (const bad of [null, undefined, '', 'https://evil.test/panel-1.webp', `https://evil.test/ai/${STORY_ID}/${SCENE_ID}/panel-1.webp`,
    `ai/${STORY_ID}/${SCENE_ID}/manifest.json`, `ai/${STORY_ID}/sheets/mara.webp`, `x/${STORY_ID}/${SCENE_ID}/panel-1.webp`,
    `ai/${STORY_ID}/${SCENE_ID}/../panel-1.webp`, 'ai/a/b/panel-1.webp', `ai/${STORY_ID}/${SCENE_ID}/panel-9.webp`]) {
    assert.equal(assetFileFromKey(bad), null, String(bad));
  }
});

test('panelAssetFiles lists the file to fetch for each panel', () => {
  const m = makeManifest([]);
  assert.deepEqual(panelAssetFiles(m), [1, 2, 3, 4].map((n) => ({ n, image: `panel-${n}.webp`, plate: null })));
  const withPlate = { ...m, panels: m.panels.map((p) => ({ ...p, plate: `ai/${STORY_ID}/${SCENE_ID}/plate-${p.n}.webp` })) };
  assert.equal(panelAssetFiles(withPlate)[1]?.plate, 'plate-2.webp');
  const odd = { ...m, panels: [{ ...m.panels[0]!, image: 'https://evil.test/x.webp' }, ...m.panels.slice(1)] };
  assert.equal(panelAssetFiles(odd)[0]?.image, null);
});

test('sceneAssetUrl builds the Worker URL for known files only', () => {
  const { api } = client(() => json({}));
  assert.equal(api.sceneAssetUrl(SCENE_ID, 'panel-1.webp'), `${BASE}/api/ai/scenes/${SCENE_ID}/assets/panel-1.webp`);
  assert.throws(() => api.sceneAssetUrl(SCENE_ID, '../manifest.json'), (e: unknown) => e instanceof ApiError && e.code === 'bad_request');
  assert.throws(() => api.sceneAssetUrl('nope', 'panel-1.webp'), (e: unknown) => e instanceof ApiError && e.code === 'bad_request');
});

test('sceneAssetSource gives the URL and the Authorization header for expo-image', async () => {
  const { api } = client(() => json({}));
  assert.deepEqual(await api.sceneAssetSource(SCENE_ID, 'plate-3.webp'), {
    uri: `${BASE}/api/ai/scenes/${SCENE_ID}/assets/plate-3.webp`,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  await assert.rejects(client(() => json({}), { getAccessToken: () => null }).api.sceneAssetSource(SCENE_ID, 'panel-1.webp'),
    (e: unknown) => e instanceof ApiError && e.code === 'missing_token');
  await assert.rejects(api.sceneAssetSource(SCENE_ID, 'evil.webp'), (e: unknown) => e instanceof ApiError && e.code === 'bad_request');
});

test('fetchSceneAsset returns the image as a Blob, with the header, and refuses other content', async () => {
  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
  const { api, calls } = client(() => new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/webp' } }));
  const blob = await api.fetchSceneAsset(SCENE_ID, 'panel-1.webp');
  assert.equal(blob.size, bytes.length);
  assert.equal(calls[0]?.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0]?.init.headers.Accept, 'image/webp');
  const html = client(() => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  await fails(html.api.fetchSceneAsset(SCENE_ID, 'panel-1.webp'), 200, 'invalid_response');
  const none = client(() => new Response('x', { status: 200 }));
  await fails(none.api.fetchSceneAsset(SCENE_ID, 'panel-1.webp'), 200, 'invalid_response');
  await fails(client(() => json({ error: 'not_available' }, 404)).api.fetchSceneAsset(SCENE_ID, 'panel-1.webp'), 404, 'not_available');
  await fails(client(() => json({})).api.fetchSceneAsset(SCENE_ID, 'nope.webp'), 400, 'bad_request');
});

test('isApiError tells our errors from others', () => {
  assert.equal(isApiError(new ApiError(0, 'network_error')), true);
  assert.equal(isApiError(new Error('x')), false);
  assert.equal(isApiError({ code: 'x', status: 1 }), false);
  assert.equal(new ApiError(0, 'timeout').name, 'ApiError');
  assert.equal(new ApiError(409, 'x').detail, undefined);
  assert.equal(new ApiError(409, 'x', 0).detail, 0);
});
