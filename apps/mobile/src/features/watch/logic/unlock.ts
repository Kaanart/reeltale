// The unlock sheet's state: what it shows for a price, a wallet and the last failed attempt. Pure (tested in
// src/core/__tests__/watch-logic.test.ts).
//
// The server decides everything (public.unlock_episode / public.use_free_pass); this only turns its answers
// into what the sheet offers next:
//   price_changed            show the new price; the user taps again (never charged a price they didn't see)
//   insufficient_coins       "you need N more coins" and a way to the wallet
//   refund_debt_outstanding  explain the debt and a way to the wallet
//   no_free_pass_left        the Free Pass button goes away
// Auto-unlock doesn't exist: every unlock is one explicit tap.

import { errorCodeOf } from '../../../core/errors.ts';
import type { EpisodeAccessView } from '../../../core/pricing.ts';

export type UnlockFailure =
  | { kind: 'price_changed'; price: number | null }
  | { kind: 'insufficient'; shortBy: number | null }
  | { kind: 'debt'; debt: number | null }
  | { kind: 'no_free_pass' }
  | { kind: 'other' };

const count = (n: number | undefined): number | null => (n !== undefined && Number.isInteger(n) && n >= 0 ? n : null);

export function unlockFailure(err: unknown): UnlockFailure {
  const { code, detail } = errorCodeOf(err);
  switch (code) {
    case 'price_changed':
      return { kind: 'price_changed', price: count(detail) };
    case 'insufficient_coins':
      return { kind: 'insufficient', shortBy: count(detail) };
    case 'refund_debt_outstanding':
      return { kind: 'debt', debt: count(detail) };
    case 'no_free_pass_left':
      return { kind: 'no_free_pass' };
    default:
      return { kind: 'other' };
  }
}

/** The parts of get_my_wallet the sheet needs. */
export interface WalletFacts {
  balance: number;
  refundDebt: number;
  freePassesLeft: number;
}

export type SheetView =
  | { kind: 'loading' }
  /** Nothing to unlock (any more): unlocked, free or the user's own. The sheet closes and the episode plays. */
  | { kind: 'playable' }
  | { kind: 'unavailable'; reason: 'mature' | 'not_available' }
  | {
      kind: 'locked';
      /** What tapping "Unlock" charges, and sends as p_expected_price. */
      price: number;
      /** The price before the VIP discount, shown struck through when `discounted`. */
      basePrice: number;
      discountPct: number;
      discounted: boolean;
      /** Null until the wallet has loaded. */
      balance: number | null;
      /** Coins missing for this unlock (0 when there are enough, or the wallet isn't known yet). */
      shortBy: number;
      /** Refund debt: unlocking with coins is blocked until it's paid off. */
      debt: number;
      /** Null until the wallet has loaded. */
      freePasses: number | null;
      /** True when the coin button can be offered (the server still has the last word). */
      canUnlock: boolean;
      /** Set after price_changed: the new price, for the "it's now N coins" notice. */
      priceChangedTo: number | null;
      /** Balance after this unlock, when it is known and enough. */
      balanceAfter: number | null;
    };

export function unlockSheetView(input: {
  access: EpisodeAccessView | null | undefined;
  wallet: WalletFacts | null | undefined;
  failure: UnlockFailure | null | undefined;
}): SheetView {
  const { access, wallet, failure } = input;
  if (!access) return { kind: 'loading' };
  if (access.state === 'unlocked' || access.state === 'own' || access.state === 'free') return { kind: 'playable' };
  if (access.state === 'mature_opt_in_required') return { kind: 'unavailable', reason: 'mature' };
  if (access.state !== 'locked') return { kind: 'unavailable', reason: 'not_available' };

  // After price_changed the error carries the new price; it wins until the refetched price agrees.
  const changedTo = failure?.kind === 'price_changed' ? failure.price : null;
  const overridden = changedTo !== null && changedTo !== access.price;
  const price = overridden ? changedTo : access.price;

  const balance = wallet ? wallet.balance : null;
  const fromWallet = balance !== null ? Math.max(0, price - balance) : 0;
  const fromFailure = failure?.kind === 'insufficient' ? (failure.shortBy ?? 0) : 0;
  const shortBy = Math.max(fromWallet, fromFailure);
  const debt = Math.max(wallet?.refundDebt ?? 0, failure?.kind === 'debt' ? (failure.debt ?? 0) : 0);
  const canUnlock = shortBy === 0 && debt === 0;

  return {
    kind: 'locked',
    price,
    basePrice: overridden ? price : access.basePrice,
    discountPct: overridden ? 0 : access.discountPct,
    discounted: overridden ? false : access.discounted,
    balance,
    shortBy,
    debt,
    freePasses: wallet ? Math.max(0, wallet.freePassesLeft) : null,
    canUnlock,
    priceChangedTo: failure?.kind === 'price_changed' ? price : null,
    balanceAfter: canUnlock && balance !== null ? balance - price : null,
  };
}

export type UnlockStatus = 'unlocked' | 'already_unlocked' | 'free';

export interface UnlockOutcome {
  status: UnlockStatus;
  /** Coins left after unlock_episode (null for a Free Pass, which doesn't report it). */
  balance: number | null;
  /** Free Passes left after use_free_pass (null for a coin unlock). */
  freePassesLeft: number | null;
}

const STATUSES: readonly string[] = ['unlocked', 'already_unlocked', 'free'];

/** unlock_episode / use_free_pass return jsonb: { status, balance?, coins_spent?, free_passes_left? }. */
export function parseUnlockResult(raw: unknown): UnlockOutcome | null {
  if (!raw || typeof raw !== 'object') return null;
  const { status, balance, free_passes_left: passes } = raw as Record<string, unknown>;
  if (typeof status !== 'string' || !STATUSES.includes(status)) return null;
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  return { status: status as UnlockStatus, balance: int(balance), freePassesLeft: int(passes) };
}
