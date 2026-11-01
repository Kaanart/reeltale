// Input checks for the sign-in and birthday screens, and which message a sign-in failure shows. Pure
// (tested in src/core/__tests__/auth-validation.test.ts). The server checks everything again.

import { describeError } from '../../core/errors.ts';

export const CODE_LENGTH = 6;
/** Supabase's default minimum gap between two codes to the same address (auth.email.max_frequency). */
export const RESEND_SECONDS = 60;

/** Trimmed and lower-cased: what we send and compare. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** A plausible address (one @, a dot in the domain, no spaces). Supabase decides for real. */
export function isValidEmail(input: string): boolean {
  const email = normalizeEmail(input);
  return email.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);
}

/** Digits only, at most CODE_LENGTH of them (for typing and pasting "123 456"). */
export function cleanCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}

/** The three birthday fields as YYYY-MM-DD for checkDateOfBirth (which reports what's wrong with it). */
export function dobText(day: string, month: string, year: string): string {
  const d = day.trim();
  const m = month.trim();
  const y = year.trim();
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return '';
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** A sign-in attempt the user stopped (closed the Apple sheet): show nothing. */
export class SignInCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SignInCancelled';
  }
}

/** A provider this build or project can't use (Apple on Android, a provider switched off in Supabase). */
export class SignInUnavailable extends Error {
  constructor() {
    super('provider_unavailable');
    this.name = 'SignInUnavailable';
  }
}

const UNAVAILABLE_CODES = new Set(['provider_disabled', 'oauth_provider_not_supported', 'provider_unavailable']);

export interface ErrorText {
  key: string;
  params: { count?: number };
}

/** The message for a failed sign-in step, or null when there is nothing to say (cancelled). */
export function signInErrorText(err: unknown): ErrorText | null {
  if (err instanceof SignInCancelled) return null;
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  if (err instanceof SignInUnavailable || (typeof code === 'string' && UNAVAILABLE_CODES.has(code))) {
    return { key: 'errors:sign_in_unavailable', params: {} };
  }
  const info = describeError(err);
  return { key: info.key, params: info.params };
}
