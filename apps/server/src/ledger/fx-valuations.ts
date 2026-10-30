// FX cron step: values coins bought in other currencies whose ECB rate wasn't published when they were
// credited (or whose currency the ECB doesn't quote). Rows come from app_private.fx_valuations through
// svc.fx_valuations_due, which leases each row for 15 minutes so overlapping runs don't double up.
//
// Per row: ECB rate for its date → euro micros = floor(net × 10^6 / rate) → micros per coin =
// floor(euro micros / coins), the same division svc.credit_purchase and svc.grant_sub_coins use →
// svc.value_lot → svc.fx_valuation_done. A lot that is already valued ('lot_not_pending', e.g. a retry
// after value_lot succeeded but marking done failed) only needs marking done. Anything else backs off.

import { DbError } from '../lib/db.ts';
import { formatDecimal, parseDecimal, toEurMicros, type FxRates } from '../lib/fx.ts';

export interface DueValuation {
  id: number;
  /** Null for a purchase that only repaid refund debt (no coins credited): only its record gets a value. */
  lot_id: number | null;
  coins: number;
  currency: string;
  /** Exact decimal text in the purchase currency. */
  net_amount: string;
  value_date: string;
  attempts: number;
}

export interface FxValuationIO {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  fx: FxRates;
  log(message: string): void;
}

export interface FxValuationSummary {
  valued: number;
  waiting: number;
  failed: number;
}

// Reasons no automatic retry can fix: give up at once and leave the row to a person (RUNBOOK).
const PERMANENT: ReadonlySet<string> = new Set(['unknown_currency', 'out_of_range']);

/** micros per coin = floor(euro micros / coins), exactly. */
export function microsPerCoin(eurMicros: number, coins: number): number {
  if (!Number.isSafeInteger(eurMicros) || eurMicros < 0 || !Number.isSafeInteger(coins) || coins <= 0) {
    throw new Error('microsPerCoin needs whole, non-negative micros and positive coins');
  }
  return Number(BigInt(eurMicros) / BigInt(coins));
}

export async function valueDueLots(io: FxValuationIO, limit = 50): Promise<FxValuationSummary> {
  const summary: FxValuationSummary = { valued: 0, waiting: 0, failed: 0 };
  const due = await io.rpc<DueValuation[]>('fx_valuations_due', { p_limit: limit });
  for (const row of due ?? []) {
    try {
      const net = parseDecimal(row.net_amount);
      if (!net || net.units <= 0n) {
        await io.rpc('fx_valuation_failed', { p_id: row.id, p_error: 'bad_amount', p_retry: false });
        summary.failed++;
        continue;
      }
      const r = await io.fx.rate(row.currency, row.value_date);
      if (!r.ok) {
        const outcome = await io.rpc<string>('fx_valuation_failed', {
          p_id: row.id, p_error: r.reason, p_retry: !PERMANENT.has(r.reason),
        });
        if (outcome === 'failed') {
          io.log(`fx valuation ${row.id} gave up: ${r.reason} (${row.currency} ${row.value_date})`);
          summary.failed++;
        } else {
          summary.waiting++;
        }
        continue;
      }
      const eurMicros = toEurMicros(net, r.rate);
      if (row.lot_id != null) {
        try {
          await io.rpc('value_lot', { p_lot: row.lot_id, p_micros_per_coin: microsPerCoin(eurMicros, row.coins) });
        } catch (err) {
          if (!(err instanceof DbError && err.message === 'lot_not_pending')) throw err;
        }
      }
      await io.rpc('fx_valuation_done', {
        p_id: row.id, p_eur_micros: eurMicros, p_rate: formatDecimal(r.rate), p_rate_date: r.rateDate,
      });
      summary.valued++;
    } catch (err) {
      summary.failed++;
      io.log(`fx valuation ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      await io.rpc('fx_valuation_failed', { p_id: row.id, p_error: 'valuation_error', p_retry: true }).catch(() => {});
    }
  }
  return summary;
}
