import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRevenueCatEvent, netEurMicros, type RcEvent } from '../src/webhooks/revenuecat.ts';
import type { Db } from '../src/lib/db.ts';

const user = '7f9c2c1e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

function fakeDb() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return { status: 'ok' } as T;
    },
  };
  return { db, calls };
}

function ev(over: Partial<RcEvent>): RcEvent {
  return {
    id: 'evt_1', type: 'NON_RENEWING_PURCHASE', app_user_id: user, environment: 'PRODUCTION', store: 'APP_STORE',
    product_id: 'reeltale.coins.525', transaction_id: '2000000123', event_timestamp_ms: Date.now(),
    ...over,
  } as RcEvent;
}

test('netEurMicros only values EUR purchases with known tax and commission', () => {
  assert.equal(netEurMicros(ev({ currency: 'EUR', price_in_purchased_currency: 4.99, tax_percentage: 0.1736, commission_percentage: 0.15 })),
    Math.floor(4.99 * (1 - 0.1736 - 0.15) * 1_000_000));
  assert.equal(netEurMicros(ev({ currency: 'USD', price_in_purchased_currency: 4.99, tax_percentage: 0, commission_percentage: 0.15 })), null);
  assert.equal(netEurMicros(ev({ currency: 'EUR', price_in_purchased_currency: 4.99, commission_percentage: 0.15 })), null);
  assert.equal(netEurMicros(ev({ currency: 'EUR', price_in_purchased_currency: -4.99, tax_percentage: 0, commission_percentage: 0.15 })), null);
});

test('a coin pack purchase credits with the store transaction id and environment', async () => {
  const { db, calls } = fakeDb();
  await applyRevenueCatEvent(db, ev({}));
  await applyRevenueCatEvent(db, ev({ id: 'evt_2', environment: 'SANDBOX', store: 'PLAY_STORE' }));
  assert.equal(calls[0]?.fn, 'credit_purchase');
  assert.equal(calls[0]?.args.p_store, 'app_store');
  assert.equal(calls[0]?.args.p_store_transaction_id, '2000000123');
  assert.equal(calls[0]?.args.p_environment, 'production');
  assert.equal(calls[1]?.args.p_environment, 'sandbox');
  assert.equal(calls[1]?.args.p_store, 'play_store');
});

test('only a CUSTOMER_SUPPORT cancellation with a negative price is a refund', async () => {
  const { db, calls } = fakeDb();
  await applyRevenueCatEvent(db, ev({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', price: -4.99 }));
  assert.equal(calls[0]?.fn, 'apply_refund');
  calls.length = 0;
  await applyRevenueCatEvent(db, ev({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', price: 0 }));
  assert.equal(calls.length, 0, 'a plain cancellation of a coin pack does nothing');
});

test('a new subscription period upserts and grants its coins once; a cancellation only stops renewal', async () => {
  const { db, calls } = fakeDb();
  const start = Date.now() - 60_000;
  const end = start + 30 * 86400_000;
  const base = { product_id: 'reeltale.plus.monthly', original_transaction_id: 'orig1', purchased_at_ms: start, expiration_at_ms: end };
  await applyRevenueCatEvent(db, ev({ ...base, type: 'INITIAL_PURCHASE', period_type: 'NORMAL' }));
  assert.deepEqual(calls.map((c) => c.fn), ['upsert_subscription', 'grant_sub_coins']);
  assert.equal(calls[1]?.args.p_coins, 1200);
  assert.equal(calls[1]?.args.p_is_trial, false);
  assert.equal(calls[1]?.args.p_expires_at, new Date(end).toISOString());

  calls.length = 0;
  await applyRevenueCatEvent(db, ev({ ...base, type: 'INITIAL_PURCHASE', period_type: 'TRIAL', id: 'evt_t' }));
  assert.equal(calls[1]?.args.p_coins, 100);
  assert.equal(calls[1]?.args.p_is_trial, true);
  assert.equal(calls[1]?.args.p_net_eur_micros_total, null);

  calls.length = 0;
  await applyRevenueCatEvent(db, ev({ ...base, type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', id: 'evt_c' }));
  assert.deepEqual(calls.map((c) => c.fn), ['upsert_subscription']);
  assert.equal(calls[0]?.args.p_auto_renew, false);
  assert.equal(calls[0]?.args.p_status, 'active');
});

test('anonymous users, unknown stores and test events are ignored', async () => {
  const { db, calls } = fakeDb();
  const a = await applyRevenueCatEvent(db, ev({ app_user_id: '$RCAnonymousID:abc' }));
  const b = await applyRevenueCatEvent(db, ev({ store: 'AMAZON' }));
  const c = await applyRevenueCatEvent(db, ev({ type: 'TEST' }));
  assert.equal(calls.length, 0);
  assert.deepEqual([a.body.ignored, b.body.ignored, c.body.ignored], ['non_uuid_user', 'unknown_store', 'test']);
});

test('expired periods are recorded but not granted', async () => {
  const { db, calls } = fakeDb();
  const start = Date.now() - 40 * 86400_000;
  await applyRevenueCatEvent(db, ev({ type: 'RENEWAL', product_id: 'reeltale.plus.monthly', original_transaction_id: 'o2',
    purchased_at_ms: start, expiration_at_ms: start + 30 * 86400_000 }));
  assert.deepEqual(calls.map((c) => c.fn), ['upsert_subscription']);
});

test('a refunded subscription period is clawed back after the status update', async () => {
  const { db, calls } = fakeDb();
  const start = Date.now() - 86400_000;
  await applyRevenueCatEvent(db, ev({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', price: -9.99,
    product_id: 'reeltale.plus.monthly', original_transaction_id: 'o3', purchased_at_ms: start,
    expiration_at_ms: start + 30 * 86400_000, id: 'evt_r' }));
  assert.deepEqual(calls.map((c) => c.fn), ['upsert_subscription', 'refund_subscription_period']);
  assert.equal(calls[0]?.args.p_status, 'refunded');
  assert.equal(calls[1]?.args.p_period_start, new Date(start).toISOString());
});
