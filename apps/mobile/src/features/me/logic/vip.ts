// What VIP gives, from the blueprint's economy (section 9). Plus monthly is the one plan on sale in this
// build. The monthly grant mirrors SUB_GRANTS in apps/server/src/webhooks/revenuecat.ts; the discount and
// the extra Free Pass are public.pricing_config values, read when they can be and defaulted otherwise.
//
// Nothing here is a price: the native apps show no real-money amount and nothing to buy yet.

export interface VipPerks {
  /** Bonus coins granted per period. */
  coins: number;
  period: 'month';
  discountPct: number;
  extraFreePasses: number;
}

/** The blueprint's defaults (pricing_config: plus_discount_pct = 10, free_passes_plus_bonus = 1). */
export const VIP_DEFAULTS: VipPerks = { coins: 1200, period: 'month', discountPct: 10, extraFreePasses: 1 };

export const VIP_CONFIG_KEYS = ['plus_discount_pct', 'free_passes_plus_bonus'] as const;

function whole(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Rows of `pricing_config` (key, value) -> the perks. Never fails: what can't be read keeps its default. */
export function parseVipConfig(raw: unknown): VipPerks {
  const perks: VipPerks = { ...VIP_DEFAULTS };
  if (!Array.isArray(raw)) return perks;
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const { key, value } = item as { key?: unknown; value?: unknown };
    if (key === 'plus_discount_pct') perks.discountPct = whole(value, 0, 30) ?? perks.discountPct;
    if (key === 'free_passes_plus_bonus') perks.extraFreePasses = whole(value, 0, 5) ?? perks.extraFreePasses;
  }
  return perks;
}
