// ===================================================================================================
// THE DATA-SOURCE PATTERN (every feature track: read this before writing a hook)
// ===================================================================================================
//
// The app runs against the real backend (Supabase + the Worker) or, in demo mode (EXPO_PUBLIC_DEMO=1,
// or no Supabase configured), against local fixtures with no network at all. Screens never know which.
// Feature HOOKS decide, in one place, with fromSource():
//
//   // src/features/me/hooks.ts
//   import { useQuery } from '@tanstack/react-query';
//   import { parseWallet } from '../../core/wallet';
//   import { useUserId } from '../auth';
//   import { fromSource, rpc, userKey } from '../../lib/data';
//   import { demoState, demoWallet } from '../../demo';
//
//   const demoWalletCell = demoState('me.wallet', () => demoWallet());
//
//   export function useWallet() {
//     const userId = useUserId();
//     return useQuery({
//       queryKey: userKey(userId, 'wallet'),
//       enabled: !!userId,
//       queryFn: () => fromSource({
//         demo: () => demoWalletCell.get(),
//         live: () => rpc('get_my_wallet', undefined, parseWallet),
//       }),
//     });
//   }
//
// Rules
// 1. Never import `supabase` or `api` into a screen or component. Hooks call rpc()/select()/api inside
//    the `live` branch of fromSource; the `demo` branch returns fixtures (src/demo) or your own
//    (src/features/<track>/demo.ts). Mutations work the same way: change a demoState() cell in `demo`.
// 2. Identity comes from the session only: useUserId() for cache keys, auth.uid() in SQL. Never pass a
//    user id to an RPC, and never take one from a route param or a text field.
// 3. Keys: userKey(userId, '<feature>', ...) and `enabled: !!userId` (src/lib/keys.ts).
// 4. Errors: let them throw. Show them with describeError(err) from src/core/errors.ts -> t(info.key,
//    info.params). Never show err.message (it may be server text).
// 5. Select granted columns only (the *_COLUMNS strings in src/lib/types.ts); `select('*')` fails.
// 6. Money and consent never go through demo shortcuts in live mode, and nothing in demo mode is
//    purchasable: no prices in real money, no store buttons that pretend to work.
// ===================================================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../core/api';
import { demoDelay } from '../demo/state';
import { isDemo } from './env';
import { getSupabase } from './supabase';

export { api } from './api';
export { isDemo } from './env';
export { authKeys, userKey } from './keys';

export interface Source<T> {
  /** Demo mode: return fixtures (sync or async). Runs after a short simulated delay. */
  demo: () => T | Promise<T>;
  /** Real backend: Supabase (rpc/select) or the Worker (api). */
  live: () => Promise<T>;
}

export async function fromSource<T>(source: Source<T>): Promise<T> {
  if (isDemo) {
    await demoDelay();
    return source.demo();
  }
  return source.live();
}

/** The Supabase client, for the `live` branch only (throws in demo mode). */
export function db(): SupabaseClient {
  return getSupabase();
}

/**
 * A failed Supabase call, keeping what errors.ts reads: `message` is the SQL exception name
 * ('insufficient_coins'), `details` its number, `code` the SQLSTATE, `status` the HTTP status (retry.ts
 * never retries a 4xx).
 */
export class DataError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string | null;

  constructor(status: number, message: string, code: string, details: string | null) {
    super(message);
    this.name = 'DataError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface PostgrestLike<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string | null } | null;
  status: number;
}

function toDataError(error: NonNullable<PostgrestLike<unknown>['error']>, status: number): DataError {
  return new DataError(status, error.message, error.code ?? '', error.details ?? null);
}

/**
 * Await a supabase-js query and return its data, or throw a DataError.
 *
 *   const rows = await select(db().from('series').select(SERIES_COLUMNS).eq('slug', slug));
 */
export async function select<T>(query: PromiseLike<PostgrestLike<T>>): Promise<T> {
  const { data, error, status } = await query;
  if (error) throw toDataError(error, status);
  return data as T;
}

/**
 * Call a public RPC. With `parse` (a zod-backed check returning null when the shape is wrong) the result
 * is checked, and a wrong shape throws `invalid_response`; without it the raw result comes back.
 *
 *   await rpc('accept_terms', { p_tos_version: TERMS_VERSION });
 *   const wallet = await rpc('get_my_wallet', undefined, parseWallet);
 */
export async function rpc<T = unknown>(
  fn: string,
  args?: Record<string, unknown>,
  parse?: (raw: unknown) => T | null,
): Promise<T> {
  const { data, error, status } = await getSupabase().rpc(fn, args);
  if (error) throw toDataError(error, status);
  if (!parse) return data as T;
  const parsed = parse(data);
  if (parsed === null) throw new ApiError(status, 'invalid_response');
  return parsed;
}
