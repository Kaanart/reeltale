// What the player offers when an episode ends. Pure (tested in src/core/__tests__/watch-logic.test.ts).
//
// A next episode that can be watched starts after a short countdown the viewer can stop. A next episode
// that is locked (or not checked yet) never starts by itself: the viewer moves there with a tap and finds
// the poster and the unlock button. Nothing is ever unlocked on its own.

import type { PageAccess } from './access.ts';

/** Seconds the "Next episode in N" countdown runs. */
export const NEXT_COUNTDOWN_S = 5;

export type EndOffer =
  /** Offer the next episode; `countdown` when it may start by itself. */
  | { kind: 'next'; index: number; countdown: boolean; locked: boolean }
  /** The last episode: "You're all caught up". */
  | { kind: 'end' };

export function endOffer(index: number, count: number, nextAccess: PageAccess | null | undefined): EndOffer {
  const next = index + 1;
  if (!Number.isInteger(index) || index < 0 || next >= count) return { kind: 'end' };
  return { kind: 'next', index: next, countdown: nextAccess === 'play', locked: nextAccess === 'locked' };
}

/** Whole seconds left of a countdown that started at `startedAt` (ms), never below 0. */
export function secondsLeft(startedAt: number, now: number, totalS: number = NEXT_COUNTDOWN_S): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return totalS;
  const elapsed = Math.max(0, now - startedAt);
  return Math.max(0, Math.ceil(totalS - elapsed / 1000));
}
