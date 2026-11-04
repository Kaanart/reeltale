import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkNotice, contactOptional, effectiveType, EMPTY_DRAFT, firstProblem, NOTICE_REASON_ORDER, NOTICE_REASONS,
  NOTICE_TARGET_TYPES, NoticeBodySchema, noticeBody, NoticeError, noticeErrorKey, parseTarget, reasonLabelKey,
  sendNotice, type NoticeDraft,
} from '../../features/landing/logic/notice.ts';

// The public notice form (/notice): the same rules as the Worker's POST /api/report, checked before
// anything is sent, and a careful call.

const ID = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const good: NoticeDraft = {
  targetType: 'episode',
  target: `https://reeltale.net/watch/${ID}`,
  reason: 'copyright',
  details: 'This episode uses my song without permission.',
  name: 'Sam Rivera',
  email: 'sam@example.com',
  goodFaith: true,
};

// ---- Same rules as the Worker ------------------------------------------------------------------------------

const server = readFileSync(new URL('../../../../server/src/routes/report.ts', import.meta.url), 'utf8');

test('the reasons and target types are the Worker’s, in its order', () => {
  const reasons = /REPORT_REASONS = \[([^\]]+)\]/.exec(server)?.[1] ?? '';
  assert.deepEqual([...reasons.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...NOTICE_REASONS]);
  const types = /target_type: z\.enum\(\[([^\]]+)\]\)/.exec(server)?.[1] ?? '';
  assert.deepEqual([...types.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...NOTICE_TARGET_TYPES]);
  // The form lists every reason exactly once.
  assert.deepEqual([...NOTICE_REASON_ORDER].sort(), [...NOTICE_REASONS].sort());
  assert.equal(NOTICE_REASON_ORDER[0], 'minor_safety');
  assert.equal(NOTICE_REASON_ORDER.at(-1), 'other');
});

test('every field limit matches the Worker’s schema', () => {
  // Each line of the server's NoticeBody, as the client's schema has it (source text, whitespace-insensitive).
  const body = /const NoticeBody = z\.object\(\{([\s\S]*?)\}\)\s*\/\/[^\n]*\n\s*\.refine\(([^\n]+)\)/.exec(server);
  assert.ok(body, 'NoticeBody found in report.ts');
  const lines = body[1]!.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean);
  const expect = [
    "target_type: z.enum(['series', 'episode', 'ai_scene', 'profile']),",
    'target_id: z.string().uuid(),',
    'reason: z.enum(REPORT_REASONS),',
    'details: z.string().trim().min(10).max(2000),',
    'name: z.string().trim().min(1).max(100).optional(),',
    'email: z.string().trim().max(254).pipe(z.email()).optional(),',
    'good_faith: z.literal(true),',
    'turnstile_token: z.string().min(10).max(4096),',
  ];
  assert.deepEqual(lines, expect);
  assert.match(body[2]!, /b\.reason === 'minor_safety' \|\| \(b\.name !== undefined && b\.email !== undefined\)/);
  // The Worker checks the Turnstile action "report", which the form's widget uses.
  assert.match(server, /expectedAction: 'report'/);
});

test('a complete notice passes and becomes exactly the body the Worker wants', () => {
  const r = checkNotice(good);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.fields, {
    target_type: 'episode', target_id: ID, reason: 'copyright', details: good.details, name: 'Sam Rivera',
    email: 'sam@example.com', good_faith: true,
  });
  const body = noticeBody(r.fields, TOKEN);
  assert.ok(body);
  assert.equal(body.turnstile_token, TOKEN);
  assert.deepEqual(Object.keys(body).sort(), ['details', 'email', 'good_faith', 'name', 'reason', 'target_id', 'target_type', 'turnstile_token']);
  // A token too short for the Worker is caught here too.
  assert.equal(noticeBody(r.fields, 'short'), null);
});

test('whatever the form accepts, the Worker’s schema accepts, and the other way round', () => {
  const variants: Partial<NoticeDraft>[] = [
    {}, { targetType: null }, { target: '' }, { target: 'nonsense' }, { reason: null }, { details: 'too short' },
    { details: ' '.repeat(20) }, { details: 'x'.repeat(2000) }, { details: 'x'.repeat(2001) }, { name: '' }, { name: '   ' },
    { name: 'n'.repeat(100) }, { name: 'n'.repeat(101) }, { email: '' }, { email: 'not-an-email' }, { email: 'a@b' },
    { email: ' sam@example.com ' }, { goodFaith: false }, { reason: 'minor_safety', name: '', email: '' },
    { reason: 'minor_safety', name: 'Only a name', email: '' }, { reason: 'minor_safety', email: 'bad' },
    { targetType: 'series', target: ID }, { targetType: 'profile', target: ID.toUpperCase() },
    { targetType: 'ai_scene', target: `id: ${ID}` },
  ];
  for (const v of variants) {
    const draft = { ...good, ...v };
    const mine = checkNotice(draft);
    // What the Worker would get if the form sent the raw fields anyway (empty optional fields left out).
    const raw = {
      target_type: effectiveType(draft) ?? undefined,
      target_id: parseTarget(draft.target).id ?? draft.target,
      reason: draft.reason ?? undefined,
      details: draft.details,
      ...(draft.name.trim() ? { name: draft.name } : {}),
      ...(draft.email.trim() ? { email: draft.email } : {}),
      good_faith: draft.goodFaith,
      turnstile_token: TOKEN,
    };
    const theirs = NoticeBodySchema.safeParse(raw).success;
    assert.equal(mine.ok, theirs, JSON.stringify(v));
    if (mine.ok) assert.ok(noticeBody(mine.fields, TOKEN), JSON.stringify(v));
  }
});

test('each problem is named on its own field, and the first one gets the focus', () => {
  const r = checkNotice(EMPTY_DRAFT);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.problems, {
    targetType: 'notice:errors.typeRequired',
    target: 'notice:errors.targetRequired',
    reason: 'notice:errors.reasonRequired',
    details: 'notice:errors.detailsShort',
    name: 'notice:errors.nameRequired',
    email: 'notice:errors.emailRequired',
    goodFaith: 'notice:errors.goodFaithRequired',
  });
  assert.equal(firstProblem(r.problems), 'targetType');
  assert.equal(firstProblem({ email: 'x', details: 'y' }), 'details');
  assert.equal(firstProblem({}), null);

  const bad = checkNotice({ ...good, details: 'x'.repeat(2001), name: 'n'.repeat(101), email: 'nope' });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.problems.details, 'notice:errors.detailsLong');
    assert.equal(bad.problems.name, 'notice:errors.nameLong');
    assert.equal(bad.problems.email, 'notice:errors.emailInvalid');
  }
});

test('child sexual abuse may be reported anonymously; nothing else may', () => {
  assert.equal(contactOptional('minor_safety'), true);
  for (const reason of NOTICE_REASONS.filter((r) => r !== 'minor_safety')) assert.equal(contactOptional(reason), false);
  assert.equal(contactOptional(null), false);
  const anon = checkNotice({ ...good, reason: 'minor_safety', name: '  ', email: '' });
  assert.equal(anon.ok, true);
  if (anon.ok) {
    assert.equal('name' in anon.fields, false, 'blank name is left out, not sent empty');
    assert.equal('email' in anon.fields, false);
  }
  // An address that is given must still be a real one.
  const r = checkNotice({ ...good, reason: 'minor_safety', email: 'nope' });
  assert.equal(r.ok, false);
});

test('links and ids: episodes, the in-app report link, bare ids; series pages need an id', () => {
  assert.deepEqual(parseTarget(`https://reeltale.net/watch/${ID}`), { id: ID, type: 'episode', seriesSlugOnly: false });
  assert.deepEqual(parseTarget(`reeltale.net/watch/${ID.toUpperCase()}?t=12`), { id: ID, type: 'episode', seriesSlugOnly: false });
  assert.deepEqual(parseTarget(`/watch/${ID}`), { id: ID, type: 'episode', seriesSlugOnly: false });
  assert.deepEqual(parseTarget(`https://reeltale.net/report?type=ai_scene&id=${ID}`), { id: ID, type: 'ai_scene', seriesSlugOnly: false });
  assert.deepEqual(parseTarget(`https://reeltale.net/report?type=nonsense&id=${ID}`), { id: ID, type: null, seriesSlugOnly: false });
  assert.deepEqual(parseTarget(`  ${ID}  `), { id: ID, type: null, seriesSlugOnly: false });
  assert.deepEqual(parseTarget(`https://reeltale.net/series/${ID}`), { id: ID, type: 'series', seriesSlugOnly: false });
  assert.deepEqual(parseTarget('https://reeltale.net/series/salt-and-static'), { id: null, type: 'series', seriesSlugOnly: true });
  assert.deepEqual(parseTarget('https://example.com/video'), { id: null, type: null, seriesSlugOnly: false });
  assert.deepEqual(parseTarget(''), { id: null, type: null, seriesSlugOnly: false });
  // Something shaped like an id that the Worker's uuid check refuses (version digit 0) is no id.
  assert.equal(parseTarget('12345678-1234-0234-8234-123456789abc').id, null);

  const slug = checkNotice({ ...good, targetType: 'series', target: 'https://reeltale.net/series/salt-and-static' });
  assert.equal(slug.ok, false);
  if (!slug.ok) assert.equal(slug.problems.target, 'notice:errors.seriesLink');
  const none = checkNotice({ ...good, target: 'the second video' });
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.problems.target, 'notice:errors.noId');
});

test('the link fills in what is reported; a different choice is flagged instead of overruled', () => {
  assert.equal(effectiveType({ targetType: null, target: `/watch/${ID}` }), 'episode');
  assert.equal(effectiveType({ targetType: 'profile', target: ID }), 'profile');
  const fromLink = checkNotice({ ...good, targetType: null });
  assert.equal(fromLink.ok, true);
  if (fromLink.ok) assert.equal(fromLink.fields.target_type, 'episode');
  const clash = checkNotice({ ...good, targetType: 'series' });
  assert.equal(clash.ok, false);
  if (!clash.ok) assert.equal(clash.problems.targetType, 'notice:errors.typeMismatch');
});

test('reason labels avoid i18next’s plural suffix', () => {
  assert.equal(reasonLabelKey('illegal_other'), 'notice:reasons.illegal');
  assert.equal(reasonLabelKey('copyright'), 'notice:reasons.copyright');
});

// ---- The call ------------------------------------------------------------------------------------------------

function fakeFetch(answer: () => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { calls, impl };
}

const body = noticeBody((checkNotice(good) as { ok: true; fields: Parameters<typeof noticeBody>[0] }).fields, TOKEN)!;

test('sending posts JSON to the same origin’s /api/report, with no cookies and no redirects', async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ status: 'received' }), { status: 202 }));
  await sendNotice(body, { origin: 'https://reeltale.net/', fetchImpl: f.impl });
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0]!;
  assert.equal(url, 'https://reeltale.net/api/report');
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
  assert.deepEqual(JSON.parse(String(init.body)), body);
  // Never an Authorization header: the form is for everyone, signed in or not.
  assert.doesNotMatch(JSON.stringify(init.headers), /Authorization/i);
});

test('only https origins (or a local development host) are used', async () => {
  for (const origin of ['http://reeltale.net', 'javascript:alert(1)', 'https://reeltale.net/path', 'ftp://x', '']) {
    const f = fakeFetch(() => new Response(null, { status: 202 }));
    await assert.rejects(sendNotice(body, { origin, fetchImpl: f.impl }), (e: unknown) => e instanceof NoticeError && e.code === 'bad_origin');
    assert.equal(f.calls.length, 0, origin);
  }
  const local = fakeFetch(() => new Response(null, { status: 202 }));
  await sendNotice(body, { origin: 'http://127.0.0.1:8799', fetchImpl: local.impl });
  assert.equal(local.calls[0]!.url, 'http://127.0.0.1:8799/api/report');
});

test('failures carry the Worker’s code, and map to calm messages', async () => {
  const cases: [number, unknown, string, string][] = [
    [403, { error: 'turnstile_failed' }, 'turnstile_failed', 'notice:errors.turnstile'],
    [429, { error: 'rate_limited' }, 'rate_limited', 'notice:errors.rateLimited'],
    [503, { error: 'not_configured' }, 'not_configured', 'notice:errors.unavailable'],
    [400, { error: 'bad_request' }, 'bad_request', 'notice:errors.rejected'],
    [413, { error: 'too_large' }, 'too_large', 'notice:errors.rejected'],
    [403, { error: 'web_only' }, 'web_only', 'notice:errors.failed'],
    [500, 'not json', 'http_500', 'notice:errors.failed'],
    [500, { error: '<script>' }, 'http_500', 'notice:errors.failed'],
  ];
  for (const [status, payload, code, key] of cases) {
    const f = fakeFetch(() => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status }));
    await assert.rejects(sendNotice(body, { origin: 'https://reeltale.net', fetchImpl: f.impl }), (e: unknown) => {
      assert.ok(e instanceof NoticeError);
      assert.equal(e.status, status);
      assert.equal(e.code, code);
      assert.equal(noticeErrorKey(e), key);
      return true;
    });
  }
  const down = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
  await assert.rejects(sendNotice(body, { origin: 'https://reeltale.net', fetchImpl: down.impl }), (e: unknown) =>
    e instanceof NoticeError && e.code === 'network_error' && noticeErrorKey(e) === 'notice:errors.network');
  assert.equal(noticeErrorKey(new Error('x')), 'notice:errors.failed');
});

test('a request that hangs gives up with a timeout', async () => {
  const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
  await assert.rejects(sendNotice(body, { origin: 'https://reeltale.net', fetchImpl: hang, timeoutMs: 20 }), (e: unknown) =>
    e instanceof NoticeError && e.code === 'timeout' && noticeErrorKey(e) === 'notice:errors.network');
});
