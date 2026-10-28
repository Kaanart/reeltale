// Verifies Supabase access tokens locally against the project's JWKS (asymmetric signing keys), so
// no request needs a round trip to Supabase Auth. Rejects anything that isn't a signed-in adult.

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export type AuthFailure = 'missing_token' | 'invalid_token' | 'not_authenticated' | 'not_adult';

export class AuthError extends Error {
  readonly reason: AuthFailure;
  constructor(reason: AuthFailure) {
    super(reason);
    this.reason = reason;
  }
}

export interface VerifiedUser {
  userId: string;
  claims: JWTPayload & { role?: string; age_ok?: boolean; is_anonymous?: boolean };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jwksCache = new Map<string, JWTVerifyGetKey>();

export function supabaseJwks(supabaseUrl: string): JWTVerifyGetKey {
  const url = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  let set = jwksCache.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
    jwksCache.set(url, set);
  }
  return set;
}

export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}

/**
 * Verify a Supabase access token. `requireAdult` (the default) also requires the age_ok claim that
 * public.custom_access_token_hook adds; a token minted before the date of birth was set fails here
 * until the app refreshes its session.
 */
export async function verifyUserJwt(
  token: string | null,
  opts: { jwks: JWTVerifyGetKey; issuer: string; requireAdult?: boolean },
): Promise<VerifiedUser> {
  if (!token) throw new AuthError('missing_token');
  let payload: VerifiedUser['claims'];
  try {
    const res = await jwtVerify(token, opts.jwks, {
      issuer: opts.issuer,
      audience: 'authenticated',
      algorithms: ['ES256', 'RS256', 'EdDSA'],
      clockTolerance: 30,
    });
    payload = res.payload as VerifiedUser['claims'];
  } catch {
    throw new AuthError('invalid_token');
  }
  if (payload.role !== 'authenticated' || payload.is_anonymous === true || !payload.sub || !UUID.test(payload.sub)) {
    throw new AuthError('not_authenticated');
  }
  if ((opts.requireAdult ?? true) && payload.age_ok !== true) {
    throw new AuthError('not_adult');
  }
  return { userId: payload.sub, claims: payload };
}
