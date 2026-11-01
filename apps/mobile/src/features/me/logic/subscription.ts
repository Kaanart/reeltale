// The user's own subscriptions (public.subscriptions, owner-only RLS) as the VIP page, the Me tab and the
// account-deletion notice read them. The store keeps billing until the user cancels there; deleting the
// account doesn't stop it (App Store 5.1.1(v)).

export type SubscriptionStore = 'app_store' | 'play_store' | 'web';
export type SubscriptionTier = 'plus' | 'premium';
export type SubscriptionStatus = 'active' | 'expired' | 'billing_issue' | 'paused' | 'refunded';

export interface SubscriptionRow {
  store: SubscriptionStore;
  product_id: string;
  tier: SubscriptionTier;
  period_type: 'normal' | 'trial' | 'intro';
  status: SubscriptionStatus;
  period_start: string | null;
  period_end: string | null;
  auto_renew: boolean;
  environment: 'production' | 'sandbox';
}

/** Granted columns of public.subscriptions (the transaction id and user id are left out). */
export const SUBSCRIPTION_COLUMNS =
  'store, product_id, tier, period_type, status, period_start, period_end, auto_renew, environment';

const STORES: readonly string[] = ['app_store', 'play_store', 'web'];
const TIERS: readonly string[] = ['plus', 'premium'];
const STATUSES: readonly string[] = ['active', 'expired', 'billing_issue', 'paused', 'refunded'];
const PERIODS: readonly string[] = ['normal', 'trial', 'intro'];

/** `unknown` in, rows out; null when it isn't a list. Rows of the wrong shape are dropped. */
export function parseSubscriptions(raw: unknown): SubscriptionRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: SubscriptionRow[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!STORES.includes(r.store as string) || !TIERS.includes(r.tier as string) || !STATUSES.includes(r.status as string)) continue;
    rows.push({
      store: r.store as SubscriptionStore,
      product_id: typeof r.product_id === 'string' ? r.product_id : '',
      tier: r.tier as SubscriptionTier,
      period_type: PERIODS.includes(r.period_type as string) ? (r.period_type as SubscriptionRow['period_type']) : 'normal',
      status: r.status as SubscriptionStatus,
      period_start: typeof r.period_start === 'string' ? r.period_start : null,
      period_end: typeof r.period_end === 'string' ? r.period_end : null,
      auto_renew: r.auto_renew !== false,
      environment: r.environment === 'sandbox' ? 'sandbox' : 'production',
    });
  }
  return rows;
}

function endsAfter(row: SubscriptionRow, now: Date): boolean {
  if (!row.period_end) return false;
  const end = new Date(row.period_end).getTime();
  return !Number.isNaN(end) && end > now.getTime();
}

/**
 * The VIP the account has now: the same rule as app_private.active_tier (status 'active' and a period that
 * hasn't ended), the higher tier first, then the one that runs longest.
 */
export function activeSubscription(rows: readonly SubscriptionRow[] | undefined, now: Date = new Date()): SubscriptionRow | null {
  const live = (rows ?? []).filter((r) => r.status === 'active' && endsAfter(r, now));
  live.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'premium' ? -1 : 1;
    return new Date(b.period_end ?? 0).getTime() - new Date(a.period_end ?? 0).getTime();
  });
  return live[0] ?? null;
}

/**
 * A subscription that will keep billing after the account is deleted: active (or in a billing retry) and set
 * to renew. A cancelled one that only runs out its period doesn't need the warning.
 */
export function renewingSubscription(rows: readonly SubscriptionRow[] | undefined, now: Date = new Date()): SubscriptionRow | null {
  const billing = (rows ?? []).filter((r) => r.auto_renew && ((r.status === 'active' && endsAfter(r, now)) || r.status === 'billing_issue'));
  return billing.find((r) => r.tier === 'premium') ?? billing[0] ?? null;
}

export interface DeletionNotice {
  titleKey: string;
  bodyKey: string;
  /** The i18n key of the store's name, for the body's {{store}}; null when the body names none. */
  storeKey: string | null;
  /** The store whose subscription page the notice can open, or null. */
  manageStore: SubscriptionStore | null;
}

/**
 * What the delete page says about subscriptions. It always says something: the store keeps billing whatever
 * happens to the account, and public.subscriptions can't prove there is none (the list may still be loading
 * or have failed, and a store event can arrive late). A known renewing subscription is named; otherwise the
 * notice speaks in general terms.
 */
export function deletionNotice(rows: readonly SubscriptionRow[] | undefined, now: Date = new Date()): DeletionNotice {
  const renewing = renewingSubscription(rows, now);
  if (!renewing) {
    return { titleKey: 'settings:delete.subscription.titleGeneric', bodyKey: 'settings:delete.subscription.bodyGeneric', storeKey: null, manageStore: null };
  }
  const storeKey = storeNameKey(renewing.store);
  return {
    titleKey: 'settings:delete.subscription.title',
    bodyKey: storeKey ? 'settings:delete.subscription.body' : 'settings:delete.subscription.bodyUnnamed',
    storeKey,
    manageStore: manageSubscriptionUrl(renewing.store) ? renewing.store : null,
  };
}

/** Where the store lets people cancel. A subscription bought on the web has no store page to open. */
export function manageSubscriptionUrl(store: SubscriptionStore): string | null {
  if (store === 'app_store') return 'https://apps.apple.com/account/subscriptions';
  if (store === 'play_store') return 'https://play.google.com/store/account/subscriptions';
  return null;
}

/** The i18n key of the store's name, or null for one we don't name. */
export function storeNameKey(store: SubscriptionStore): string | null {
  if (store === 'app_store') return 'settings:delete.stores.app_store';
  if (store === 'play_store') return 'settings:delete.stores.play_store';
  return null;
}

export function planNameKey(tier: SubscriptionTier): string {
  return `vip:plan.${tier}`;
}
