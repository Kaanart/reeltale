import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { describeError, errorCodeOf } from '../errors.ts';
import { demoEpisodesOf, demoSeries } from '../../demo/fixtures.ts';
import { resetDemoState } from '../../demo/state.ts';
import { demoEpisodePrice as catalogDemoPrice, demoProgress } from '../../features/catalog/demo.ts';
import {
  demoEpisodePrice, demoProgressFor, demoSaveProgress, demoUnlock, demoUseFreePass, demoWalletCell, demoWatchSeries,
} from '../../features/watch/demo.ts';
import { unlockFailure } from '../../features/watch/logic/unlock.ts';

// Demo mode of the watch track: the same answers the SQL gives (prices, unlocks, Free Pass, progress), over the
// shared fixtures, with no network. Every state of the unlock sheet can be reached.

const adult = { matureOptIn: false };
const optedIn = { matureOptIn: true };

function episodesOf(slug: string) {
  const series = demoSeries.find((s) => s.slug === slug);
  assert.ok(series, slug);
  return demoEpisodesOf(series.id);
}

function episode(slug: string, number: number) {
  const ep = episodesOf(slug)[number - 1];
  assert.ok(ep, `${slug} #${number}`);
  return ep;
}

/** Run `fn`, expect the SQL-style error `code`, and return it. */
function rejects(fn: () => unknown, code: string): unknown {
  try {
    fn();
  } catch (err) {
    assert.equal(errorCodeOf(err).code, code);
    return err;
  }
  assert.fail(`expected ${code}`);
}

beforeEach(() => resetDemoState());

test('an episode opens its whole series, in order', () => {
  const ep = episode('salt-and-static', 4);
  const found = demoWatchSeries(ep.id);
  assert.ok(found);
  assert.equal(found.series.slug, 'salt-and-static');
  assert.deepEqual(found.episodes.map((e) => e.number), found.episodes.map((_, i) => i + 1));
  assert.ok(found.episodes.some((e) => e.id === ep.id));
  assert.equal(demoWatchSeries('00000000-0000-4000-8000-000000000000'), null);
});

test('prices follow the SQL: free episodes, priced ones, the opt-in, and AI series free until an Editor’s Pick', () => {
  const free = demoEpisodePrice(episode('salt-and-static', 1).id, adult);
  assert.equal(free.free, true);
  assert.equal(free.purchasable, true);

  const priced = demoEpisodePrice(episode('salt-and-static', 4).id, adult);
  assert.deepEqual(
    { free: priced.free, price: priced.price, base: priced.base_price, discount: priced.discount_pct, unlocked: priced.unlocked },
    { free: false, price: 20, base: 20, discount: 0, unlocked: false },
  );

  const mature = demoEpisodePrice(episode('night-shift-at-the-wax-museum', 4).id, adult);
  assert.equal(mature.purchasable, false);
  assert.equal(mature.reason, 'mature_opt_in_required');
  assert.equal(demoEpisodePrice(episode('night-shift-at-the-wax-museum', 4).id, optedIn).price, 25);

  assert.equal(demoEpisodePrice(episode('neon-ronin', 5).id, adult).free, true, 'AI, not an Editor’s Pick');
  assert.equal(demoEpisodePrice(episode('low-tide', 5).id, adult).free, false, 'AI and an Editor’s Pick');

  const unknown = demoEpisodePrice('00000000-0000-4000-8000-000000000000', adult);
  assert.equal(unknown.purchasable, false);
  assert.equal(unknown.reason, 'not_available');
});

test('unlocking spends the bonus coins that expire first, then marks the episode unlocked everywhere', () => {
  const ep = episode('salt-and-static', 4);
  const before = demoWalletCell.get();
  const out = demoUnlock(ep.id, 20, adult);
  assert.equal(out.status, 'unlocked');
  assert.equal(out.balance, before.balance - 20);

  const after = demoWalletCell.get();
  assert.equal(after.paid, before.paid, 'paid coins untouched while bonus coins last');
  assert.equal(after.bonus, before.bonus - 20);
  assert.equal(after.balance, after.paid + after.bonus);

  assert.equal(demoEpisodePrice(ep.id, adult).unlocked, true);
  assert.equal(catalogDemoPrice(ep.id).unlocked, true, 'the catalog’s lock badge follows');
  assert.equal(demoUnlock(ep.id, 20, adult).status, 'already_unlocked');
  assert.equal(demoWalletCell.get().balance, after.balance, 'never charged twice');
});

test('a price the sheet didn’t show is refused with price_changed and the real price', () => {
  const ep = episode('salt-and-static', 7);
  const err = rejects(() => demoUnlock(ep.id, 20, adult), 'price_changed');
  assert.deepEqual(unlockFailure(err), { kind: 'price_changed', price: 25 });
  assert.equal(describeError(err).key, 'errors:price_changed_count');
  assert.equal(demoUnlock(ep.id, 25, adult).status, 'unlocked');
});

test('too few coins: insufficient_coins with the shortfall, and nothing is spent', () => {
  demoWalletCell.set((w) => ({ ...w, paid: 5, bonus: 0, expiring: [], balance: 5 }));
  const err = rejects(() => demoUnlock(episode('salt-and-static', 4).id, 20, adult), 'insufficient_coins');
  assert.deepEqual(unlockFailure(err), { kind: 'insufficient', shortBy: 15 });
  assert.equal(demoWalletCell.get().balance, 5);
});

test('a refund debt blocks coin unlocks', () => {
  demoWalletCell.set((w) => ({ ...w, refund_debt: 30 }));
  const err = rejects(() => demoUnlock(episode('salt-and-static', 4).id, 20, adult), 'refund_debt_outstanding');
  assert.deepEqual(unlockFailure(err), { kind: 'debt', debt: 30 });
});

test('free and opted-out episodes are never charged', () => {
  const before = demoWalletCell.get().balance;
  assert.equal(demoUnlock(episode('salt-and-static', 1).id, 0, adult).status, 'free');
  rejects(() => demoUnlock(episode('night-shift-at-the-wax-museum', 4).id, 25, adult), 'mature_opt_in_required');
  assert.equal(demoWalletCell.get().balance, before);
});

test('the daily Free Pass unlocks one episode, then runs out', () => {
  const first = episode('the-clockmakers-mice', 4);
  const out = demoUseFreePass(first.id, adult);
  assert.deepEqual(out, { status: 'unlocked', balance: null, freePassesLeft: 0 });
  assert.equal(demoEpisodePrice(first.id, adult).unlocked, true);
  assert.equal(demoUseFreePass(first.id, adult).status, 'already_unlocked');

  const err = rejects(() => demoUseFreePass(episode('the-clockmakers-mice', 5).id, adult), 'no_free_pass_left');
  assert.deepEqual(unlockFailure(err), { kind: 'no_free_pass' });
  assert.equal(demoUseFreePass(episode('the-clockmakers-mice', 1).id, adult).status, 'free', 'a free episode needs no pass');
});

test('watch progress is the catalog’s: its rows resume here, and saves show there', () => {
  const eps = episodesOf('salt-and-static');
  const seeded = demoProgressFor(eps.map((e) => e.id));
  assert.equal(seeded.get(eps[1]!.id)?.position_s, 38, 'the catalog’s “continue watching” row');

  demoSaveProgress(eps[2]!.id, { position_s: 44.7, completed: false });
  assert.deepEqual(demoProgressFor([eps[2]!.id]).get(eps[2]!.id), { position_s: 44, completed: false });
  assert.ok(demoProgress().some((r) => r.episode_id === eps[2]!.id && r.position_s === 44));

  // A finished episode stays finished when it is watched again from the start.
  demoSaveProgress(eps[2]!.id, { position_s: 90, completed: true });
  demoSaveProgress(eps[2]!.id, { position_s: 5, completed: false });
  assert.deepEqual(demoProgressFor([eps[2]!.id]).get(eps[2]!.id), { position_s: 5, completed: true });

  assert.equal(demoProgressFor(['nope']).size, 0);
});
