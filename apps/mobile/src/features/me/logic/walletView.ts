// How the wallet screen words its bonus lots. Builds on core/wallet.ts (which already drops lots whose date
// has passed): this only decides which expiry string a lot gets and what the list rows say.

import type { BonusGroup, ExpiringLot } from '../../../core/wallet.ts';
import { formatDay, isSameLocalDay, type Locales } from './dates.ts';

export interface TextSpec {
  /** i18next `namespace:path` key. */
  key: string;
  params: Record<string, string | number>;
}

/**
 * "Expires today", "Expires in 3 days" (within a week), or "Expires 12 Nov 2026". Today wins over the
 * days count, so a lot that goes at midnight never reads "in 1 day".
 */
export function expiryText(lot: ExpiringLot, now: Date, locale?: Locales): TextSpec {
  if (isSameLocalDay(lot.expiresAt, now)) return { key: 'wallet:lot.expiresToday', params: {} };
  if (lot.soon) return { key: 'wallet:lot.expiresInDays', params: { count: lot.daysLeft } };
  return { key: 'wallet:lot.expiresOn', params: { date: formatDay(lot.expiresAt, locale) } };
}

export interface LotLine {
  /** Stable within one render: the list never reorders on its own. */
  id: string;
  group: BonusGroup;
  coins: number;
  soon: boolean;
  expiry: TextSpec;
}

export function lotLines(lots: readonly ExpiringLot[], now: Date, locale?: Locales): LotLine[] {
  return lots.map((lot, i) => ({
    id: `${lot.expiresAt.getTime()}-${lot.group}-${i}`,
    group: lot.group,
    coins: lot.coins,
    soon: lot.soon,
    expiry: expiryText(lot, now, locale),
  }));
}

/** The i18n key of a lot's label ("VIP coins", "Trial coins" ...). */
export function lotLabelKey(group: BonusGroup): string {
  return `wallet:source.${group}`;
}
