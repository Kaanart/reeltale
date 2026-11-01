import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../api.ts';
import { authKeys, userKey } from '../../lib/keys.ts';
import {
  MAX_QUERY_RETRIES, needsSessionRefresh, retryDelay, shouldRetryQuery, singleFlight, statusOf, withSessionRefresh,
} from '../../lib/retry.ts';

/** What lib/data.ts throws for a failed Supabase call. */
const dataError = (status: number, message: string) => Object.assign(new Error(message), { status, code: '22023', details: null });

test('queries never retry a 4xx, whatever the code says', () => {
  for (const err of [
    new ApiError(400, 'bad_request'),
    new ApiError(401, 'invalid_token'),
    new ApiError(402, 'locked', 30),
    new ApiError(403, 'not_adult'),
    new ApiError(404, 'not_found'),
    new ApiError(429, 'rate_limited'),
    dataError(400, 'insufficient_coins'),
    dataError(400, 'generation_unavailable'),
    dataError(403, 'permission denied for table series'),
    { status: 422, code: 'validation_failed', name: 'AuthApiError', message: 'x' },
  ]) {
    assert.equal(shouldRetryQuery(0, err), false, `${String((err as { message?: string }).message)}`);
  }
});

test('queries retry network trouble and server errors, at most twice', () => {
  for (const err of [
    new ApiError(0, 'network_error'),
    new ApiError(0, 'timeout'),
    new ApiError(503, 'service_unavailable'),
    new ApiError(500, 'internal_error'),
    { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
    dataError(0, 'TypeError: Network request failed'),
    dataError(503, 'something unexpected'),
    new TypeError('Network request failed'),
  ]) {
    assert.equal(shouldRetryQuery(0, err), true, String((err as { message?: string }).message));
    assert.equal(shouldRetryQuery(MAX_QUERY_RETRIES - 1, err), true);
    assert.equal(shouldRetryQuery(MAX_QUERY_RETRIES, err), false);
  }
  assert.equal(shouldRetryQuery(0, new ApiError(0, 'aborted')), false, 'a cancelled request is not retried');
  assert.equal(shouldRetryQuery(0, new ApiError(500, 'not_found')), false, 'a known non-retryable code stays that way');
});

test('statusOf reads only integer statuses', () => {
  assert.equal(statusOf(new ApiError(402, 'locked')), 402);
  assert.equal(statusOf({ status: '500' }), undefined);
  assert.equal(statusOf({ status: 1.5 }), undefined);
  assert.equal(statusOf(null), undefined);
  assert.equal(statusOf('x'), undefined);
});

test('retry delays grow and are capped', () => {
  assert.deepEqual([0, 1, 2, 3, 10].map(retryDelay), [1000, 2000, 4000, 8000, 8000]);
});

test('a session refresh is only worth it for token and age-claim errors', () => {
  for (const code of ['missing_token', 'invalid_token', 'bad_jwt', 'no_authorization', 'not_adult']) {
    assert.equal(needsSessionRefresh(new ApiError(401, code)), true, code);
  }
  for (const code of ['not_authenticated', 'locked', 'network_error', 'session_not_found']) {
    assert.equal(needsSessionRefresh(new ApiError(401, code)), false, code);
  }
});

test('the client refreshes once and tries once more, then gives up', async () => {
  let calls = 0;
  let refreshes = 0;
  const client = {
    getThing: async (id: string) => {
      calls += 1;
      if (calls === 1) throw new ApiError(401, 'invalid_token');
      return `thing ${id}`;
    },
    url: (id: string) => `https://reeltale.net/${id}`,
    version: 3,
  };
  const wrapped = withSessionRefresh(client, async () => { refreshes += 1; return true; });
  assert.equal(await wrapped.getThing('a'), 'thing a');
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
  assert.equal(wrapped.url('b'), 'https://reeltale.net/b', 'plain methods pass through');
  assert.equal(wrapped.version, 3);

  // Still failing after the refresh: the second error comes back, no third try.
  let attempts = 0;
  const stubborn = withSessionRefresh({ go: async () => { attempts += 1; throw new ApiError(401, 'invalid_token'); } }, async () => true);
  await assert.rejects(stubborn.go(), (err: unknown) => err instanceof ApiError && err.code === 'invalid_token');
  assert.equal(attempts, 2);

  // The refresh failed (or threw): the original error, and no retry.
  let tries = 0;
  const noSession = withSessionRefresh({ go: async () => { tries += 1; throw new ApiError(401, 'missing_token'); } }, async () => { throw new Error('offline'); });
  await assert.rejects(noSession.go(), (err: unknown) => err instanceof ApiError && err.code === 'missing_token');
  assert.equal(tries, 1);

  // Other errors are not touched.
  let refreshed = false;
  const other = withSessionRefresh({ go: async () => { throw new ApiError(402, 'locked', 25); } }, async () => { refreshed = true; return true; });
  await assert.rejects(other.go(), (err: unknown) => err instanceof ApiError && err.detail === 25);
  assert.equal(refreshed, false);

  // A synchronous throw (bad input) stays synchronous.
  const sync = withSessionRefresh({ bad: () => { throw new TypeError('bad input'); } }, async () => true);
  assert.throws(() => sync.bad(), TypeError);
});

test('singleFlight shares one run between callers that arrive together', async () => {
  let runs = 0;
  let release: (v: boolean) => void = () => {};
  const refresh = singleFlight(() => { runs += 1; return new Promise<boolean>((r) => { release = r; }); });
  const a = refresh();
  const b = refresh();
  release(true);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(runs, 1);
  // After it settles, the next call runs again.
  const c = refresh();
  release(false);
  assert.equal(await c, false);
  assert.equal(runs, 2);
});

test('query keys start with the user, so accounts never share cached data', () => {
  assert.deepEqual(userKey('u1', 'wallet'), ['u', 'u1', 'wallet']);
  assert.deepEqual(userKey(null, 'wallet'), ['u', 'signed-out', 'wallet']);
  assert.notDeepEqual(userKey('u1', 'catalog', 'series', 's1'), userKey('u2', 'catalog', 'series', 's1'));
  assert.deepEqual(authKeys.profile('u1'), ['u', 'u1', 'auth', 'profile']);
  assert.deepEqual(authKeys.role('u1'), ['u', 'u1', 'auth', 'role']);
});
