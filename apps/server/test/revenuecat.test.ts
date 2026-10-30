import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRevenueCatEvent, netEurMicros, type RcEvent } from '../src/webhooks/revenuecat.ts';
import type { Db } from '../src/lib/db.ts';
import { parseDecimal, type FxRates } from '../src/lib/fx.ts';

const user = '7f9c2c1e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

/** Records calls; `answers` overrides the result per function (an Error is thrown). */
function fakeDb(answers: Record<string, unknown> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const a = answers[fn];
      if (a instanceof Error) throw a;
      return (a ?? { status: 'ok' }) as T;
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

// ---- Non-EUR purchases (ECB rates, lib/fx.ts) ------------------------------------------------------------

type Lookup = Awaited<ReturnType<FxRates['rate']>>;

function fakeFx(answers: Record<string, Lookup | Error>) {
  const calls: string[] = [];
  const fx: FxRates = {
    async rate(currency, date) {
      calls.push(`${currency}@${date}`);
      const a = answers[`${currency}@${date}`];
      if (a instanceof Error) throw a;
      return a ?? { ok: false, reason: 'no_rate' };
    },
  };
  return { fx, calls };
}

const rate = (s: string): Lookup => ({ ok: true, rate: parseDecimal(s)!, rateDate: '2026-10-27' });
const AT = Date.parse('2026-10-27T20:00:00Z');
const usd: Partial<RcEvent> = {
  currency: 'USD', price_in_purchased_currency: 4.99, tax_percentage: 0, commission_percentage: 0.15, purchased_at_ms: AT,
};

test('EUR purchases are valued exactly and never look up a rate or touch the FX queue', async () => {
  const { db, calls } = fakeDb();
  const f = fakeFx({});
  await applyRevenueCatEvent(db, ev({ currency: 'EUR', price_in_purchased_currency: 5.99, tax_percentage: 0, commission_percentage: 0.3 }), f.fx);
  assert.deepEqual(calls.map((c) => c.fn), ['credit_purchase']);
  assert.equal(calls[0]?.args.p_net_eur_micros, 4_193_000, 'the old float formula gave 4192999');
  assert.deepEqual(f.calls, []);
});

test('a USD purchase with a published rate is valued at once; the FX queue is offered it and declines', async () => {
  const { db, calls } = fakeDb({ record_purchase_fx: 'not_needed' });
  const f = fakeFx({ 'USD@2026-10-27': rate('1.0812') });
  const out = await applyRevenueCatEvent(db, ev(usd), f.fx);
  assert.deepEqual(f.calls, ['USD@2026-10-27']);
  assert.deepEqual(calls.map((c) => c.fn), ['credit_purchase', 'record_purchase_fx']);
  // 4.99 × 0.85 = 4.2415 USD; at 1.0812 USD per EUR: floor(4.2415 / 1.0812 × 10^6).
  assert.equal(calls[0]?.args.p_net_eur_micros, 3_922_955);
  assert.deepEqual(calls[1]?.args, {
    p_store: 'app_store', p_store_transaction_id: '2000000123', p_currency: 'USD', p_net_amount: '4.2415',
    p_purchased_at: '2026-10-27T20:00:00.000Z',
  });
  assert.equal(out.body.fx, 'not_needed');
});

test('JPY (no minor unit) converts from whole yen', async () => {
  const { db, calls } = fakeDb();
  const f = fakeFx({ 'JPY@2026-10-27': rate('162.45') });
  await applyRevenueCatEvent(db, ev({ ...usd, currency: 'JPY', price_in_purchased_currency: 800, tax_percentage: 0.0909 }), f.fx);
  assert.equal(calls[0]?.args.p_net_eur_micros, 3_738_257);
  assert.equal(calls[1]?.args.p_net_amount, '607.28');
});

test('without a rate (not published yet, a currency the ECB lacks, a failed lookup) the lot stays pending and is queued', async () => {
  const cases: [Partial<RcEvent>, Record<string, Lookup | Error>][] = [
    [usd, { 'USD@2026-10-27': { ok: false, reason: 'not_published_yet' } }],
    [{ ...usd, currency: 'ARS', price_in_purchased_currency: 1500 }, { 'ARS@2026-10-27': { ok: false, reason: 'unknown_currency' } }],
    [usd, { 'USD@2026-10-27': { ok: false, reason: 'fetch_failed' } }],
    [usd, { 'USD@2026-10-27': new Error('boom') }],
  ];
  for (const [over, answers] of cases) {
    const { db, calls } = fakeDb({ record_purchase_fx: 'recorded' });
    const out = await applyRevenueCatEvent(db, ev(over), fakeFx(answers).fx);
    assert.deepEqual(calls.map((c) => c.fn), ['credit_purchase', 'record_purchase_fx']);
    assert.equal(calls[0]?.args.p_net_eur_micros, null);
    assert.equal(calls[1]?.args.p_currency, over.currency);
    assert.equal(out.body.fx, 'recorded');
  }
  // No rate source at all (a direct call without one): queued the same way.
  const { db, calls } = fakeDb();
  await applyRevenueCatEvent(db, ev(usd));
  assert.deepEqual([calls[0]?.args.p_net_eur_micros, calls[1]?.fn], [null, 'record_purchase_fx']);
});

test('the rate date is the UTC date of the purchase, falling back to the event time', async () => {
  const f = fakeFx({});
  await applyRevenueCatEvent(fakeDb().db, ev({ ...usd, purchased_at_ms: Date.parse('2026-10-26T23:30:00-05:00') }), f.fx);
  await applyRevenueCatEvent(fakeDb().db, ev({ ...usd, purchased_at_ms: null, event_timestamp_ms: Date.parse('2026-10-25T10:00:00Z') }), f.fx);
  assert.deepEqual(f.calls, ['USD@2026-10-27', 'USD@2026-10-25']);
});

test('sandbox purchases fetch no rate and queue nothing; unknown tax or a malformed currency values nothing', async () => {
  const cases: Partial<RcEvent>[] = [
    { ...usd, environment: 'SANDBOX' },
    { ...usd, tax_percentage: null },
    { ...usd, commission_percentage: undefined },
    { ...usd, currency: 'US$' },
    { ...usd, currency: null },
  ];
  for (const over of cases) {
    const { db, calls } = fakeDb();
    const f = fakeFx({ 'USD@2026-10-27': rate('1.0812') });
    await applyRevenueCatEvent(db, ev(over), f.fx);
    assert.deepEqual(calls.map((c) => c.fn), ['credit_purchase'], JSON.stringify(over));
    assert.equal(calls[0]?.args.p_net_eur_micros, null);
    assert.deepEqual(f.calls, []);
  }
});

test('currency codes are matched case-insensitively', async () => {
  const { db, calls } = fakeDb();
  await applyRevenueCatEvent(db, ev({ ...usd, currency: 'usd' }), fakeFx({ 'USD@2026-10-27': rate('1.0812') }).fx);
  assert.equal(calls[0]?.args.p_net_eur_micros, 3_922_955);
  assert.equal(calls[1]?.args.p_currency, 'USD');
});

test('a retry after queueing failed queues it again, even though the credit is now a duplicate', async () => {
  const failing = fakeDb({ record_purchase_fx: new Error('db down') });
  await assert.rejects(applyRevenueCatEvent(failing.db, ev(usd), fakeFx({}).fx), /db down/);
  const retry = fakeDb({ credit_purchase: { status: 'duplicate_event' }, record_purchase_fx: 'recorded' });
  await applyRevenueCatEvent(retry.db, ev(usd), fakeFx({}).fx);
  assert.deepEqual(retry.calls.map((c) => c.fn), ['credit_purchase', 'record_purchase_fx']);
});

test('non-EUR subscription periods are valued from the period start and offered to the FX queue; trials never', async () => {
  const start = Date.parse('2026-10-27T09:00:00Z');
  const end = Date.now() + 30 * 86400_000;
  const base: Partial<RcEvent> = {
    ...usd, type: 'RENEWAL', period_type: 'NORMAL', product_id: 'reeltale.plus.monthly', original_transaction_id: 'o-fx',
    purchased_at_ms: start, expiration_at_ms: end, price_in_purchased_currency: 9.99,
  };
  const { db, calls } = fakeDb({ record_sub_grant_fx: 'recorded' });
  await applyRevenueCatEvent(db, ev(base), fakeFx({ 'USD@2026-10-27': { ok: false, reason: 'not_published_yet' } }).fx);
  assert.deepEqual(calls.map((c) => c.fn), ['upsert_subscription', 'grant_sub_coins', 'record_sub_grant_fx']);
  assert.equal(calls[1]?.args.p_net_eur_micros_total, null);
  assert.deepEqual(calls[2]?.args, {
    p_original_txn: 'o-fx', p_period_start: new Date(start).toISOString(), p_grant_no: 1, p_currency: 'USD',
    p_net_amount: '8.4915',
  });

  const valued = fakeDb();
  await applyRevenueCatEvent(valued.db, ev(base), fakeFx({ 'USD@2026-10-27': rate('1.0812') }).fx);
  assert.equal(valued.calls[1]?.args.p_net_eur_micros_total, 7_853_773);

  const trial = fakeDb();
  const tf = fakeFx({});
  await applyRevenueCatEvent(trial.db, ev({ ...base, period_type: 'TRIAL', id: 'evt_trial_fx' }), tf.fx);
  assert.deepEqual(trial.calls.map((c) => c.fn), ['upsert_subscription', 'grant_sub_coins']);
  assert.deepEqual(tf.calls, []);
});
