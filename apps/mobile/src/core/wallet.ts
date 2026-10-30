// Summary of public.get_my_wallet() for the wallet screen, the coin chip and the expiry reminders.
//
// What the SQL returns (20261027090300_ledger.sql):
//   balance           spendable coins now: paid + bonus
//   paid              lots that never expire (bought coins)
//   bonus             lots that expire later (VIP grants, trial, promo, returned coins)
//   refund_debt       coins owed after a refund of coins that were already spent; unlocks and AI are blocked until it is 0
//   expiring          one entry per bonus lot, soonest first: { coins, expires_at, source }
//   free_passes_left  today's Free Passes (UTC day)
// Numbers are as of the fetch. Refetch when the screen gains focus. A lot whose date has passed since
// then is dropped, and its coins come off `bonus` and `balance` too (the SQL computes all three at the
// same moment, so bonus is exactly the sum of `expiring`): a stale response never says "expires in 0 days"
// and never shows coins the server would no longer count.

import { WalletSchema, type Wallet } from '@reeltale/shared';

const DAY_MS = 86_400_000;

/** Bonus lots that expire within this many days count as "expiring soon". */
export const EXPIRING_SOON_DAYS = 7;

/** `unknown` in, a valid Wallet or null out. A malformed response is never half-shown. */
export function parseWallet(raw: unknown): Wallet | null {
  const r = WalletSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * How a bonus lot is labelled. The raw `source` is a ledger term (it includes 'code', and the native
 * apps never mention access codes), so screens use this group and the matching `wallet.source.*` string.
 */
export type BonusGroup = 'vip' | 'trial' | 'bonus' | 'returned' | 'test';

export function bonusGroup(source: string): BonusGroup {
  switch (source) {
    case 'sub_grant': return 'vip';
    case 'trial': return 'trial';
    case 'refund_return': return 'returned';
    case 'sandbox': return 'test';
    default: return 'bonus'; // promo, code, admin, and anything added later
  }
}

export interface ExpiringLot {
  coins: number;
  expiresAt: Date;
  group: BonusGroup;
  msLeft: number;
  /** Whole days left, rounded up: 1 means "within a day". */
  daysLeft: number;
  /** Within EXPIRING_SOON_DAYS. */
  soon: boolean;
}

export interface WalletSummary {
  balance: number;
  paid: number;
  bonus: number;
  refundDebt: number;
  freePassesLeft: number;
  /** True while refund debt blocks unlocking and AI. */
  blockedByDebt: boolean;
  /** All bonus lots that haven't expired yet, soonest first. */
  expiring: ExpiringLot[];
  expiringSoon: ExpiringLot[];
  expiringSoonCoins: number;
  nextExpiry: ExpiringLot | null;
}

export function summarizeWallet(
  wallet: Wallet,
  now: Date = new Date(),
  opts: { soonDays?: number } = {},
): WalletSummary {
  const soonMs = (opts.soonDays ?? EXPIRING_SOON_DAYS) * DAY_MS;
  const expiring: ExpiringLot[] = [];
  let expiredCoins = 0;
  for (const lot of wallet.expiring) {
    const expiresAt = new Date(lot.expires_at);
    const msLeft = expiresAt.getTime() - now.getTime();
    // An unreadable date can't be shown, and a lot past its date is already gone (from the totals as well).
    if (!Number.isNaN(msLeft) && msLeft <= 0 && lot.coins > 0) expiredCoins += lot.coins;
    if (Number.isNaN(msLeft) || msLeft <= 0 || lot.coins <= 0) continue;
    expiring.push({
      coins: lot.coins,
      expiresAt,
      group: bonusGroup(lot.source),
      msLeft,
      daysLeft: Math.ceil(msLeft / DAY_MS),
      soon: msLeft <= soonMs,
    });
  }
  expiring.sort((a, b) => a.msLeft - b.msLeft || b.coins - a.coins);
  const expiringSoon = expiring.filter((l) => l.soon);
  return {
    balance: Math.max(0, wallet.balance - expiredCoins),
    paid: wallet.paid,
    bonus: Math.max(0, wallet.bonus - expiredCoins),
    refundDebt: wallet.refund_debt,
    freePassesLeft: wallet.free_passes_left,
    blockedByDebt: wallet.refund_debt > 0,
    expiring,
    expiringSoon,
    expiringSoonCoins: expiringSoon.reduce((sum, l) => sum + l.coins, 0),
    nextExpiry: expiring[0] ?? null,
  };
}
