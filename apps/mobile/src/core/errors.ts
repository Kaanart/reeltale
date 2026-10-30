// From any error to something a screen can show: an i18n key, its numbers, and what the app should do next.
//
// Raw server text never reaches the user. Everything the app can get back is reduced to a short code
// (the Worker's `error` names, the SQL exception names that PostgREST passes through as `message`,
// Supabase Auth's `code`, and a few client-side ones), and each code maps to a string we wrote.
// Anything we don't know falls back to the generic message; the code stays on the result for logging.
//
// Keys are i18next `namespace:path` keys, for example `errors:insufficient_coins`. Redeem errors live in
// their own namespace (`redeem`) because that screen exists on the web only (App Store 3.1.1).

import { ApiError } from './api.ts';

/** What the app should offer or do about an error, beyond showing the message. */
export type ErrorAction =
  | 'none'
  | 'retry'            // try the same thing again (possibly after a moment)
  | 'refresh_session'  // refresh the Supabase session once, then retry; sign in again if that fails
  | 'sign_in'
  | 'verify_age'       // refresh the session; if still not adult, show the birthday screen
  | 'blocked'          // the account is blocked: show the blocked screen
  | 'buy_coins'
  | 'refresh_price'    // reload the price and show the new one
  | 'mature_opt_in'
  | 'upload_consent'
  | 'ai_consent'
  | 'ai_access';       // AI stories need coins or VIP

interface Entry {
  key: string;
  /** Used instead of `key` when the error carries a number (coins short, new price, debt). The string is a plural: `_one` / `_other`. */
  withCount?: string;
  action?: ErrorAction;
  retryable?: boolean;
}

const e = (key: string, action: ErrorAction = 'none', extra: Partial<Entry> = {}): Entry => ({ key: `errors:${key}`, action, ...extra });
const web = (code: string): Entry => ({ key: `redeem:errors.${code}`, action: 'none' });

/** Every code we know, and what to say. */
const CATALOG: Record<string, Entry> = {
  // Sign-in and session: the Worker (missing_token, invalid_token, not_authenticated, not_adult) and SQL.
  missing_token: e('session_expired', 'refresh_session'),
  invalid_token: e('session_expired', 'refresh_session'),
  not_authenticated: e('session_expired', 'sign_in'),
  not_adult: e('not_adult', 'verify_age'),

  // Supabase Auth `code`s (email code and password sign-in, session refresh).
  otp_expired: e('otp_expired'),
  otp_disabled: e('sign_in_unavailable'),
  signup_disabled: e('sign_in_unavailable'),
  email_provider_disabled: e('sign_in_unavailable'),
  email_address_not_authorized: e('sign_in_unavailable'),
  flow_state_expired: e('sign_in_expired'),
  flow_state_not_found: e('sign_in_expired'),
  invalid_credentials: e('invalid_credentials'),
  email_not_confirmed: e('invalid_credentials'),
  email_address_invalid: e('email_invalid'),
  validation_failed: e('bad_request'),
  over_email_send_rate_limit: e('rate_limited', 'retry', { retryable: true }),
  over_request_rate_limit: e('rate_limited', 'retry', { retryable: true }),
  over_sms_send_rate_limit: e('rate_limited', 'retry', { retryable: true }),
  user_banned: e('account_unavailable', 'blocked'),
  user_not_found: e('account_unavailable', 'sign_in'),
  session_expired: e('session_expired', 'sign_in'),
  session_not_found: e('session_expired', 'sign_in'),
  refresh_token_not_found: e('session_expired', 'sign_in'),
  refresh_token_already_used: e('session_expired', 'sign_in'),
  bad_jwt: e('session_expired', 'refresh_session'),
  no_authorization: e('session_expired', 'refresh_session'),

  // Coins and unlocking.
  insufficient_coins: e('insufficient_coins', 'buy_coins', { withCount: 'errors:insufficient_coins_count' }),
  price_changed: e('price_changed', 'refresh_price', { withCount: 'errors:price_changed_count' }),
  locked: e('locked', 'none', { withCount: 'errors:locked_count' }),
  refund_debt_outstanding: e('refund_debt_outstanding', 'buy_coins', { withCount: 'errors:refund_debt_outstanding_count' }),
  no_free_pass_left: e('no_free_pass_left'),

  // Watching.
  not_found: e('not_found'),
  episode_not_found: e('not_found'),
  series_not_found: e('not_found'),
  scene_not_found: e('not_found'),
  not_available: e('not_available'),
  no_media: e('not_available'),
  unsupported_media: e('not_available'),
  episode_removed: e('removed'),
  series_removed: e('removed'),
  mature_opt_in_required: e('mature_opt_in_required', 'mature_opt_in'),

  // Creating and uploading.
  upload_not_allowed: e('upload_not_allowed'),
  upload_consent_required: e('upload_consent_required', 'upload_consent'),
  upload_unavailable: e('upload_unavailable', 'retry', { retryable: true }),
  episode_not_ready: e('episode_not_ready'),
  episode_not_published: e('episode_not_ready'),
  episode_rejected: e('episode_rejected'),
  episode_cannot_be_unpublished: e('episode_cannot_be_unpublished'),
  edit_requires_review: e('edit_requires_review'),
  ai_series_free_until_editors_pick: e('ai_series_free_until_editors_pick'),
  invalid_title: e('invalid_title'),
  invalid_synopsis: e('invalid_synopsis'),
  invalid_maturity: e('bad_request'),
  invalid_format: e('bad_request'),
  invalid_status: e('bad_request'),
  too_many_tags: e('too_many_tags'),
  unknown_tag: e('unknown_tag'),

  // Account and consent.
  invalid_date_of_birth: e('invalid_date_of_birth'),
  date_of_birth_already_set: e('date_of_birth_already_set'),
  profile_missing: e('profile_missing', 'retry', { retryable: true }),
  invalid_tos_version: e('bad_request'),
  invalid_purpose: e('bad_request'),
  invalid_consent: e('bad_request'),

  // AI stories (routes and RPCs).
  ai_access_required: e('ai_access_required', 'ai_access'),
  ai_consent_required: e('ai_consent_required', 'ai_consent'),
  mode_unavailable: e('mode_unavailable'),
  invalid_choice: e('invalid_choice'),
  scene_not_continuable: e('scene_not_continuable'),
  scene_in_progress: e('scene_in_progress'),
  generation_unavailable: e('generation_unavailable', 'retry', { retryable: true }),

  // Reports, blocks and editor tools.
  target_not_found: e('target_not_found'),
  invalid_reason: e('invalid_reason'),
  invalid_details: e('invalid_details'),
  invalid_notifier: e('invalid_notifier'),
  cannot_block_self: e('cannot_block_self'),
  report_not_found: e('report_not_found'),
  report_mismatch: e('report_mismatch'),
  not_eligible: e('not_eligible'),
  conflict_of_interest: e('conflict_of_interest'),
  not_an_editor: e('not_an_editor'),
  invalid_ground: e('invalid_ground'),
  invalid_statement: e('invalid_statement'),
  invalid_decision: e('invalid_decision'),
  invalid_version: e('invalid_version'),
  invalid_target: e('invalid_target'),

  // Limits, the Worker and the network.
  rate_limited: e('rate_limited', 'retry', { retryable: true }),
  bad_request: e('bad_request'),
  service_unavailable: e('service_unavailable', 'retry', { retryable: true }),
  not_configured: e('service_unavailable', 'retry', { retryable: true }),
  playback_not_configured: e('service_unavailable', 'retry', { retryable: true }),
  uploads_not_configured: e('service_unavailable', 'retry', { retryable: true }),
  internal_error: e('generic', 'retry', { retryable: true }),
  server_error: e('generic', 'retry', { retryable: true }),
  invalid_response: e('generic', 'retry', { retryable: true }),
  aborted: e('generic'),
  network_error: e('network', 'retry', { retryable: true }),
  timeout: e('timeout', 'retry', { retryable: true }),
  offline: e('offline', 'retry', { retryable: true }),

  // Web only: the redeem screen (never shown in the native apps).
  invalid_code: web('invalid_code'),
  code_used_up: web('code_used_up'),
  web_only: web('web_only'),
  turnstile_failed: web('turnstile_failed'),
};

const FALLBACK: Entry = e('generic', 'retry', { retryable: true });

/** Every code that has its own mapping. */
export const ERROR_CODES: readonly string[] = Object.keys(CATALOG);

/** Every i18n key describeError can return, plural variants included. For tests and tooling. */
export const ERROR_KEYS: readonly string[] = [...new Set(
  [FALLBACK, ...Object.values(CATALOG)].flatMap((x) => [x.key, ...(x.withCount ? [x.withCount] : [])]),
)];

export interface ErrorInfo {
  /** The short code (safe to log and to send to Sentry). */
  code: string;
  /** False when the code had no mapping of its own and the generic message was used. */
  known: boolean;
  /** i18next key. Pass `params` to t(). */
  key: string;
  params: { count?: number };
  action: ErrorAction;
  retryable: boolean;
}

const BARE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
// What fetch throws when there is no connection: Hermes/React Native, Chrome, Safari, Firefox.
const NETWORK_MESSAGE = /network request failed|failed to fetch|load failed|networkerror|network error/i;

/** Pull a code (and the number the server attached, if any) out of whatever was thrown or returned. */
export function errorCodeOf(err: unknown): { code: string; detail?: number } {
  if (err instanceof ApiError) return { code: err.code, ...(err.detail !== undefined ? { detail: err.detail } : {}) };
  if (typeof err === 'string') return BARE_CODE.test(err) ? { code: err } : { code: 'unknown_error' };
  if (!err || typeof err !== 'object') return { code: 'unknown_error' };
  const o = err as { code?: unknown; message?: unknown; details?: unknown; name?: unknown };

  // Errors that already carry one of our codes (ApiError from another realm, Supabase Auth's `code`).
  if (typeof o.code === 'string' && Object.hasOwn(CATALOG, o.code)) return { code: o.code };
  // supabase-js reports a lost connection as this error class.
  if (o.name === 'AuthRetryableFetchError') return { code: 'network_error' };
  if (typeof o.message === 'string') {
    // PostgREST: `message` is the exception name from `raise exception 'name'`, `details` its detail ("30").
    if (BARE_CODE.test(o.message)) {
      const detail = typeof o.details === 'string' && /^\d{1,9}$/.test(o.details) ? Number(o.details) : undefined;
      return { code: o.message, ...(detail !== undefined ? { detail } : {}) };
    }
    if (NETWORK_MESSAGE.test(o.message)) return { code: 'network_error' };
  }
  return { code: 'unknown_error' };
}

/**
 * What to show for an error. `offline: true` (from the app's connectivity state) turns a network failure or
 * timeout into the "you're offline" message.
 */
export function describeError(err: unknown, opts: { offline?: boolean } = {}): ErrorInfo {
  let { code, detail } = errorCodeOf(err);
  if (opts.offline && (code === 'network_error' || code === 'timeout')) code = 'offline';
  const entry = Object.hasOwn(CATALOG, code) ? CATALOG[code] : undefined;
  const hasCount = detail !== undefined && Number.isFinite(detail) && detail >= 0;
  const picked = entry ?? FALLBACK;
  const useCount = hasCount && !!picked.withCount;
  return {
    code,
    known: !!entry,
    key: useCount && picked.withCount ? picked.withCount : picked.key,
    params: useCount ? { count: detail } : {},
    action: picked.action ?? 'none',
    retryable: picked.retryable ?? false,
  };
}
