import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EpisodePrice } from '@reeltale/shared';
import {
  approxPrice, basePrice, coinPrice, DEFAULT_PRICING, describeEpisodePrice, discountPct, formatCoins, formatMicros,
  isUsableProduct, parsePricingConfig, priceAfterDiscount, referenceProduct, unlockPrice, type CoinProduct,
} from '../pricing.ts';

const EUR_100: CoinProduct = { coins: 100, priceMicros: 990_000, currency: 'EUR' };
const EUR_525: CoinProduct = { coins: 525, priceMicros: 4_990_000, currency: 'EUR' };
const EUR_1150: CoinProduct = { coins: 1150, priceMicros: 9_990_000, currency: 'EUR' };

test('formatCoins groups thousands by locale', () => {
  assert.equal(formatCoins(1150, 'en-US'), '1,150');
  assert.equal(formatCoins(25, 'en-US'), '25');
  assert.equal(formatCoins(1150, 'de-DE'), '1.150');
  assert.equal(formatCoins(0, 'en-US'), '0');
});

test('isUsableProduct refuses products that would give a wrong or empty price', () => {
  assert.equal(isUsableProduct(EUR_100), true);
  assert.equal(isUsableProduct(null), false);
  assert.equal(isUsableProduct(undefined), false);
  assert.equal(isUsableProduct({ ...EUR_100, coins: 0 }), false);
  assert.equal(isUsableProduct({ ...EUR_100, coins: 1.5 }), false);
  assert.equal(isUsableProduct({ ...EUR_100, priceMicros: 0 }), false);
  assert.equal(isUsableProduct({ ...EUR_100, priceMicros: Number.NaN }), false);
  assert.equal(isUsableProduct({ ...EUR_100, priceMicros: Infinity }), false);
  assert.equal(isUsableProduct({ ...EUR_100, currency: 'EURO' }), false);
  assert.equal(isUsableProduct({ ...EUR_100, currency: '' }), false);
});

test('referenceProduct is the smallest usable pack, and ignores unusable ones', () => {
  assert.equal(referenceProduct([EUR_1150, EUR_100, EUR_525]), EUR_100);
  assert.equal(referenceProduct([EUR_1150, { ...EUR_100, priceMicros: 0 }, EUR_525]), EUR_525);
  assert.equal(referenceProduct([]), null);
  assert.equal(referenceProduct([{ ...EUR_100, currency: 'x' }]), null);
  // Same size: the cheaper offer.
  const cheaper = { ...EUR_100, priceMicros: 890_000 };
  assert.equal(referenceProduct([EUR_100, cheaper]), cheaper);
});

test('formatMicros uses the currency symbol and decimals, and gives null for a currency Intl rejects', () => {
  assert.equal(formatMicros(1_230_000, 'EUR', 'en-US'), '€1.23');
  assert.equal(formatMicros(1_230_000, 'USD', 'en-US'), '$1.23');
  assert.equal(formatMicros(150_000_000, 'JPY', 'en-US'), '¥150');
  assert.equal(formatMicros(1_000_000, 'EURO', 'en-US'), null);
});

test('approxPrice: coins at the product rate, rounded once at display', () => {
  // 25 coins at €0.99 per 100 = €0.2475, shown as €0.25.
  assert.equal(approxPrice(25, EUR_100, 'en-US'), '€0.25');
  assert.equal(approxPrice(100, EUR_100, 'en-US'), '€0.99');
  assert.equal(approxPrice(40, EUR_100, 'en-US'), '€0.40');
  // The bigger pack is cheaper per coin: 25 coins = €0.2172.
  assert.equal(approxPrice(25, EUR_1150, 'en-US'), '€0.22');
  // Zero-decimal currency: 25 coins at ¥150 per 100 = ¥37.5 -> ¥38 (ties round away from zero).
  assert.equal(approxPrice(25, { coins: 100, priceMicros: 150_000_000, currency: 'JPY' }, 'en-US'), '¥38');
  assert.equal(approxPrice(25, { coins: 100, priceMicros: 990_000, currency: 'usd' }, 'en-US'), '$0.25');
});

test('approxPrice returns null instead of an untrue amount', () => {
  assert.equal(approxPrice(25, null, 'en-US'), null);
  assert.equal(approxPrice(25, undefined, 'en-US'), null);
  assert.equal(approxPrice(0, EUR_100, 'en-US'), null);
  assert.equal(approxPrice(-5, EUR_100, 'en-US'), null);
  assert.equal(approxPrice(Number.NaN, EUR_100, 'en-US'), null);
  assert.equal(approxPrice(25, { ...EUR_100, priceMicros: 0 }, 'en-US'), null);
  // Rounds to nothing: 1 coin at ¥1 per 100 coins would read "¥0".
  assert.equal(approxPrice(1, { coins: 100, priceMicros: 1_000_000, currency: 'JPY' }, 'en-US'), null);
});

test('coinPrice gives the coins text and the equivalent together', () => {
  assert.deepEqual(coinPrice(1150, EUR_100, 'en-US'), { coins: 1150, coinsText: '1,150', approx: '€11.39' });
  assert.deepEqual(coinPrice(25, null, 'en-US'), { coins: 25, coinsText: '25', approx: null });
});

test('basePrice: own price, then series default, then by length (same as resolve_episode_price)', () => {
  assert.equal(basePrice({ priceCoins: 40, seriesDefaultPrice: 30, durationS: 10 }), 40);
  assert.equal(basePrice({ priceCoins: null, seriesDefaultPrice: 30, durationS: 10 }), 30);
  assert.equal(basePrice({ durationS: 60 }), 25);
  assert.equal(basePrice({ durationS: 61 }), 40);
  assert.equal(basePrice({ durationS: 120 }), 40);
  assert.equal(basePrice({ durationS: null }), 25);
  assert.equal(basePrice({}), 25);
  assert.equal(basePrice({ durationS: 0 }), 25);
  assert.equal(basePrice({ durationS: 90 }, { ...DEFAULT_PRICING, defaultPriceLong: 55 }), 55);
});

test('discountPct: tier percentage, never above the cap', () => {
  assert.equal(discountPct(null), 0);
  assert.equal(discountPct('plus'), 10);
  assert.equal(discountPct('premium'), 20);
  assert.equal(discountPct('premium', { ...DEFAULT_PRICING, maxDiscountPct: 15 }), 15);
  assert.equal(discountPct('plus', { ...DEFAULT_PRICING, maxDiscountPct: 5 }), 5);
  assert.equal(discountPct(null, { ...DEFAULT_PRICING, maxDiscountPct: 5 }), 0);
});

test('priceAfterDiscount truncates like integer division and never goes below 1 coin', () => {
  assert.equal(priceAfterDiscount(25, 10), 22);   // 22.5 -> 22
  assert.equal(priceAfterDiscount(25, 20), 20);
  assert.equal(priceAfterDiscount(40, 10), 36);
  assert.equal(priceAfterDiscount(10, 30), 7);
  assert.equal(priceAfterDiscount(25, 0), 25);
  assert.equal(priceAfterDiscount(1, 90), 1);     // 0.1 -> 0 -> at least 1
  assert.equal(priceAfterDiscount(25, 100), 1);
  assert.equal(priceAfterDiscount(25, -10), 27);  // 27.5 -> 27: a negative discount raises the price, as the SQL would
});

test('unlockPrice puts base, tier discount and result together', () => {
  assert.deepEqual(unlockPrice(25, null), { base: 25, discountPct: 0, price: 25 });
  assert.deepEqual(unlockPrice(25, 'plus'), { base: 25, discountPct: 10, price: 22 });
  assert.deepEqual(unlockPrice(40, 'premium'), { base: 40, discountPct: 20, price: 32 });
});

test('parsePricingConfig reads pricing_config rows like cfg_int, keeping defaults for anything unusable', () => {
  const cfg = parsePricingConfig([
    { key: 'default_price_short', value: 30 },
    { key: 'default_price_long', value: '45' },
    { key: 'plus_discount_pct', value: ' 12 ' },
    { key: 'premium_discount_pct', value: 'twenty' },
    { key: 'max_discount_pct', value: 25.5 },
    { key: 'free_passes_per_day', value: 3 },
  ]);
  assert.deepEqual(cfg, { defaultPriceShort: 30, defaultPriceLong: 45, plusDiscountPct: 12, premiumDiscountPct: 20, maxDiscountPct: 30 });
});

test('parsePricingConfig is safe with junk', () => {
  assert.deepEqual(parsePricingConfig(null), DEFAULT_PRICING);
  assert.deepEqual(parsePricingConfig('nope'), DEFAULT_PRICING);
  assert.deepEqual(parsePricingConfig([null, 5, 'x', { key: 7, value: 1 }, { key: 'plus_discount_pct' }]), DEFAULT_PRICING);
  assert.deepEqual(parsePricingConfig([{ key: '__proto__', value: 1 }, { key: 'constructor', value: 1 }, { key: 'toString', value: 2 }]), DEFAULT_PRICING);
  assert.deepEqual(parsePricingConfig([{ key: 'plus_discount_pct', value: null }]), DEFAULT_PRICING);
  assert.deepEqual(parsePricingConfig([{ key: 'plus_discount_pct', value: 2 ** 40 }]), DEFAULT_PRICING);
  // The defaults object itself is never mutated.
  parsePricingConfig([{ key: 'plus_discount_pct', value: 99 }]);
  assert.equal(DEFAULT_PRICING.plusDiscountPct, 10);
});

const price = (over: Partial<EpisodePrice>): EpisodePrice => ({
  purchasable: true, free: false, own: false, base_price: 25, discount_pct: 0, price: 25, reason: 'priced', unlocked: false, ...over,
});

test('describeEpisodePrice: the state a row or sheet shows', () => {
  assert.deepEqual(describeEpisodePrice(price({})), { state: 'locked', price: 25, basePrice: 25, discountPct: 0, discounted: false });
  assert.deepEqual(describeEpisodePrice(price({ discount_pct: 10, price: 22 })), { state: 'locked', price: 22, basePrice: 25, discountPct: 10, discounted: true });
  assert.equal(describeEpisodePrice(price({ unlocked: true })).state, 'unlocked');
  assert.equal(describeEpisodePrice(price({ free: true, base_price: 0, price: 0, reason: 'free' })).state, 'free');
  assert.equal(describeEpisodePrice(price({ own: true, free: true, base_price: 0, price: 0, reason: 'own_episode' })).state, 'own');
  assert.equal(describeEpisodePrice(price({ purchasable: false, reason: 'mature_opt_in_required' })).state, 'mature_opt_in_required');
  assert.equal(describeEpisodePrice(price({ purchasable: false, reason: 'not_available' })).state, 'unavailable');
});

test('describeEpisodePrice: anything not locked shows no price, and an unavailable episode is never "unlocked"', () => {
  const free = describeEpisodePrice(price({ free: true, base_price: 25, price: 25, discount_pct: 10 }));
  assert.deepEqual(free, { state: 'free', price: 0, basePrice: 0, discountPct: 0, discounted: false });
  // Removed after being unlocked: the server says not purchasable, and playback would refuse.
  assert.equal(describeEpisodePrice(price({ purchasable: false, unlocked: true, reason: 'not_available' })).state, 'unavailable');
  // A discount of 0 is not shown as a discount even if the numbers are odd.
  assert.equal(describeEpisodePrice(price({ discount_pct: 0, price: 24 })).discounted, false);
  assert.equal(describeEpisodePrice(price({ discount_pct: 10, price: 25 })).discounted, false);
});
