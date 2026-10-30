import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Wallet } from '@reeltale/shared';
import { bonusGroup, EXPIRING_SOON_DAYS, parseWallet, summarizeWallet } from '../wallet.ts';

const NOW = new Date('2026-10-28T12:00:00Z');
const DAY = 86_400_000;
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  balance: 1300, paid: 100, bonus: 1200, refund_debt: 0, free_passes_left: 1,
  expiring: [{ coins: 1200, expires_at: inDays(20), source: 'sub_grant' }], ...over,
});

test('parseWallet accepts the exact get_my_wallet shape and nothing else', () => {
  assert.deepEqual(parseWallet(wallet()), wallet());
  assert.equal(parseWallet(null), null);
  assert.equal(parseWallet({}), null);
  assert.equal(parseWallet({ ...wallet(), balance: '5' }), null);
  assert.equal(parseWallet({ ...wallet(), balance: 1.5 }), null);
  assert.equal(parseWallet({ ...wallet(), expiring: [{ coins: 1, source: 'x' }] }), null);
  const { free_passes_left, ...missing } = wallet();
  assert.equal(free_passes_left, 1);
  assert.equal(parseWallet(missing), null);
});

test('summarizeWallet carries the totals through', () => {
  const s = summarizeWallet(wallet({ free_passes_left: 2 }), NOW);
  assert.equal(s.balance, 1300);
  assert.equal(s.paid, 100);
  assert.equal(s.bonus, 1200);
  assert.equal(s.freePassesLeft, 2);
  assert.equal(s.refundDebt, 0);
  assert.equal(s.blockedByDebt, false);
});

test('refund debt blocks spending and is reported', () => {
  const s = summarizeWallet(wallet({ refund_debt: 30 }), NOW);
  assert.equal(s.refundDebt, 30);
  assert.equal(s.blockedByDebt, true);
});

test('expiring lots are sorted soonest first, with days left rounded up', () => {
  const s = summarizeWallet(wallet({
    expiring: [
      { coins: 50, expires_at: inDays(20), source: 'sub_grant' },
      { coins: 10, expires_at: inDays(2.2), source: 'promo' },
      { coins: 30, expires_at: inDays(0.4), source: 'trial' },
    ],
  }), NOW);
  assert.deepEqual(s.expiring.map((l) => [l.coins, l.daysLeft, l.group]), [[30, 1, 'trial'], [10, 3, 'bonus'], [50, 20, 'vip']]);
  assert.equal(s.nextExpiry?.coins, 30);
  assert.equal(s.expiring[0]?.expiresAt.toISOString(), inDays(0.4));
  assert.equal(s.expiring[0]?.msLeft, 0.4 * DAY);
});

test('expiring soon means within the window, edge included', () => {
  const s = summarizeWallet(wallet({
    expiring: [
      { coins: 5, expires_at: inDays(EXPIRING_SOON_DAYS), source: 'promo' },
      { coins: 7, expires_at: new Date(NOW.getTime() + EXPIRING_SOON_DAYS * DAY + 1000).toISOString(), source: 'promo' },
      { coins: 11, expires_at: inDays(1), source: 'promo' },
    ],
  }), NOW);
  assert.deepEqual(s.expiringSoon.map((l) => l.coins), [11, 5]);
  assert.equal(s.expiringSoonCoins, 16);
  assert.deepEqual(s.expiring.map((l) => l.soon), [true, true, false]);
  const wide = summarizeWallet(wallet({ expiring: [{ coins: 7, expires_at: inDays(10), source: 'promo' }] }), NOW, { soonDays: 14 });
  assert.equal(wide.expiringSoonCoins, 7);
});

test('lots already past their date (stale response) and unreadable dates are dropped, not shown as "0 days"', () => {
  const s = summarizeWallet(wallet({
    expiring: [
      { coins: 9, expires_at: inDays(-0.01), source: 'promo' },
      { coins: 8, expires_at: NOW.toISOString(), source: 'promo' },
      { coins: 7, expires_at: 'not a date', source: 'promo' },
      { coins: 0, expires_at: inDays(3), source: 'promo' },
      { coins: 6, expires_at: inDays(3), source: 'promo' },
    ],
  }), NOW);
  assert.deepEqual(s.expiring.map((l) => l.coins), [6]);
  assert.equal(s.expiringSoonCoins, 6);
});

test('coins of a lot that expired since the fetch also come off bonus and balance, as the server would count them', () => {
  // As fetched: 100 bought + two bonus lots (50 now past their date, 30 still good) = 180.
  const s = summarizeWallet(wallet({
    balance: 180, paid: 100, bonus: 80,
    expiring: [
      { coins: 50, expires_at: inDays(-0.01), source: 'promo' },
      { coins: 30, expires_at: inDays(4), source: 'sub_grant' },
    ],
  }), NOW);
  assert.equal(s.balance, 130);
  assert.equal(s.bonus, 30);
  assert.equal(s.paid, 100);
  assert.deepEqual(s.expiring.map((l) => l.coins), [30]);
  // Lots still valid, or whose date can't be read, change nothing; the totals never go below zero.
  assert.equal(summarizeWallet(wallet(), NOW).balance, 1300);
  assert.equal(summarizeWallet(wallet({ expiring: [{ coins: 7, expires_at: 'not a date', source: 'promo' }] }), NOW).balance, 1300);
  const odd = summarizeWallet(wallet({ balance: 10, bonus: 10, expiring: [{ coins: 25, expires_at: inDays(-1), source: 'promo' }] }), NOW);
  assert.equal(odd.balance, 0);
  assert.equal(odd.bonus, 0);
});

test('an empty expiring list gives no next expiry', () => {
  const s = summarizeWallet(wallet({ expiring: [] }), NOW);
  assert.equal(s.nextExpiry, null);
  assert.deepEqual(s.expiring, []);
  assert.deepEqual(s.expiringSoon, []);
  assert.equal(s.expiringSoonCoins, 0);
});

test('lots that expire at the same moment keep the bigger one first, deterministically', () => {
  const s = summarizeWallet(wallet({
    expiring: [
      { coins: 5, expires_at: inDays(3), source: 'promo' },
      { coins: 50, expires_at: inDays(3), source: 'sub_grant' },
    ],
  }), NOW);
  assert.deepEqual(s.expiring.map((l) => l.coins), [50, 5]);
});

test('bonusGroup never exposes ledger terms such as "code" to the screens', () => {
  assert.equal(bonusGroup('sub_grant'), 'vip');
  assert.equal(bonusGroup('trial'), 'trial');
  assert.equal(bonusGroup('refund_return'), 'returned');
  assert.equal(bonusGroup('sandbox'), 'test');
  for (const source of ['promo', 'code', 'admin', 'something_new', '']) assert.equal(bonusGroup(source), 'bonus');
});

test('summarizeWallet does not change the wallet it was given', () => {
  const w = wallet({ expiring: [{ coins: 2, expires_at: inDays(5), source: 'a' }, { coins: 1, expires_at: inDays(1), source: 'b' }] });
  const before = JSON.stringify(w);
  summarizeWallet(w, NOW);
  assert.equal(JSON.stringify(w), before);
});
