// Minimal PostgREST client for Supabase RPCs. Two ways in, matching the SQL rules in CLAUDE.md:
// - asService(): the secret key, for svc.* functions only (service_role).
// - asUser(jwt): the publishable key plus the user's own JWT, for public.* user RPCs, so Postgres sees
//   the real user and RLS/auth.uid() apply. The Worker never calls a user RPC with the secret key.

import type { Env } from '../env.ts';

export class DbError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: string | undefined;
  constructor(status: number, message: string, code?: string, details?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Schema = 'public' | 'svc';

export interface Db {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
}

function client(env: Env, schema: Schema, headers: Record<string, string>, fetchImpl: typeof fetch): Db {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(fn)) throw new Error(`invalid function name ${fn}`);
      if (!env.SUPABASE_URL) throw new DbError(503, 'database not configured');
      const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Profile': schema,
          'Accept-Profile': schema,
        },
        body: JSON.stringify(args),
      });
      const text = await res.text();
      if (!res.ok) {
        // PostgREST error body: { code, message, details, hint }. Postgres raises our error names as
        // the message (e.g. "insufficient_coins"); callers map those to user-facing errors.
        let parsed: { message?: string; code?: string; details?: string } = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          /* non-JSON error */
        }
        throw new DbError(res.status, parsed.message ?? `rpc ${fn} failed`, parsed.code, parsed.details);
      }
      return (text ? JSON.parse(text) : null) as T;
    },
  };
}

export function serviceDb(env: Env, fetchImpl: typeof fetch = fetch): Db {
  if (!env.SUPABASE_SECRET_KEY) throw new DbError(503, 'service key not configured');
  return client(env, 'svc', { apikey: env.SUPABASE_SECRET_KEY }, fetchImpl);
}

export function userDb(env: Env, userJwt: string, fetchImpl: typeof fetch = fetch): Db {
  return client(env, 'public', { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${userJwt}` }, fetchImpl);
}
