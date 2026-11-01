// Access codes (web only: App Store 3.1.1). The checks here are the Worker's own (POST /api/codes/redeem:
// 6 to 40 letters, digits and dashes), so a typo never leaves the browser. The server checks again.

import type { RedeemResponse } from '@reeltale/shared';
import { formatDay, type Locales } from '../logic/dates.ts';
import type { TextSpec } from '../logic/walletView.ts';

export const CODE_MIN = 6;
export const CODE_MAX = 40;

/** Whitespace out (pasted codes pick it up). The case is kept: the database upper-cases it. */
export function normalizeCode(input: string): string {
  return input.replace(/\s+/g, '');
}

export function isCodeFormat(code: string): boolean {
  return code.length >= CODE_MIN && code.length <= CODE_MAX && /^[A-Za-z0-9-]+$/.test(code);
}

/** A Turnstile site key (public by design) from EXPO_PUBLIC_TURNSTILE_SITE_KEY; null when missing or odd. */
export function parseSiteKey(raw: string | undefined): string | null {
  const key = raw?.trim() ?? '';
  return /^[0-9A-Za-z_-]{8,64}$/.test(key) ? key : null;
}

/** The lines to show after a successful call. Every one is a key of the `redeem` namespace. */
export function redeemMessages(res: RedeemResponse, locale?: Locales): TextSpec[] {
  if (res.status === 'already_redeemed') return [{ key: 'redeem:success.already', params: {} }];
  const lines: TextSpec[] = [];
  const coins = res.coins ?? 0;
  if (coins > 0) {
    const date = res.coins_expire_at ? formatDay(res.coins_expire_at, locale) : '';
    lines.push(date
      ? { key: 'redeem:success.coins', params: { count: coins, date } }
      : { key: 'redeem:success.coinsOnly', params: { count: coins } });
  }
  const days = res.ai_days ?? 0;
  if (days > 0) lines.push({ key: 'redeem:success.ai', params: { count: days } });
  return lines.length > 0 ? lines : [{ key: 'redeem:success.done', params: {} }];
}
