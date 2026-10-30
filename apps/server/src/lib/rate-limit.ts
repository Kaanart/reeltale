// Rate limits with the Workers Rate Limiting binding (configured in wrangler.jsonc). The binding counts per
// Cloudflare location and is approximate and eventually consistent: it stops floods and runaway clients,
// it is not an exact quota. Exact caps that matter (AI starts per day, coins) live in the database.
//
// - Signed-in /api/*: per user (RATE_LIMIT_USER), plus a strict per-user limit on POST /api/ai/*
//   (RATE_LIMIT_AI), which start paid generation.
// - Unauthenticated: per client address (RATE_LIMIT_IP): /api/* calls that fail auth, and the database
//   lookup behind /series/:slug share pages. Addresses are a coarse key (a whole mobile carrier can
//   share one), so they're only used where there is no user.
// - Not limited: /api/health, signed webhooks, association files (static, fetched by Apple's and Google's
//   crawlers).
// A missing binding (Node tests, wrangler dev without it) allows everything, and so does a binding error
// (logged): the limiter must never take the API down with it.

import type { Context, MiddlewareHandler } from 'hono';
import type { AppContext } from '../env.ts';
import { jsonError } from './http.ts';

/** Every binding's period in wrangler.jsonc is 60 s, so a client that waits this long is never early. */
export const RETRY_AFTER_SECONDS = 60;

export async function underLimit(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (err) {
    console.error('rate limiter failed', err instanceof Error ? err.message : err);
    return true;
  }
}

/** 429 { error: 'rate_limited' } with Retry-After. */
export function rateLimited(c: Context) {
  c.header('Retry-After', String(RETRY_AFTER_SECONDS));
  return jsonError(c, 429, 'rate_limited');
}

/** For signed-in /api/* routes; runs after the auth middleware has set userId. */
export const userRateLimit: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!(await underLimit(c.env.RATE_LIMIT_USER, `user:${c.get('userId')}`))) return rateLimited(c);
  await next();
};

/** For /api/ai/*: POSTs start (paid) generation, so they also count against the strict limit. */
export const aiRateLimit: MiddlewareHandler<AppContext> = async (c, next) => {
  if (c.req.method === 'POST' && !(await underLimit(c.env.RATE_LIMIT_AI, `ai:${c.get('userId')}`))) {
    return rateLimited(c);
  }
  await next();
};

/** Unauthenticated traffic, keyed by the client address Cloudflare's edge sets (clients can't forge it). */
export function ipUnderLimit(c: Context<AppContext>, scope: 'api' | 'share'): Promise<boolean> {
  return underLimit(c.env.RATE_LIMIT_IP, `${scope}:${clientIpKey(c.req.header('CF-Connecting-IP'))}`);
}

/**
 * The key for a client address: IPv4 as is; IPv6 by its /64, the block one subscriber usually gets (so
 * hopping between addresses in it doesn't reset the count); anything unparseable shares one 'unknown' key.
 */
export function clientIpKey(ip: string | null | undefined): string {
  const s = (ip ?? '').trim().toLowerCase();
  if (isIpv4(s)) return s;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped && isIpv4(mapped[1]!)) return mapped[1]!;
  const groups = ipv6Groups(s);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : 'unknown';
}

function isIpv4(s: string): boolean {
  const parts = s.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** The eight groups of an IPv6 address (no leading zeros), or null. Zone ids are dropped. */
function ipv6Groups(s: string): string[] | null {
  const addr = s.split('%')[0]!;
  if (!addr.includes(':')) return null;
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ''));
}
