import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ApiError } from '../api.ts';
import { describeError, ERROR_CODES, ERROR_KEYS, errorCodeOf } from '../errors.ts';

// ---- describeError -------------------------------------------------------------------------------

test('an ApiError gives its code, key and action', () => {
  const info = describeError(new ApiError(403, 'not_adult'));
  assert.deepEqual(info, { code: 'not_adult', known: true, key: 'errors:not_adult', params: {}, action: 'verify_age', retryable: false });
});

test('numbers the server attaches select the plural message and fill {{count}}', () => {
  assert.deepEqual(describeError(new ApiError(409, 'insufficient_coins', 12)),
    { code: 'insufficient_coins', known: true, key: 'errors:insufficient_coins_count', params: { count: 12 }, action: 'buy_coins', retryable: false });
  assert.deepEqual(describeError(new ApiError(409, 'price_changed', 22)).params, { count: 22 });
  assert.equal(describeError(new ApiError(409, 'price_changed', 22)).key, 'errors:price_changed_count');
  assert.equal(describeError(new ApiError(409, 'price_changed', 22)).action, 'refresh_price');
  assert.deepEqual(describeError(new ApiError(402, 'locked', 30)).params, { count: 30 });
  assert.equal(describeError(new ApiError(402, 'locked', 30)).key, 'errors:locked_count');
  assert.equal(describeError(new ApiError(409, 'refund_debt_outstanding', 5)).key, 'errors:refund_debt_outstanding_count');
  assert.equal(describeError(new ApiError(409, 'refund_debt_outstanding', 5)).action, 'buy_coins');
});

test('without a number the plain message is used', () => {
  assert.equal(describeError(new ApiError(409, 'insufficient_coins')).key, 'errors:insufficient_coins');
  assert.deepEqual(describeError(new ApiError(409, 'insufficient_coins')).params, {});
  assert.equal(describeError(new ApiError(402, 'locked')).key, 'errors:locked');
  // A number on a code that has no plural form is ignored.
  assert.deepEqual(describeError(new ApiError(403, 'not_adult', 3)).params, {});
  assert.equal(describeError(new ApiError(403, 'not_adult', 3)).key, 'errors:not_adult');
});

test('PostgREST errors from a direct RPC call: the message is the code, details the number', () => {
  const e = { message: 'insufficient_coins', details: '30', hint: null, code: 'P0001' };
  assert.deepEqual(describeError(e), { code: 'insufficient_coins', known: true, key: 'errors:insufficient_coins_count', params: { count: 30 }, action: 'buy_coins', retryable: false });
  assert.equal(describeError({ message: 'price_changed', details: '22', code: '22023' }).params.count, 22);
  assert.deepEqual(describeError({ message: 'no_free_pass_left', details: null, code: '22023' }).params, {});
  assert.deepEqual(describeError({ message: 'insufficient_coins', details: 'twelve', code: 'P0001' }).params, {});
  assert.deepEqual(describeError({ message: 'insufficient_coins', details: '9999999999', code: 'P0001' }).params, {});
  assert.deepEqual(describeError({ message: 'insufficient_coins', details: '-4', code: 'P0001' }).params, {});
  assert.equal(describeError({ message: 'date_of_birth_already_set', code: '22023' }).key, 'errors:date_of_birth_already_set');
});

test('Supabase Auth errors are told apart by their code', () => {
  const otp = { name: 'AuthApiError', message: 'Token has expired or is invalid', status: 403, code: 'otp_expired' };
  assert.equal(describeError(otp).key, 'errors:otp_expired');
  assert.equal(describeError({ name: 'AuthApiError', message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' }).key, 'errors:invalid_credentials');
  assert.equal(describeError({ message: 'x y z', code: 'over_email_send_rate_limit' }).key, 'errors:rate_limited');
  assert.equal(describeError({ message: 'x y z', code: 'over_email_send_rate_limit' }).retryable, true);
  assert.equal(describeError({ message: 'User is banned', code: 'user_banned' }).action, 'blocked');
  assert.equal(describeError({ message: 'Refresh Token Not Found', code: 'refresh_token_not_found' }).action, 'sign_in');
  assert.equal(describeError({ message: 'bad jwt', code: 'bad_jwt' }).action, 'refresh_session');
  assert.equal(describeError({ name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 }).code, 'network_error');
});

test('a lost connection is network_error, whichever way the platform words it', () => {
  for (const message of ['Network request failed', 'TypeError: Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    const info = describeError(new TypeError(message));
    assert.equal(info.code, 'network_error', message);
    assert.equal(info.key, 'errors:network');
    assert.equal(info.retryable, true);
    assert.equal(info.action, 'retry');
  }
  assert.equal(describeError(new ApiError(0, 'network_error')).key, 'errors:network');
});

test('offline turns network failures and timeouts into the offline message, and only those', () => {
  assert.equal(describeError(new ApiError(0, 'network_error'), { offline: true }).key, 'errors:offline');
  assert.equal(describeError(new ApiError(0, 'timeout'), { offline: true }).key, 'errors:offline');
  assert.equal(describeError(new ApiError(0, 'timeout'), { offline: true }).code, 'offline');
  assert.equal(describeError(new ApiError(0, 'timeout')).key, 'errors:timeout');
  assert.equal(describeError(new ApiError(403, 'not_adult'), { offline: true }).key, 'errors:not_adult');
  assert.equal(describeError(new ApiError(500, 'internal_error'), { offline: true }).key, 'errors:generic');
  assert.equal(describeError(new ApiError(0, 'network_error'), { offline: false }).key, 'errors:network');
});

test('unknown errors fall back to the generic message, keeping the code for logs', () => {
  const info = describeError(new ApiError(418, 'brand_new_error'));
  assert.deepEqual(info, { code: 'brand_new_error', known: false, key: 'errors:generic', params: {}, action: 'retry', retryable: true });
  for (const junk of [null, undefined, 42, true, {}, [], () => 1]) {
    const i = describeError(junk);
    assert.equal(i.key, 'errors:generic');
    assert.equal(i.known, false);
    assert.equal(i.code, 'unknown_error');
  }
});

test('raw server or database text never becomes a code or reaches the result', () => {
  const texts = [
    'duplicate key value violates unique constraint "ledger_pkey"',
    'permission denied for table coin_lots',
    '<html><body>502 Bad Gateway</body></html>',
    'JWT expired at 2026-10-28',
  ];
  for (const text of texts) {
    for (const err of [new Error(text), { message: text, details: text, code: 'XX000' }, text]) {
      const info = describeError(err);
      assert.equal(info.key, 'errors:generic', text);
      assert.equal(info.code, 'unknown_error');
      assert.ok(!JSON.stringify(info).includes(text.slice(0, 12)), `leaked: ${text}`);
    }
  }
});

test('a plain Error or string carrying one of our code names is understood', () => {
  assert.equal(describeError(new Error('insufficient_coins')).key, 'errors:insufficient_coins');
  assert.equal(describeError('rate_limited').key, 'errors:rate_limited');
  assert.equal(describeError('Rate Limited').code, 'unknown_error');
});

test('names that exist on every object are not codes', () => {
  for (const code of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const info = describeError(new ApiError(500, code));
    assert.equal(info.known, false, code);
    assert.equal(info.key, 'errors:generic', code);
    assert.equal(describeError({ code, message: 'x y' }).known, false, code);
  }
});

test('errorCodeOf pulls out the code and the number', () => {
  assert.deepEqual(errorCodeOf(new ApiError(409, 'insufficient_coins', 7)), { code: 'insufficient_coins', detail: 7 });
  assert.deepEqual(errorCodeOf(new ApiError(409, 'insufficient_coins')), { code: 'insufficient_coins' });
  assert.deepEqual(errorCodeOf({ message: 'price_changed', details: '22' }), { code: 'price_changed', detail: 22 });
  assert.deepEqual(errorCodeOf(null), { code: 'unknown_error' });
});

test('every mapped code produces a key that errors.ts declares, and says whether it is known', () => {
  assert.ok(ERROR_CODES.length > 80);
  for (const code of ERROR_CODES) {
    const info = describeError(new ApiError(400, code));
    assert.equal(info.known, true, code);
    assert.ok(ERROR_KEYS.includes(info.key), `${code} -> ${info.key}`);
    for (const n of [0, 1, 5, 1500]) assert.ok(ERROR_KEYS.includes(describeError(new ApiError(400, code, n)).key), `${code} with ${n}`);
  }
});

test('the actions point the app at the right place', () => {
  const action = (code: string) => describeError(new ApiError(400, code)).action;
  assert.equal(action('missing_token'), 'refresh_session');
  assert.equal(action('invalid_token'), 'refresh_session');
  assert.equal(action('not_authenticated'), 'sign_in');
  assert.equal(action('not_adult'), 'verify_age');
  assert.equal(action('insufficient_coins'), 'buy_coins');
  assert.equal(action('mature_opt_in_required'), 'mature_opt_in');
  assert.equal(action('upload_consent_required'), 'upload_consent');
  assert.equal(action('ai_consent_required'), 'ai_consent');
  assert.equal(action('ai_access_required'), 'ai_access');
  assert.equal(action('generation_unavailable'), 'retry');
  assert.equal(action('rate_limited'), 'retry');
  assert.equal(action('no_free_pass_left'), 'none');
  assert.equal(action('aborted'), 'none');
});

test('redeem errors use the web-only namespace, and nothing else does', () => {
  for (const code of ['invalid_code', 'code_used_up', 'web_only', 'turnstile_failed']) {
    assert.equal(describeError(new ApiError(403, code)).key, `redeem:errors.${code}`);
  }
  for (const code of ERROR_CODES) {
    if (['invalid_code', 'code_used_up', 'web_only', 'turnstile_failed'].includes(code)) continue;
    assert.ok(!describeError(new ApiError(400, code)).key.startsWith('redeem:'), code);
  }
});

test('AI route errors have their own messages', () => {
  for (const code of ['ai_access_required', 'ai_consent_required', 'mode_unavailable', 'invalid_choice', 'scene_not_continuable', 'scene_in_progress', 'generation_unavailable', 'rate_limited']) {
    const info = describeError(new ApiError(400, code));
    assert.ok(info.known, code);
    assert.notEqual(info.key, 'errors:generic', code);
  }
});

// ---- Drift guard: nothing the server can say goes unmapped -------------------------------------------

const root = new URL('../../../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const all = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1] as string);

// Raised only inside svc.* functions or internal helpers. The Worker turns anything outside its client-safe list into
// internal_error, and the app never calls these. If one of them starts reaching users, move it out of this list and map it.
const SERVER_ONLY = new Set([
  'job_not_found', 'unknown_product', 'invalid_grant', 'invalid_amount', 'upload_not_pending',
  'profile_not_found', 'lot_not_pending', 'job_not_running', 'job_budget_exceeded', 'daily_budget_exceeded',
  'invalid_value', 'invalid_hold', 'invalid_event', 'invalid_duration', 'invalid_capture',
  'idempotency_conflict', 'hold_not_found', 'episode_not_accepting_media', 'job_already_failed',
  // FX valuation and ingest: only the Worker's cron and workflows call these.
  'invalid_fx_valuation', 'invalid_ip_hash', 'invalid_media_key', 'lot_still_pending', 'purchase_not_found',
  'valuation_not_found',
]);

function sqlErrorNames(): string[] {
  const dir = new URL('supabase/migrations/', root);
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    for (const n of all(readFileSync(new URL(file, dir), 'utf8'), /raise exception '([a-z_]+)'/g)) names.add(n);
  }
  return [...names].sort();
}

test('every error name the Worker can send is mapped', () => {
  const http = read('apps/server/src/lib/http.ts');
  const set = /CLIENT_SAFE_DB_ERRORS = new Set\(\[([\s\S]*?)\]\)/.exec(http)?.[1] ?? '';
  const safe = all(set, /'([a-z_]+)'/g);
  assert.ok(safe.length > 20, 'found the client-safe list');

  const literal: string[] = [];
  for (const file of ['apps/server/src/app.ts', 'apps/server/src/routes/user.ts', 'apps/server/src/routes/ai.ts', 'apps/server/src/lib/http.ts']) {
    literal.push(...all(read(file), /jsonError\(\s*c,\s*\d+,\s*'([a-z_]+)'/g));
  }
  assert.ok(literal.length > 10, 'found the jsonError calls');

  const auth = /AuthFailure = ([^;]+);/.exec(read('apps/server/src/lib/auth.ts'))?.[1] ?? '';
  const authCodes = all(auth, /'([a-z_]+)'/g);
  assert.deepEqual(authCodes.sort(), ['invalid_token', 'missing_token', 'not_adult', 'not_authenticated']);

  const playback = all(read('apps/server/src/routes/user.ts'), /reason === '([a-z_]+)'/g);
  const sqlReasons = all(read('supabase/migrations/20261027090300_ledger.sql'), /'allowed', false, 'reason', '([a-z_]+)'/g);

  const unmapped = [...new Set([...safe, ...literal, ...authCodes, ...playback, ...sqlReasons])].filter((c) => !ERROR_CODES.includes(c));
  assert.deepEqual(unmapped, [], `add these to CATALOG in errors.ts (and the strings to errors.json): ${unmapped.join(', ')}`);
});

test('every exception name the SQL raises is mapped or listed as server-only', () => {
  const names = sqlErrorNames();
  assert.ok(names.length > 40, 'found the SQL error names');
  const missing = names.filter((n) => !ERROR_CODES.includes(n) && !SERVER_ONLY.has(n));
  assert.deepEqual(missing, [], `new SQL error name(s): map in errors.ts, or add to SERVER_ONLY if no user can reach it: ${missing.join(', ')}`);
  // The list stays honest: every entry is still raised somewhere and not also mapped.
  const stale = [...SERVER_ONLY].filter((n) => !names.includes(n) || ERROR_CODES.includes(n));
  assert.deepEqual(stale, [], `stale SERVER_ONLY entries: ${stale.join(', ')}`);
});
