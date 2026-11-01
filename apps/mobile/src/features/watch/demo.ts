// Demo mode for the watch track: prices, unlocks, Free Passes and watch progress over the shared fixtures,
// with no network. Pure (no React Native; the placeholder video is in ./demoMedia.ts), so node tests it in
// src/core/__tests__/watch-demo.test.ts.
//
// The rules mirror the SQL (app_private.resolve_episode_price, public.unlock_episode, public.use_free_pass)
// closely enough to show every state of the sheet: free episodes, priced ones, a mature series behind the
// opt-in, AI series that are free until an Editor's Pick, price_changed, insufficient_coins and the daily
// Free Pass. Coins here are fixture numbers: nothing in demo mode is bought.
//
// Shared with the other tracks, so the demo tells one story: the wallet is the Me track's cell ('me.wallet'),
// watch progress is the catalog's (its "continue watching" rows resume here, and what is watched here shows
// there), and every unlock is also reported to the catalog's lock badges (markDemoUnlocked).

import type { EpisodePrice, Wallet } from '@reeltale/shared';
import { DEFAULT_PRICING, basePrice } from '../../core/pricing.ts';
import { demoEpisodes, demoEpisodesOf, demoSeriesById, demoWallet } from '../../demo/fixtures.ts';
import { demoState } from '../../demo/state.ts';
import type { EpisodeRow, SeriesRow } from '../../lib/types.ts';
import { demoProgress, markDemoUnlocked, recordDemoProgress } from '../catalog/demo.ts';
import { progressByEpisode, toPositionS, type SavedProgress } from './logic/progress.ts';
import type { UnlockOutcome } from './logic/unlock.ts';

/** The demo wallet. Same cell name as the Me track's wallet screen (features/README.md), so coins spent here show there. */
export const demoWalletCell = demoState<Wallet>('me.wallet', () => demoWallet());
/** Episodes unlocked in this demo session. */
export const demoUnlocksCell = demoState<ReadonlySet<string>>('watch.unlocks', () => new Set<string>());

function recordUnlock(episodeId: string): void {
  demoUnlocksCell.set((prev) => new Set([...prev, episodeId]));
  markDemoUnlocked(episodeId);
}

/** An error shaped like a PostgREST one (`message` is the SQL exception name, `details` its number), for errors.ts. */
export class DemoRpcError extends Error {
  readonly details: string | null;

  constructor(code: string, detail?: number) {
    super(code);
    this.name = 'DemoRpcError';
    this.details = detail === undefined ? null : String(detail);
  }
}

export interface DemoWatchSeries {
  series: SeriesRow;
  episodes: EpisodeRow[];
}

/** The series an episode belongs to, with all its episodes in order. Null for an unknown id. */
export function demoWatchSeries(episodeId: string): DemoWatchSeries | null {
  const episode = demoEpisodes.find((e) => e.id === episodeId);
  const series = episode ? demoSeriesById(episode.series_id) : undefined;
  if (!episode || !series) return null;
  return { series, episodes: demoEpisodesOf(series.id) };
}

interface Resolved {
  purchasable: boolean;
  free: boolean;
  basePrice: number;
  reason: string;
}

function resolve(episodeId: string, matureOptIn: boolean): Resolved {
  const episode = demoEpisodes.find((e) => e.id === episodeId);
  const series = episode ? demoSeriesById(episode.series_id) : undefined;
  if (!episode || !series) return { purchasable: false, free: false, basePrice: 0, reason: 'not_available' };
  if (series.maturity === 'mature' && !matureOptIn) {
    return { purchasable: false, free: false, basePrice: 0, reason: 'mature_opt_in_required' };
  }
  const free = episode.is_free || episode.number <= series.free_episode_count
    || (series.format === 'ai_generated' && !series.editors_pick);
  if (free) return { purchasable: true, free: true, basePrice: 0, reason: 'free' };
  const base = basePrice(
    { priceCoins: episode.price_coins, seriesDefaultPrice: series.default_price_coins, durationS: episode.duration_s },
    DEFAULT_PRICING,
  );
  return { purchasable: true, free: false, basePrice: base, reason: 'priced' };
}

/** public.get_episode_price for the demo account (no VIP tier, so no discount). */
export function demoEpisodePrice(episodeId: string, opts: { matureOptIn: boolean }): EpisodePrice {
  const r = resolve(episodeId, opts.matureOptIn);
  return {
    purchasable: r.purchasable,
    free: r.free,
    own: false,
    base_price: r.basePrice,
    discount_pct: 0,
    price: r.basePrice,
    reason: r.reason,
    unlocked: demoUnlocksCell.get().has(episodeId),
  };
}

/** Take coins from the wallet the way spend_coins does: bonus lots that expire soonest first, then paid coins. */
function spend(wallet: Wallet, coins: number): Wallet {
  let left = coins;
  const expiring = [...wallet.expiring]
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at))
    .map((lot) => {
      const take = Math.min(lot.coins, left);
      left -= take;
      return { ...lot, coins: lot.coins - take };
    })
    .filter((lot) => lot.coins > 0);
  const paid = wallet.paid - left;
  const bonus = expiring.reduce((sum, lot) => sum + lot.coins, 0);
  return { ...wallet, expiring, paid, bonus, balance: paid + bonus };
}

/** public.unlock_episode(p_episode, p_expected_price) in demo mode. Throws DemoRpcError like the SQL raises. */
export function demoUnlock(episodeId: string, expectedPrice: number, opts: { matureOptIn: boolean }): UnlockOutcome {
  const wallet = demoWalletCell.get();
  if (demoUnlocksCell.get().has(episodeId)) return { status: 'already_unlocked', balance: wallet.balance, freePassesLeft: null };
  const r = resolve(episodeId, opts.matureOptIn);
  if (!r.purchasable) throw new DemoRpcError(r.reason);
  if (r.free) return { status: 'free', balance: wallet.balance, freePassesLeft: null };
  if (expectedPrice !== r.basePrice) throw new DemoRpcError('price_changed', r.basePrice);
  if (wallet.refund_debt > 0) throw new DemoRpcError('refund_debt_outstanding', wallet.refund_debt);
  if (wallet.balance < r.basePrice) throw new DemoRpcError('insufficient_coins', r.basePrice - wallet.balance);

  const next = spend(wallet, r.basePrice);
  demoWalletCell.set(next);
  recordUnlock(episodeId);
  return { status: 'unlocked', balance: next.balance, freePassesLeft: null };
}

/** public.use_free_pass(p_episode) in demo mode. */
export function demoUseFreePass(episodeId: string, opts: { matureOptIn: boolean }): UnlockOutcome {
  if (demoUnlocksCell.get().has(episodeId)) return { status: 'already_unlocked', balance: null, freePassesLeft: null };
  const r = resolve(episodeId, opts.matureOptIn);
  if (!r.purchasable) throw new DemoRpcError(r.reason);
  if (r.free) return { status: 'free', balance: null, freePassesLeft: null };
  const wallet = demoWalletCell.get();
  if (wallet.free_passes_left <= 0) throw new DemoRpcError('no_free_pass_left');

  const left = wallet.free_passes_left - 1;
  demoWalletCell.set({ ...wallet, free_passes_left: left });
  recordUnlock(episodeId);
  return { status: 'unlocked', balance: null, freePassesLeft: left };
}

/** watch_progress for these episodes (the catalog's demo rows). */
export function demoProgressFor(episodeIds: readonly string[]): Map<string, SavedProgress> {
  const all = progressByEpisode(demoProgress());
  const out = new Map<string, SavedProgress>();
  for (const id of episodeIds) {
    const row = all.get(id);
    if (row) out.set(id, row);
  }
  return out;
}

/** Save progress like the live path: a completed row stays completed. */
export function demoSaveProgress(episodeId: string, progress: SavedProgress): void {
  const before = progressByEpisode(demoProgress()).get(episodeId);
  const completed = progress.completed || (before?.completed ?? false);
  recordDemoProgress(episodeId, toPositionS(progress.position_s), completed);
}
