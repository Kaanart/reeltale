// RevenueCat webhook → ledger. Verification: the static Authorization header configured in the
// RevenueCat dashboard (constant-time compare) AND the HMAC signature with a timestamp (replay
// protection). Processing happens before we answer: we return 200 only after the database committed,
// so a failure makes RevenueCat retry, and the ledger's dedupe makes retries harmless.

import type { Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env.ts';
import { serviceDb, DbError, type Db } from '../lib/db.ts';
import { timingSafeEqual, verifyTimestampedHmac } from '../lib/crypto.ts';

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
 * Net proceeds in euro micros, only when the purchase was made in EUR (RevenueCat's `price` is USD).
 * Other currencies return null: the lot is marked valuation_pending and valued later from an ECB rate.
 */
export function netEurMicros(ev: RcEvent): number | null {
  if (ev.currency !== 'EUR' || ev.price_in_purchased_currency == null) return null;
  const gross = ev.price_in_purchased_currency;
  const tax = ev.tax_percentage ?? null;
  const commission = ev.commission_percentage ?? null;
  if (gross <= 0 || tax == null || commission == null) return null;
  // RevenueCat's tax and commission are fractions of the gross price.
  const net = gross * (1 - tax - commission);
  return net > 0 ? Math.floor(net * 1_000_000) : null;
}

export type Outcome = { status: number; body: Record<string, unknown> };

/** Apply one event. Pure apart from the db calls, so it's unit-testable with a fake Db. */
export async function applyRevenueCatEvent(db: Db, ev: RcEvent): Promise<Outcome> {
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
    const r = await db.rpc('credit_purchase', {
      p_user: ev.app_user_id, p_event_id: ev.id, p_store: store, p_store_transaction_id: ev.transaction_id,
      p_product_id: ev.product_id, p_environment: env, p_net_eur_micros: netEurMicros(ev),
    });
    return { status: 200, body: { ok: true, result: r } };
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
      await db.rpc('grant_sub_coins', {
        p_user: ev.app_user_id, p_original_txn: original, p_period_start: start, p_grant_no: 1,
        p_coins: trial ? TRIAL_COINS : SUB_GRANTS[ev.product_id]!.coins, p_expires_at: end,
        p_net_eur_micros_total: trial ? null : netEurMicros(ev), p_environment: env, p_is_trial: trial,
      });
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

  const raw = await c.req.text();
  if (raw.length > 64 * 1024) return c.json({ error: 'too_large' }, 413);
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
    const out = await applyRevenueCatEvent(serviceDb(env), ev);
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
