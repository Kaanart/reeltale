// Demo-mode data for the Me track: what the wallet, consents, subscriptions, blocks and reports hold when
// the app runs without a backend. Pure (node checks the shapes in src/core/__tests__/me-logic.test.ts). Each
// cell lives until sign-out or reload (src/demo/state.ts); nothing is saved and nothing leaves the device.
//
// The wallet cell is the one the whole app should read in demo mode (the unlock sheet spends from it too).

import type { Wallet } from '@reeltale/shared';
import { demoEpisodes, demoSeriesById, demoWallet } from '../../demo/fixtures.ts';
import { demoState } from '../../demo/state.ts';
import type { BlockRow } from './logic/blocks.ts';
import type { ConsentRow } from './logic/consent.ts';
import type { ReportTargetType } from './logic/report.ts';
import type { SubscriptionRow } from './logic/subscription.ts';

/** public.get_my_wallet() of the demo account. */
export const demoWalletCell = demoState<Wallet>('me.wallet', () => demoWallet());

/** public.ai_consents of the demo account: none given yet, so the switches start off like a new account's. */
export const demoConsentsCell = demoState<ConsentRow[]>('me.consents', () => []);

/** public.subscriptions of the demo account: no VIP (nothing is purchasable in the demo). */
export const demoSubscriptionsCell = demoState<SubscriptionRow[]>('me.subscriptions', () => []);

/** public.blocks of the demo account: nobody blocked yet. */
export const demoBlocksCell = demoState<BlockRow[]>('me.blocks', () => []);

export interface DemoReport {
  id: number;
  target_type: string;
  target_id: string;
  reason: string;
}

/** Reports "sent" in the demo. */
export const demoReportsCell = demoState<DemoReport[]>('me.reports', () => []);

/** The creator of a demo series or episode (series.creator_id), as useContentOwner reads it live; else null. */
export function demoContentOwner(type: ReportTargetType | null, id: string | null): string | null {
  if (!id) return null;
  if (type === 'series') return demoSeriesById(id)?.creator_id ?? null;
  if (type === 'episode') {
    const episode = demoEpisodes.find((e) => e.id === id);
    return episode ? (demoSeriesById(episode.series_id)?.creator_id ?? null) : null;
  }
  return null;
}
