// RevenueCat webhook → ledger. Verification: the static Authorization header configured in the
// RevenueCat dashboard (constant-time compare) AND the HMAC signature with a timestamp (replay
// protection). Processing happens before we answer: we return 200 only after the database committed,
// so a failure makes RevenueCat retry, and the ledger's dedupe makes retries harmless.

import { readCappedText } from '../lib/http.ts';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env.ts';
import { serviceDb, DbError, type Db } from '../lib/db.ts';
import { timingSafeEqual, verifyTimestampedHmac } from '../lib/crypto.ts';
import { ecbRates, formatDecimal, netAmount, toEurMicros, utcDate, workerCache, type FxRates } from '../lib/fx.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string(),
  app_user_id: z.string().max(200),
  environment: z.enum(['PRODUCTION', 'SANDBOX']),
  store: z.string().optional(),
  product_id: z.string().max(100).optional(),
  transaction_id: z.string().max(200).optional().nullable(),
  original_transaction_id: z.string().max(200).optional().nullable(),
  period_type: z.string().optional(),
  purchased_at_ms: z.number().optional().nullable(),
  expiration_at_ms: z.number().optional().nullable(),
  event_timestamp_ms: z.number(),
  price: z.number().optional().nullable(),
  price_in_purchased_currency: z.number().optional().nullable(),
  currency: z.string().optional().nullable(),
  tax_percentage: z.number().optional().nullable(),
  commission_percentage: z.number().optional().nullable(),
  cancel_reason: z.string().optional().nullable(),
});
export type RcEvent = z.infer<typeof EventSchema>;

const STORES: Record<string, 'app_store' | 'play_store' | 'web'> = {
  APP_STORE: 'app_store',
  MAC_APP_STORE: 'app_store',
  PLAY_STORE: 'play_store',
  RC_BILLING: 'web',
  STRIPE: 'web',
  PADDLE: 'web',
};

// Monthly Plus grant (coins) and trial grant, matching the coins policy. Weekly/annual and Premium
// are added here when they go on sale (Phase 7).
const SUB_GRANTS: Record<string, { coins: number }> = { 'reeltale.plus.monthly': { coins: 1200 } };
const TRIAL_COINS = 100;

/**
 * Net proceeds of a EUR purchase in euro micros (RevenueCat's `price` is USD, so the price in the purchased
 * currency is used). Exact decimal maths, floored once (see lib/fx.ts). Null for other currencies and
 * when tax or commission is unknown.
 */
export function netEurMicros(ev: RcEvent): number | null {
  if (ev.currency?.toUpperCase() !== 'EUR') return null;
  const net = netAmount(ev.price_in_purchased_currency, ev.tax_percentage, ev.commission_percentage);
  return net ? toEurMicros(net) : null;
}

export interface Valuation {
  /** For credit_purchase / grant_sub_coins. Null leaves the lot valuation_pending. */
  netEurMicros: number | null;
  /** A production purchase in another currency: offered to the FX queue (the DB ignores it once valued). */
  foreign: { currency: string; netAmount: string; purchasedAt: string } | null;
}

const NO_VALUE: Valuation = { netEurMicros: null, foreign: null };

/**
 * An event's net proceeds in euro micros: EUR directly, other currencies with the ECB rate for the
 * purchase's UTC date once it is published (never an older one in its place). Sandbox purchases are worth
 * nothing, so no rate is fetched for them.
 */
export async function valueEvent(ev: RcEvent, fx: FxRates | null): Promise<Valuation> {
  const currency = ev.currency?.toUpperCase() ?? '';
  const net = netAmount(ev.price_in_purchased_currency, ev.tax_percentage, ev.commission_percentage);
  if (!net || !/^[A-Z]{3}$/.test(currency)) return NO_VALUE;
  if (currency === 'EUR') return { netEurMicros: toEurMicros(net), foreign: null };
  if (ev.environment === 'SANDBOX') return NO_VALUE;
  const at = new Date(ev.purchased_at_ms ?? ev.event_timestamp_ms);
  if (Number.isNaN(at.getTime())) return NO_VALUE;
  const foreign = { currency, netAmount: formatDecimal(net), purchasedAt: at.toISOString() };
  let micros: number | null = null;
  try {
    const r = fx ? await fx.rate(currency, utcDate(at.getTime())) : null;
    if (r?.ok) micros = toEurMicros(net, r.rate);
  } catch (err) {
    console.error('fx rate failed', err instanceof Error ? err.message : err);
  }
  return { netEurMicros: micros, foreign };
}

export type Outcome = { status: number; body: Record<string, unknown> };

/**
 * Apply one event. Pure apart from the db calls and the rate lookup, so it's unit-testable with fakes.
 * Non-EUR purchases are offered to the FX queue on every delivery (the DB decides whether the lot still
 * needs a value), so a retry after a failure between the two calls still records them.
 */
export async function applyRevenueCatEvent(db: Db, ev: RcEvent, fx: FxRates | null = null): Promise<Outcome> {
  if (ev.type === 'TEST') return { status: 200, body: { ok: true, ignored: 'test' } };
  if (!UUID.test(ev.app_user_id)) {
    // Anonymous RevenueCat ids ($RCAnonymousID:…) never get coins; the app logs in with the Supabase id
    // before any purchase.
    return { status: 200, body: { ok: true, ignored: 'non_uuid_user' } };
  }
  const store = ev.store ? STORES[ev.store] : undefined;
  if (!store) return { status: 200, body: { ok: true, ignored: 'unknown_store' } };
  const env = ev.environment === 'SANDBOX' ? 'sandbox' : 'production';
  const isRefund = ev.type === 'CANCELLATION' && ev.cancel_reason === 'CUSTOMER_SUPPORT' && (ev.price ?? 0) < 0;

  if (ev.type === 'NON_RENEWING_PURCHASE') {
    if (!ev.transaction_id || !ev.product_id) return { status: 400, body: { error: 'missing_fields' } };
    const value = await valueEvent(ev, fx);
    if (value.netEurMicros == null && !value.foreign && env === 'production') {
      // Unknown tax or commission: the lot stays valuation_pending until someone values it by hand.
      console.warn('revenuecat purchase without known net proceeds', ev.id);
    }
    const r = await db.rpc('credit_purchase', {
      p_user: ev.app_user_id, p_event_id: ev.id, p_store: store, p_store_transaction_id: ev.transaction_id,
      p_product_id: ev.product_id, p_environment: env, p_net_eur_micros: value.netEurMicros,
    });
    if (!value.foreign) return { status: 200, body: { ok: true, result: r } };
    const fxStatus = await db.rpc('record_purchase_fx', {
      p_store: store, p_store_transaction_id: ev.transaction_id, p_currency: value.foreign.currency,
      p_net_amount: value.foreign.netAmount, p_purchased_at: value.foreign.purchasedAt,
    });
    return { status: 200, body: { ok: true, result: r, fx: fxStatus } };
  }

  if (isRefund && ev.product_id && !SUB_GRANTS[ev.product_id]) {
    if (!ev.transaction_id) return { status: 400, body: { error: 'missing_fields' } };
    const r = await db.rpc('apply_refund', {
      p_event_id: ev.id, p_store: store, p_store_transaction_id: ev.transaction_id,
    });
    return { status: 200, body: { ok: true, result: r } };
  }

  const SUB_EVENTS = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'CANCELLATION',
    'EXPIRATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED']);
  if (SUB_EVENTS.has(ev.type) && ev.product_id && SUB_GRANTS[ev.product_id]) {
    const original = ev.original_transaction_id ?? ev.transaction_id;
    if (!original || !ev.purchased_at_ms || !ev.expiration_at_ms) return { status: 400, body: { error: 'missing_fields' } };
    const status = isRefund ? 'refunded'
      : ev.type === 'EXPIRATION' ? 'expired'
      : ev.type === 'BILLING_ISSUE' ? 'billing_issue'
      : ev.type === 'SUBSCRIPTION_PAUSED' ? 'paused'
      : 'active';
    const periodType = ev.period_type === 'TRIAL' ? 'trial' : ev.period_type === 'INTRO' ? 'intro' : 'normal';
    const start = new Date(ev.purchased_at_ms).toISOString();
    const end = new Date(ev.expiration_at_ms).toISOString();
    await db.rpc('upsert_subscription', {
      p_user: ev.app_user_id, p_original_txn: original, p_store: store, p_product_id: ev.product_id,
      p_period_type: periodType, p_status: status, p_period_start: start, p_period_end: end,
      p_auto_renew: ev.type !== 'CANCELLATION', p_environment: env,
      p_event_at: new Date(ev.event_timestamp_ms).toISOString(),
    });
    // A refunded period loses its coins (spent ones become refund debt) and its creator earnings.
    if (isRefund) {
      await db.rpc('refund_subscription_period', {
        p_event_id: ev.id, p_user: ev.app_user_id, p_original_txn: original, p_period_start: start,
      });
      return { status: 200, body: { ok: true } };
    }
    // New paid period: grant its coins (idempotent per subscription + period start).
    if ((ev.type === 'INITIAL_PURCHASE' || ev.type === 'RENEWAL') && ev.expiration_at_ms > Date.now()) {
      const trial = periodType === 'trial';
      const value = trial ? NO_VALUE : await valueEvent(ev, fx);
      await db.rpc('grant_sub_coins', {
        p_user: ev.app_user_id, p_original_txn: original, p_period_start: start, p_grant_no: 1,
        p_coins: trial ? TRIAL_COINS : SUB_GRANTS[ev.product_id]!.coins, p_expires_at: end,
        p_net_eur_micros_total: value.netEurMicros, p_environment: env, p_is_trial: trial,
      });
      if (value.foreign) {
        await db.rpc('record_sub_grant_fx', {
          p_original_txn: original, p_period_start: start, p_grant_no: 1, p_currency: value.foreign.currency,
          p_net_amount: value.foreign.netAmount,
        });
      }
    }
    return { status: 200, body: { ok: true } };
  }

  return { status: 200, body: { ok: true, ignored: ev.type } };
}

export async function revenueCatWebhook(c: Context<AppContext>) {
  const env = c.env;
  if (!env.REVENUECAT_WEBHOOK_AUTH || !env.REVENUECAT_WEBHOOK_HMAC_SECRET) {
    return c.json({ error: 'not_configured' }, 503);
  }
  const auth = c.req.header('Authorization') ?? '';
  if (!timingSafeEqual(auth, env.REVENUECAT_WEBHOOK_AUTH)) return c.json({ error: 'unauthorized' }, 401);

  const raw = await readCappedText(c.req.raw, 64 * 1024);
  if (raw === null) return c.json({ error: 'too_large' }, 413);
  const sig = await verifyTimestampedHmac({
    header: c.req.header('X-RevenueCat-Webhook-Signature'), rawBody: raw,
    secret: env.REVENUECAT_WEBHOOK_HMAC_SECRET, tsKey: 't', sigKey: 'v1', nowSec: Math.floor(Date.now() / 1000),
  });
  if (!sig.ok) return c.json({ error: 'bad_signature', reason: sig.reason }, 401);

  let ev: RcEvent;
  try {
    const parsed = JSON.parse(raw) as { event?: unknown };
    ev = EventSchema.parse(parsed.event);
  } catch {
    return c.json({ error: 'bad_payload' }, 400);
  }

  try {
    const fx = ecbRates({ cache: workerCache(), cacheKeyBase: env.APP_ORIGIN, timeoutMs: 5000 });
    const out = await applyRevenueCatEvent(serviceDb(env), ev, fx);
    return c.json(out.body, out.status as 200);
  } catch (err) {
    // 5xx → RevenueCat retries (5 times over ~80 min). Known permanent errors get 200 + a log line so
    // a bad product id doesn't retry forever.
    if (err instanceof DbError && err.message === 'unknown_product') {
      console.error('revenuecat unknown product', ev.product_id);
      return c.json({ ok: false, error: 'unknown_product' }, 200);
    }
    console.error('revenuecat webhook failed', err instanceof Error ? err.message : err);
    return c.json({ error: 'processing_failed' }, 500);
  }
}
