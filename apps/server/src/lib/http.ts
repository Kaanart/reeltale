// Shared HTTP helpers: security headers, JSON errors, and mapping database errors to responses.

import type { Context } from 'hono';
import { DbError } from './db.ts';

/** Headers for every response. HTML gets a strict CSP on top (see withHtmlSecurity). */
export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * CSP for the web app. Scripts only from our own origin (no inline scripts; Expo's web export emits
 * external bundles). Media from Cloudflare Stream; API calls to Supabase and our own /api.
 */
export function htmlCsp(supabaseUrl: string, mediaOrigin = ''): string {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : '';
  const media = mediaOrigin ? new URL(mediaOrigin).origin : '';
  const supabaseWs = supabase ? supabase.replace(/^https:/, 'wss:') : '';
  return [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${media} https://*.cloudflarestream.com`.replace(/\s+/g, ' '),
    "media-src 'self' blob: https://*.cloudflarestream.com",
    `connect-src 'self' ${supabase} ${supabaseWs} https://*.cloudflarestream.com`.trim(),
    "font-src 'self' data:",
    'frame-src https://challenges.cloudflare.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function withSecurityHeaders(res: Response, csp?: string): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) out.headers.set(k, v);
  const type = out.headers.get('Content-Type') ?? '';
  if (csp && type.includes('text/html')) out.headers.set('Content-Security-Policy', csp);
  return out;
}

export function jsonError(c: Context, status: number, error: string, extra: Record<string, unknown> = {}) {
  return c.json({ error, ...extra }, status as 400);
}

// Error names our SQL raises on purpose, safe to pass to the client as-is.
const CLIENT_SAFE_DB_ERRORS = new Set([
  'not_authenticated', 'not_adult', 'insufficient_coins', 'price_changed', 'refund_debt_outstanding',
  'not_available', 'mature_opt_in_required', 'episode_not_found', 'no_free_pass_left', 'invalid_code',
  'code_used_up', 'upload_not_allowed', 'upload_consent_required', 'ai_access_required', 'rate_limited',
  'episode_not_ready', 'series_not_found', 'invalid_date_of_birth', 'date_of_birth_already_set',
  'ai_consent_required', 'mode_unavailable', 'invalid_choice', 'scene_not_found', 'scene_not_continuable',
  'scene_in_progress',
  // Trust & safety (notice form, editor tools)
  'not_found', 'report_not_found', 'report_mismatch', 'not_eligible', 'conflict_of_interest', 'not_an_editor',
  'invalid_ground', 'invalid_statement', 'invalid_decision', 'invalid_status', 'invalid_version', 'invalid_target',
  'invalid_reason', 'invalid_details', 'invalid_notifier',
]);

function statusFor(error: string): number {
  if (error === 'not_authenticated') return 401;
  if (error === 'not_adult' || error === 'ai_access_required' || error === 'ai_consent_required') return 403;
  if (error === 'not_an_editor' || error === 'conflict_of_interest') return 403;
  if (error === 'not_found' || error.endsWith('_not_found')) return 404;
  if (error === 'rate_limited') return 429;
  if (error.startsWith('invalid_') || error === 'mode_unavailable') return 400;
  return 409;
}

/** Map a database error to a response without leaking internals. */
export function dbErrorResponse(c: Context, err: unknown) {
  if (err instanceof DbError) {
    if (err.status === 503) return jsonError(c, 503, 'service_unavailable');
    if (CLIENT_SAFE_DB_ERRORS.has(err.message)) {
      return jsonError(c, statusFor(err.message), err.message, err.details && /^\d+$/.test(err.details) ? { detail: Number(err.details) } : {});
    }
  }
  console.error('db error', err instanceof Error ? err.message : err);
  return jsonError(c, 500, 'internal_error');
}

/**
 * Read a request body as text, refusing (null) anything over `max` bytes without buffering it: unauthenticated
 * endpoints check signatures and tokens only after reading, so an unbounded read would let anyone make the
 * Worker hold a huge body in memory.
 */
export async function readCappedText(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get('Content-Length') ?? 0) > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
