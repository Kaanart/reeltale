// What a page may do with an episode: play it, offer the unlock sheet, or explain why not. Pure (tested in
// src/core/__tests__/watch-logic.test.ts).
//
// The rule that matters: a playback URL is only ever requested for an episode get_episode_price says the
// user may watch (unlocked, free or their own). A locked episode shows its poster and the unlock sheet.
// The Worker checks again (402 `locked`), but the app never asks.

import type { EpisodePrice } from '@reeltale/shared';
import { describeEpisodePrice, type EpisodeAccessView } from '../../../core/pricing.ts';
import type { EpisodeRow, SeriesRow } from '../../../lib/types.ts';

export type PageAccess = 'loading' | 'play' | 'locked' | 'mature' | 'unavailable';

/**
 * get_episode_price as the player reads it: core/pricing.ts describeEpisodePrice, with one difference. An
 * episode the user unlocked stays theirs after it closes to new buyers or its series is hidden: the price
 * check then says "not available" (there is nothing left to sell), but svc.playback_check still serves it
 * to the buyer. A removed or rejected episode is not served (takedowns re-credit buyers instead).
 */
export function watchAccessView(
  price: EpisodePrice | null | undefined,
  episode: Pick<EpisodeRow, 'status' | 'moderation_status'>,
): EpisodeAccessView | null {
  if (!price) return null;
  const view = describeEpisodePrice(price);
  if (view.state === 'unavailable' && price.unlocked && price.reason === 'not_available'
    && episode.status !== 'removed' && episode.moderation_status !== 'rejected') {
    return { ...view, state: 'unlocked' };
  }
  return view;
}

export function pageAccess(view: EpisodeAccessView | null | undefined): PageAccess {
  if (!view) return 'loading';
  switch (view.state) {
    case 'unlocked':
    case 'own':
    case 'free':
      return 'play';
    case 'locked':
      return 'locked';
    case 'mature_opt_in_required':
      return 'mature';
    default:
      return 'unavailable';
  }
}

/** True only when the price check says the user may watch. Undefined (not checked yet) is false. */
export function mayRequestPlayback(view: EpisodeAccessView | null | undefined): boolean {
  return pageAccess(view) === 'play';
}

/** AI-made episodes and series always carry the AI label. */
export function isAiContent(series: Pick<SeriesRow, 'format' | 'origin'>, episode?: Pick<EpisodeRow, 'kind'> | null): boolean {
  return series.format === 'ai_generated' || series.origin === 'ai_story'
    || episode?.kind === 'ai_comic' || episode?.kind === 'ai_video';
}

/** Ask for a new playback URL this long before the signed one expires. */
export const PLAYBACK_REFRESH_MARGIN_S = 300;

/** How long a playback URL (expires_at in seconds since the epoch) stays usable for a new player, in ms. */
export function playbackFreshForMs(expiresAtS: number, nowMs: number): number {
  if (!Number.isFinite(expiresAtS)) return 0;
  return Math.max(0, (expiresAtS - PLAYBACK_REFRESH_MARGIN_S) * 1000 - nowMs);
}
