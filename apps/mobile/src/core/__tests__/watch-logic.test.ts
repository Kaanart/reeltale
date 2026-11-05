import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EpisodePrice } from '@reeltale/shared';
import { ApiError } from '../api.ts';
import { describeEpisodePrice, type EpisodeAccessView } from '../pricing.ts';
import {
  isAiContent, mayRequestPlayback, pageAccess, playbackFreshForMs, PLAYBACK_REFRESH_MARGIN_S, watchAccessView,
} from '../../features/watch/logic/access.ts';
import { mediaUrl } from '../../features/watch/logic/media.ts';
import { endOffer, NEXT_COUNTDOWN_S, secondsLeft } from '../../features/watch/logic/next.ts';
import {
  clampIndex, holdsPlayer, pageForKey, pageFromOffset, pageRole, playerWindow, startIndex, PLAYER_RADIUS,
} from '../../features/watch/logic/pager.ts';
import {
  isComplete, MAX_POSITION_S, progressByEpisode, ProgressThrottle, resumePosition, SAVE_INTERVAL_MS, toPositionS,
} from '../../features/watch/logic/progress.ts';
import { parseUnlockResult, unlockFailure, unlockSheetView, type WalletFacts } from '../../features/watch/logic/unlock.ts';
import { clock, SCRUB_STEP_S, secondsAt, stepSeconds } from '../../features/watch/logic/scrub.ts';

// The watch track's pure logic: what a page may do with an episode, the player window, watch progress, the
// unlock sheet's states and the end-of-episode offer.

const price = (over: Partial<EpisodePrice> = {}): EpisodePrice => ({
  purchasable: true, free: false, own: false, base_price: 20, discount_pct: 0, price: 20, reason: 'priced', unlocked: false, ...over,
});
const view = (over: Partial<EpisodePrice> = {}): EpisodeAccessView => describeEpisodePrice(price(over));

/** A PostgREST error as supabase-js reports it: `message` is the SQL exception name, `details` its number. */
const pgError = (message: string, details: string | null = null) => ({ message, details, code: '22023' });

// ---- Access: never ask for playback of a locked episode ------------------------------------------------

test('only a watchable episode may ask for a playback URL', () => {
  assert.equal(mayRequestPlayback(view({ unlocked: true })), true);
  assert.equal(mayRequestPlayback(view({ free: true, price: 0, base_price: 0, reason: 'free' })), true);
  assert.equal(mayRequestPlayback(view({ own: true, free: true, reason: 'own_episode' })), true);

  assert.equal(mayRequestPlayback(view()), false, 'locked');
  assert.equal(mayRequestPlayback(view({ purchasable: false, reason: 'mature_opt_in_required' })), false);
  assert.equal(mayRequestPlayback(view({ purchasable: false, reason: 'not_available' })), false);
  assert.equal(mayRequestPlayback(null), false, 'not checked yet');
  assert.equal(mayRequestPlayback(undefined), false);
});

test('a page shows play, locked, mature, unavailable or loading', () => {
  assert.equal(pageAccess(null), 'loading');
  assert.equal(pageAccess(view()), 'locked');
  assert.equal(pageAccess(view({ unlocked: true })), 'play');
  assert.equal(pageAccess(view({ purchasable: false, reason: 'mature_opt_in_required' })), 'mature');
  assert.equal(pageAccess(view({ purchasable: false, reason: 'not_available' })), 'unavailable');
});

test('a buyer keeps an unlocked episode after it closes to new buyers or its series is hidden', () => {
  // What get_episode_price answers then (resolve_episode_price: not published -> not_available), while
  // svc.playback_check still serves it to the buyer (reason 'unlocked').
  const closed = price({ purchasable: false, base_price: 0, price: 0, reason: 'not_available', unlocked: true });
  const listed = { status: 'closed_to_new', moderation_status: 'approved' } as const;
  assert.equal(pageAccess(watchAccessView(closed, listed)), 'play');
  assert.equal(mayRequestPlayback(watchAccessView(closed, { status: 'published', moderation_status: 'approved' })), true);

  // Never for a removed or rejected episode, never past the mature opt-in, and not without an unlock.
  assert.equal(pageAccess(watchAccessView(closed, { status: 'removed', moderation_status: 'approved' })), 'unavailable');
  assert.equal(pageAccess(watchAccessView(closed, { status: 'closed_to_new', moderation_status: 'rejected' })), 'unavailable');
  assert.equal(pageAccess(watchAccessView({ ...closed, reason: 'mature_opt_in_required' }, listed)), 'mature');
  assert.equal(pageAccess(watchAccessView({ ...closed, unlocked: false }, listed)), 'unavailable');

  // Everything else reads exactly like describeEpisodePrice.
  for (const p of [price(), price({ unlocked: true }), price({ free: true, price: 0, base_price: 0, reason: 'free' }),
    price({ discount_pct: 10, price: 18 })]) {
    assert.deepEqual(watchAccessView(p, listed), describeEpisodePrice(p));
  }
  assert.equal(watchAccessView(null, listed), null);
  assert.equal(watchAccessView(undefined, listed), null);
});

test('AI series and AI episodes are recognised for the AI label', () => {
  assert.equal(isAiContent({ format: 'ai_generated', origin: 'creator' }), true);
  assert.equal(isAiContent({ format: 'live_action', origin: 'ai_story' }), true);
  assert.equal(isAiContent({ format: 'live_action', origin: 'creator' }, { kind: 'ai_comic' }), true);
  assert.equal(isAiContent({ format: 'stop_motion', origin: 'creator' }, { kind: 'ai_video' }), true);
  assert.equal(isAiContent({ format: 'stop_motion', origin: 'creator' }, { kind: 'video' }), false);
  assert.equal(isAiContent({ format: 'live_action', origin: 'creator' }, null), false);
});

test('a playback URL is reused until shortly before it expires', () => {
  const now = 1_000_000_000_000;
  const expires = now / 1000 + 2 * 3600;
  assert.equal(playbackFreshForMs(expires, now), (2 * 3600 - PLAYBACK_REFRESH_MARGIN_S) * 1000);
  assert.equal(playbackFreshForMs(now / 1000 + 60, now), 0, 'inside the margin: fetch a new one');
  assert.equal(playbackFreshForMs(now / 1000 - 10, now), 0, 'expired');
  assert.equal(playbackFreshForMs(Number.NaN, now), 0);
});

// ---- Media URLs ----------------------------------------------------------------------------------------

test('poster keys become media URLs; odd keys and origins do not', () => {
  assert.equal(mediaUrl('public/posters/e1/a1.jpg'), 'https://media.reeltale.net/public/posters/e1/a1.jpg');
  assert.equal(mediaUrl('public/covers/x.jpg', 'https://media-staging.reeltale.net/'), 'https://media-staging.reeltale.net/public/covers/x.jpg');
  for (const bad of [null, undefined, '', 'posters/a.jpg', 'public/../secret', 'public//a.jpg', 'public/./a', '/public/a.jpg',
    'public/a b.jpg', 'public/a?x=1', 'public/a#b', 'https://evil.example/public/a.jpg', `public/${'a'.repeat(600)}`]) {
    assert.equal(mediaUrl(bad), null, String(bad));
  }
  assert.equal(mediaUrl('public/covers/x.jpg', 'http://media.reeltale.net'), null, 'https only');
  assert.equal(mediaUrl('public/covers/x.jpg', 'https://media.reeltale.net/evil?'), null);
});

// ---- The pager: at most three players -----------------------------------------------------------------

test('only the visible page and its neighbours hold a player: at most three at once', () => {
  for (const count of [1, 2, 3, 10]) {
    for (let active = 0; active < count; active += 1) {
      const holders = Array.from({ length: count }, (_, i) => i).filter((i) => holdsPlayer(pageRole(i, active)));
      assert.ok(holders.length <= 2 * PLAYER_RADIUS + 1, `${holders.length} players`);
      assert.deepEqual(holders, playerWindow(active, count));
      assert.ok(holders.includes(active));
    }
  }
  assert.equal(pageRole(5, 5), 'active');
  assert.equal(pageRole(4, 5), 'warm');
  assert.equal(pageRole(7, 5), 'poster');
  assert.equal(pageRole(9, 5), 'idle');
  assert.deepEqual(playerWindow(0, 5), [0, 1]);
  assert.deepEqual(playerWindow(4, 5), [3, 4]);
});

test('the page a scroll settles on, and where the pager opens', () => {
  assert.equal(pageFromOffset(0, 800, 5), 0);
  assert.equal(pageFromOffset(1590, 800, 5), 2, 'rounds to the nearest page');
  assert.equal(pageFromOffset(99_999, 800, 5), 4, 'clamped');
  assert.equal(pageFromOffset(-50, 800, 5), 0);
  assert.equal(pageFromOffset(100, 0, 5), 0);
  assert.equal(clampIndex(3, 0), 0);
  assert.equal(clampIndex(Number.NaN, 4), 0);

  const eps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(startIndex(eps, 'b'), 1);
  assert.equal(startIndex(eps, 'zzz'), 0);
});

test('keyboard paging on the web', () => {
  assert.equal(pageForKey('ArrowDown', 0, 3), 1);
  assert.equal(pageForKey('PageUp', 2, 3), 1);
  assert.equal(pageForKey('End', 0, 3), 2);
  assert.equal(pageForKey('Home', 2, 3), 0);
  assert.equal(pageForKey('ArrowDown', 2, 3), null, 'already last');
  assert.equal(pageForKey('ArrowUp', 0, 3), null, 'already first');
  assert.equal(pageForKey(' ', 1, 3), null, 'space is play/pause, not ours');
});

// ---- Watch progress -------------------------------------------------------------------------------------

test('positions fit the column (0..120 whole seconds)', () => {
  assert.equal(toPositionS(12.9), 12);
  assert.equal(toPositionS(500), MAX_POSITION_S);
  assert.equal(toPositionS(-3), 0);
  assert.equal(toPositionS(Number.NaN), 0);
  assert.equal(toPositionS(Number.POSITIVE_INFINITY), 0);
});

test('an episode counts as watched near its end', () => {
  assert.equal(isComplete(88, 90), true);
  assert.equal(isComplete(86, 90), true, '95 %');
  assert.equal(isComplete(60, 90), false);
  assert.equal(isComplete(10, null), false, 'unknown duration');
  assert.equal(isComplete(0, 90), false);
});

test('playback resumes where it stopped, except near either end or once finished', () => {
  assert.equal(resumePosition({ position_s: 40, completed: false }, 90), 40);
  assert.equal(resumePosition({ position_s: 2, completed: false }, 90), 0, 'barely started');
  assert.equal(resumePosition({ position_s: 88, completed: false }, 90), 0, 'at the end');
  assert.equal(resumePosition({ position_s: 40, completed: true }, 90), 0, 'finished: watch again from the start');
  assert.equal(resumePosition(null, 90), 0);
  assert.equal(resumePosition({ position_s: 40, completed: false }, null), 40);
});

test('watch_progress rows are read by episode, and bad rows are skipped', () => {
  const map = progressByEpisode([
    { episode_id: 'a', position_s: 30, completed: false },
    { episode_id: 'b', position_s: 999, completed: true },
    { episode_id: 7, position_s: 3 },
    null,
    { episode_id: 'c', position_s: '10' },
  ]);
  assert.deepEqual([...map.keys()], ['a', 'b']);
  assert.deepEqual(map.get('b'), { position_s: MAX_POSITION_S, completed: true });
  assert.equal(progressByEpisode('nope').size, 0);
});

test('progress is saved at most every few seconds while playing, and at once on pause or the end', () => {
  const th = new ProgressThrottle();
  const t0 = 1_000_000;
  assert.equal(th.next(1, 90, t0), null, 'not worth a row yet');
  assert.deepEqual(th.next(2, 90, t0 + 1000), { position_s: 2, completed: false }, 'first real position');
  assert.equal(th.next(5, 90, t0 + 3000), null, 'too soon');
  assert.deepEqual(th.next(12, 90, t0 + 1000 + SAVE_INTERVAL_MS), { position_s: 12, completed: false });
  assert.deepEqual(th.next(14, 90, t0 + 1000 + SAVE_INTERVAL_MS + 500, true), { position_s: 14, completed: false }, 'pause saves now');
  assert.equal(th.next(14, 90, t0 + 99_000, true), null, 'nothing new');
  assert.deepEqual(th.next(88, 90, t0 + 99_500), { position_s: 88, completed: true }, 'the end saves now');
  // Completed stays completed, even when the viewer scrubs back.
  assert.deepEqual(th.next(10, 90, t0 + 999_000, true), { position_s: 10, completed: true });
});

test('a forced save without any watching writes nothing', () => {
  const th = new ProgressThrottle();
  assert.equal(th.next(0, 90, 0, true), null);
  assert.deepEqual(th.next(1, 90, 10, true), { position_s: 1, completed: false });
});

// ---- The unlock sheet -------------------------------------------------------------------------------------

const wallet = (over: Partial<WalletFacts> = {}): WalletFacts => ({ balance: 100, refundDebt: 0, freePassesLeft: 1, ...over });

test('server errors become what the sheet offers next', () => {
  assert.deepEqual(unlockFailure(pgError('price_changed', '25')), { kind: 'price_changed', price: 25 });
  assert.deepEqual(unlockFailure(pgError('insufficient_coins', '7')), { kind: 'insufficient', shortBy: 7 });
  assert.deepEqual(unlockFailure(pgError('refund_debt_outstanding', '40')), { kind: 'debt', debt: 40 });
  assert.deepEqual(unlockFailure(pgError('no_free_pass_left')), { kind: 'no_free_pass' });
  assert.deepEqual(unlockFailure(new ApiError(400, 'price_changed', 30)), { kind: 'price_changed', price: 30 });
  assert.deepEqual(unlockFailure(pgError('price_changed')), { kind: 'price_changed', price: null });
  assert.deepEqual(unlockFailure(new Error('Failed to fetch')), { kind: 'other' });
  assert.deepEqual(unlockFailure(pgError('mature_opt_in_required')), { kind: 'other' });
});

test('the sheet: a priced episode with enough coins offers the unlock at the shown price', () => {
  const v = unlockSheetView({ access: view(), wallet: wallet(), failure: null });
  assert.equal(v.kind, 'locked');
  if (v.kind !== 'locked') return;
  assert.equal(v.price, 20);
  assert.equal(v.canUnlock, true);
  assert.equal(v.shortBy, 0);
  assert.equal(v.balanceAfter, 80);
  assert.equal(v.freePasses, 1);
  assert.equal(v.discounted, false);
});

test('the sheet shows the VIP discount struck through', () => {
  const v = unlockSheetView({ access: view({ base_price: 20, discount_pct: 10, price: 18 }), wallet: wallet(), failure: null });
  assert.ok(v.kind === 'locked');
  assert.equal(v.price, 18);
  assert.equal(v.basePrice, 20);
  assert.equal(v.discounted, true);
  assert.equal(v.discountPct, 10);
});

test('price_changed: the new price is shown and is what the next tap sends', () => {
  const failure = unlockFailure(pgError('price_changed', '25'));
  const v = unlockSheetView({ access: view(), wallet: wallet(), failure });
  assert.ok(v.kind === 'locked');
  assert.equal(v.price, 25);
  assert.equal(v.priceChangedTo, 25);
  assert.equal(v.discounted, false);
  // Once the refetched price agrees, the notice stays until the next attempt but the price is the server's.
  const agreed = unlockSheetView({ access: view({ base_price: 25, price: 25 }), wallet: wallet(), failure });
  assert.ok(agreed.kind === 'locked');
  assert.equal(agreed.price, 25);
});

test('not enough coins: no unlock button, the shortfall and the way to the wallet', () => {
  const v = unlockSheetView({ access: view({ price: 30, base_price: 30 }), wallet: wallet({ balance: 12 }), failure: null });
  assert.ok(v.kind === 'locked');
  assert.equal(v.canUnlock, false);
  assert.equal(v.shortBy, 18);
  assert.equal(v.balanceAfter, null);
  const fromServer = unlockSheetView({ access: view(), wallet: null, failure: unlockFailure(pgError('insufficient_coins', '5')) });
  assert.ok(fromServer.kind === 'locked');
  assert.equal(fromServer.shortBy, 5);
  assert.equal(fromServer.canUnlock, false);
});

test('a refund debt blocks coin unlocks until it is covered', () => {
  const v = unlockSheetView({ access: view(), wallet: wallet({ refundDebt: 40 }), failure: null });
  assert.ok(v.kind === 'locked');
  assert.equal(v.debt, 40);
  assert.equal(v.canUnlock, false);
  const fromServer = unlockSheetView({ access: view(), wallet: wallet(), failure: unlockFailure(pgError('refund_debt_outstanding', '9')) });
  assert.ok(fromServer.kind === 'locked');
  assert.equal(fromServer.debt, 9);
});

test('nothing to unlock, not available, or still loading', () => {
  assert.deepEqual(unlockSheetView({ access: null, wallet: null, failure: null }), { kind: 'loading' });
  assert.deepEqual(unlockSheetView({ access: view({ unlocked: true }), wallet: null, failure: null }), { kind: 'playable' });
  assert.deepEqual(unlockSheetView({ access: view({ free: true, reason: 'free' }), wallet: null, failure: null }), { kind: 'playable' });
  assert.deepEqual(
    unlockSheetView({ access: view({ purchasable: false, reason: 'mature_opt_in_required' }), wallet: null, failure: null }),
    { kind: 'unavailable', reason: 'mature' },
  );
  assert.deepEqual(
    unlockSheetView({ access: view({ purchasable: false, reason: 'not_available' }), wallet: null, failure: null }),
    { kind: 'unavailable', reason: 'not_available' },
  );
});

test('an unknown wallet never blocks the button (the server has the last word)', () => {
  const v = unlockSheetView({ access: view(), wallet: undefined, failure: null });
  assert.ok(v.kind === 'locked');
  assert.equal(v.canUnlock, true);
  assert.equal(v.balance, null);
  assert.equal(v.freePasses, null);
});

test('unlock_episode and use_free_pass results are read strictly', () => {
  assert.deepEqual(parseUnlockResult({ status: 'unlocked', coins_spent: 20, balance: 80 }), { status: 'unlocked', balance: 80, freePassesLeft: null });
  assert.deepEqual(parseUnlockResult({ status: 'unlocked', free_passes_left: 0 }), { status: 'unlocked', balance: null, freePassesLeft: 0 });
  assert.deepEqual(parseUnlockResult({ status: 'already_unlocked' }), { status: 'already_unlocked', balance: null, freePassesLeft: null });
  assert.deepEqual(parseUnlockResult({ status: 'free', balance: 5 }), { status: 'free', balance: 5, freePassesLeft: null });
  assert.equal(parseUnlockResult({ status: 'charged' }), null);
  assert.equal(parseUnlockResult(null), null);
  assert.equal(parseUnlockResult('unlocked'), null);
});

// ---- The end of an episode -------------------------------------------------------------------------------

test('the next episode starts by itself only when it can be watched', () => {
  assert.deepEqual(endOffer(0, 3, 'play'), { kind: 'next', index: 1, countdown: true, locked: false });
  assert.deepEqual(endOffer(0, 3, 'locked'), { kind: 'next', index: 1, countdown: false, locked: true });
  assert.deepEqual(endOffer(1, 3, 'loading'), { kind: 'next', index: 2, countdown: false, locked: false });
  assert.deepEqual(endOffer(1, 3, null), { kind: 'next', index: 2, countdown: false, locked: false });
  assert.deepEqual(endOffer(2, 3, 'play'), { kind: 'end' });
  assert.deepEqual(endOffer(-1, 3, 'play'), { kind: 'end' });
});

test('the countdown counts whole seconds down to zero', () => {
  assert.equal(secondsLeft(1000, 1000), NEXT_COUNTDOWN_S);
  assert.equal(secondsLeft(1000, 1001), NEXT_COUNTDOWN_S);
  assert.equal(secondsLeft(1000, 2000), NEXT_COUNTDOWN_S - 1);
  assert.equal(secondsLeft(1000, 1000 + NEXT_COUNTDOWN_S * 1000), 0);
  assert.equal(secondsLeft(1000, 999_999), 0);
  assert.equal(secondsLeft(5000, 1000), NEXT_COUNTDOWN_S, 'a clock that went back does not add time');
});

// ---- Scrubber: drag or tap the bar to skip ---------------------------------------------------------------

test('secondsAt: the second under the finger, clamped to the video', () => {
  assert.equal(secondsAt(0, 200, 61), 0);
  assert.equal(secondsAt(100, 200, 61), 30.5);
  assert.equal(secondsAt(200, 200, 61), 61);
  assert.equal(secondsAt(-40, 200, 61), 0, 'dragged off the left end');
  assert.equal(secondsAt(500, 200, 61), 61, 'dragged off the right end');
  assert.equal(secondsAt(50, 0, 61), 0, 'not laid out yet');
  assert.equal(secondsAt(50, 200, 0), 0, 'duration unknown');
  assert.equal(secondsAt(Number.NaN, 200, 61), 0);
});

test('stepSeconds: a screen reader step is 5 s, inside the video', () => {
  assert.equal(SCRUB_STEP_S, 5);
  assert.equal(stepSeconds(10, 61, 1), 15);
  assert.equal(stepSeconds(10, 61, -1), 5);
  assert.equal(stepSeconds(59, 61, 1), 61);
  assert.equal(stepSeconds(2, 61, -1), 0);
});

test('clock: minutes and seconds, hours when needed', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(7.9), '0:07');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(750), '12:30');
  assert.equal(clock(3723), '1:02:03');
  assert.equal(clock(-3), '0:00');
  assert.equal(clock(Number.NaN), '0:00');
});
