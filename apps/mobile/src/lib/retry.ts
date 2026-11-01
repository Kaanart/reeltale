// Retry rules for queries and the Worker client. Pure (tested in src/core/__tests__/retry.test.ts).
//
// - Queries retry a failed load at most twice, and only when trying again can help: no connection, a
//   timeout, a 5xx. A 4xx (bad input, not allowed, not found, out of coins …) never retries.
// - The Worker client refreshes the Supabase session once when the token was missing, expired or too old
//   to carry the age_ok claim (errors.ts: action 'refresh_session' or 'verify_age'), then tries once more.

import { describeError } from '../core/errors.ts';

export const MAX_QUERY_RETRIES = 2;

/** The HTTP status an error carries, if any: ApiError, supabase-js AuthError, or a DataError from lib/data.ts. */
export function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined;
}

export function isClientError(err: unknown): boolean {
  const status = statusOf(err);
  return status !== undefined && status >= 400 && status < 500;
}

/** TanStack Query `retry`: how many times a failed query is tried again, and for which errors. */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (isClientError(err)) return false;
  const info = describeError(err);
  if (info.code === 'aborted') return false;
  if (info.known) return info.retryable;
  // Something we have no name for: worth one more go only if it wasn't the request's fault.
  const status = statusOf(err);
  return status === undefined || status === 0 || status >= 500;
}

/** TanStack Query `retryDelay`: 1 s, 2 s, 4 s … capped at 8 s. */
export function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 8000);
}

/** Would a fresh access token fix this error? */
export function needsSessionRefresh(err: unknown): boolean {
  const action = describeError(err).action;
  return action === 'refresh_session' || action === 'verify_age';
}

/** One run at a time: callers that arrive while it runs share its result. */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    running ??= fn().finally(() => { running = null; });
    return running;
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * The same client, with every async method retried once after `refresh()` when the error says the
 * session needs it. `refresh` resolves true when there is a new session to try with. Methods that
 * return a plain value (sceneAssetUrl) pass through untouched.
 */
export function withSessionRefresh<T extends object>(client: T, refresh: () => Promise<boolean>): T {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(client)) {
    if (typeof value !== 'function') {
      out[name] = value;
      continue;
    }
    const fn = value as (...args: unknown[]) => unknown;
    out[name] = (...args: unknown[]) => {
      const first = fn(...args);
      if (!isPromiseLike(first)) return first;
      return Promise.resolve(first).catch(async (err: unknown) => {
        if (!needsSessionRefresh(err)) throw err;
        let refreshed = false;
        try {
          refreshed = await refresh();
        } catch {
          refreshed = false;
        }
        if (!refreshed) throw err;
        return fn(...args);
      });
    };
  }
  return out as T;
}
