// Coin prices: how they are shown, what they are worth in the store's currency, and the VIP discount.
//
// The discount maths mirrors app_private.resolve_episode_price (supabase/migrations/20261027090300_ledger.sql).
// The server stays the authority: unlock_episode raises price_changed if the price the sheet showed is not
// the price it computes. Use this file for teasers ("with Plus: 23 coins") and offline previews, and take
// the real price from get_episode_price.

import type { EpisodePrice } from '@reeltale/shared';

export type Locales = string | readonly string[] | undefined;

/** `1,150`: grouping follows the locale. Not a plural: the screen picks "coin" or "coins" from i18n. */
export function formatCoins(coins: number, locale?: Locales): string {
  return new Intl.NumberFormat(locale as string | string[] | undefined, { maximumFractionDigits: 0 }).format(coins);
}

// ---- Store-currency equivalent -------------------------------------------------------------------

/** A coin pack as the store offers it (RevenueCat product joined with public.products). */
export interface CoinProduct {
  coins: number;
  /** The store price in millionths of the currency unit (Google Play's priceAmountMicros; price * 1e6 on iOS). */
  priceMicros: number;
  /** ISO 4217 code, for example "EUR". */
  currency: string;
}

export function isUsableProduct(p: CoinProduct | null | undefined): p is CoinProduct {
  return !!p && Number.isInteger(p.coins) && p.coins > 0 && Number.isFinite(p.priceMicros) && p.priceMicros > 0
    && /^[A-Za-z]{3}$/.test(p.currency);
}

/**
 * The pack used to turn coins into money: the smallest one. That is the per-coin price a first-time buyer
 * pays, so "about 23 cents" is never lower than what coins actually cost. Ties go to the cheaper pack.
 */
export function referenceProduct(products: readonly CoinProduct[]): CoinProduct | null {
  let best: CoinProduct | null = null;
  for (const p of products) {
    if (!isUsableProduct(p)) continue;
    if (!best || p.coins < best.coins || (p.coins === best.coins && p.priceMicros < best.priceMicros)) best = p;
  }
  return best;
}

/** Format an amount in micros with the currency's own symbol and number of decimals. Null if the currency is unknown to Intl. */
export function formatMicros(micros: number, currency: string, locale?: Locales): string | null {
  try {
    return new Intl.NumberFormat(locale as string | string[] | undefined, { style: 'currency', currency })
      .format(micros / 1_000_000);
  } catch {
    return null;
  }
}

/**
 * What `coins` cost in the product's currency, formatted ("€0.25"), or null when that can't be said
 * honestly: no usable product, an unknown currency, or an amount that would round to zero.
 * The price per coin is the product's price divided by its coins; the result is rounded once, at display.
 */
export function approxPrice(coins: number, product: CoinProduct | null | undefined, locale?: Locales): string | null {
  if (!isUsableProduct(product) || !Number.isFinite(coins) || coins <= 0) return null;
  const micros = Math.round((coins * product.priceMicros) / product.coins);
  let digits: number;
  try {
    digits = new Intl.NumberFormat(locale as string | string[] | undefined, { style: 'currency', currency: product.currency })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return null;
  }
  if (Math.round((micros / 1_000_000) * 10 ** digits) === 0) return null;
  return formatMicros(micros, product.currency, locale);
}

export interface CoinPriceView {
  coins: number;
  /** "1,150" */
  coinsText: string;
  /** "€0.25", or null when there is nothing honest to show. */
  approx: string | null;
}

/** Everything a CoinPrice needs: the coins as text and the store-currency equivalent next to them. */
export function coinPrice(coins: number, product: CoinProduct | null | undefined, locale?: Locales): CoinPriceView {
  return { coins, coinsText: formatCoins(coins, locale), approx: approxPrice(coins, product, locale) };
}

// ---- VIP discount (mirrors resolve_episode_price) ---------------------------------------------------

export type VipTier = 'plus' | 'premium' | null;

/** The pricing_config keys resolve_episode_price reads, with the defaults it falls back to. */
export interface PricingConfig {
  defaultPriceShort: number;   // episodes up to 60 s
  defaultPriceLong: number;    // 61-120 s
  plusDiscountPct: number;
  premiumDiscountPct: number;
  maxDiscountPct: number;
}

export const DEFAULT_PRICING: PricingConfig = {
  defaultPriceShort: 25,
  defaultPriceLong: 40,
  plusDiscountPct: 10,
  premiumDiscountPct: 20,
  maxDiscountPct: 30,
};

// pricing_config key -> field of PricingConfig
const CONFIG_FIELDS: Record<string, keyof PricingConfig> = {
  default_price_short: 'defaultPriceShort',
  default_price_long: 'defaultPriceLong',
  plus_discount_pct: 'plusDiscountPct',
  premium_discount_pct: 'premiumDiscountPct',
  max_discount_pct: 'maxDiscountPct',
};

const INT32 = 2 ** 31;

/** One pricing_config value the way cfg_int reads it: an integer, or a string of digits. Anything else means "use the default". */
function configInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) < INT32 ? value : null;
  if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) {
    const n = Number(value.trim());
    return Math.abs(n) < INT32 ? n : null;
  }
  return null;
}

/** Build the config from `select key, value from pricing_config` rows. Missing or unreadable keys keep their defaults, like cfg_int. */
export function parsePricingConfig(rows: unknown): PricingConfig {
  const out: PricingConfig = { ...DEFAULT_PRICING };
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { key: name, value } = row as { key?: unknown; value?: unknown };
    const field = typeof name === 'string' && Object.hasOwn(CONFIG_FIELDS, name) ? CONFIG_FIELDS[name] : undefined;
    const n = field ? configInt(value) : null;
    if (field && n !== null) out[field] = n;
  }
  return out;
}

/** What an episode costs before any discount: its own price, else the series default, else by length (60 s or less is "short"). */
export function basePrice(
  input: { priceCoins?: number | null; seriesDefaultPrice?: number | null; durationS?: number | null },
  config: PricingConfig = DEFAULT_PRICING,
): number {
  return input.priceCoins ?? input.seriesDefaultPrice
    ?? ((input.durationS ?? 0) <= 60 ? config.defaultPriceShort : config.defaultPriceLong);
}

/** The discount percentage for a tier: Plus or Premium's own, never above the cap. No tier, no discount. */
export function discountPct(tier: VipTier, config: PricingConfig = DEFAULT_PRICING): number {
  let pct = 0;
  if (tier === 'premium') pct = config.premiumDiscountPct;
  else if (tier === 'plus') pct = config.plusDiscountPct;
  return Math.min(pct, config.maxDiscountPct);
}

/** Apply a percentage the way SQL does: integer division (truncated), and never below 1 coin. */
export function priceAfterDiscount(base: number, pct: number): number {
  return Math.max(1, Math.trunc((base * (100 - pct)) / 100));
}

export interface UnlockPrice {
  base: number;
  discountPct: number;
  price: number;
}

/** The price a priced (not free, not own) episode costs a user of `tier`. */
export function unlockPrice(base: number, tier: VipTier, config: PricingConfig = DEFAULT_PRICING): UnlockPrice {
  const pct = discountPct(tier, config);
  return { base, discountPct: pct, price: priceAfterDiscount(base, pct) };
}

// ---- Episode state for rows and the unlock sheet -------------------------------------------------

export type EpisodeAccessState =
  | 'unlocked'   // already unlocked: play
  | 'own'        // the creator's own episode: play
  | 'free'       // free for everyone: play
  | 'locked'     // costs coins: show the unlock sheet
  | 'mature_opt_in_required'
  | 'unavailable';

export interface EpisodeAccessView {
  state: EpisodeAccessState;
  /** What the user pays now (0 unless locked). */
  price: number;
  /** The price before the VIP discount (equals price when there is none). */
  basePrice: number;
  discountPct: number;
  /** True when a discount applies, so the sheet can strike through basePrice. */
  discounted: boolean;
}

/** Turn public.get_episode_price into what a row or the unlock sheet shows. */
export function describeEpisodePrice(p: EpisodePrice): EpisodeAccessView {
  let state: EpisodeAccessState;
  if (!p.purchasable) state = p.reason === 'mature_opt_in_required' ? 'mature_opt_in_required' : 'unavailable';
  else if (p.unlocked) state = 'unlocked';
  else if (p.own) state = 'own';
  else if (p.free) state = 'free';
  else state = 'locked';
  const locked = state === 'locked';
  return {
    state,
    price: locked ? p.price : 0,
    basePrice: locked ? p.base_price : 0,
    discountPct: locked ? p.discount_pct : 0,
    discounted: locked && p.discount_pct > 0 && p.price < p.base_price,
  };
}
