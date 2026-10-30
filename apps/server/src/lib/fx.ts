// Euro values of purchases made in other currencies, from the ECB's euro foreign exchange reference rates.
//
// Money maths is exact: amounts are decimals held as BigInt (units / 10^scale), never floats, and every
// result is floored to whole euro micros once, at the end. ECB rates are units of the currency per 1 EUR,
// so euros = amount / rate.
//
// Which rate: the one for the purchase's UTC date or, when that day has none (weekend, TARGET holiday),
// the latest earlier day that has one, at most 7 days back. A date newer than the newest published
// rate is "not published yet", never a guess from an older day: the ECB publishes around 16:00 CET on
// working days, so a purchase made in the morning waits for that afternoon's rate (the FX cron values
// it then). The same purchase therefore always gets the same rate, whenever it is valued.
//
// Files (https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/):
// eurofxref-daily.xml (the latest working day) and eurofxref-hist-90d.xml (about the last 90 days).
// The ECB says the rates are "for information purposes only"; we use them to value coins for creator
// earnings and our own books, not to price anything.

// ---- Exact decimals ----------------------------------------------------------------------------------

/** An exact decimal: units / 10^scale. */
export interface Dec {
  units: bigint;
  scale: number;
}

const MAX_SCALE = 40;
const pow10 = (n: number) => 10n ** BigInt(n);

/**
 * Parse a decimal from text ("4.99", "162.45", "1e-7") or from a JSON number. A number is read through
 * its shortest round-trip text, which is exactly the decimal the JSON carried (4.99 → "4.99"), so no
 * binary-float error gets in. Returns null for anything that isn't a plain finite decimal.
 */
export function parseDecimal(input: string | number): Dec | null {
  if (typeof input === 'number' && !Number.isFinite(input)) return null;
  const text = typeof input === 'number' ? String(input) : input.trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(text);
  if (!m) return null;
  const [, sign, int, frac = '', exp = '0'] = m;
  if (int!.length + frac.length > 60) return null;
  let units = BigInt(int! + frac);
  let scale = frac.length - Number(exp);
  if (scale < 0) {
    if (scale < -MAX_SCALE) return null;
    units *= pow10(-scale);
    scale = 0;
  }
  if (scale > MAX_SCALE) return null;
  return { units: sign === '-' ? -units : units, scale };
}

/** Plain decimal text without trailing zeros ("3.375236", "800"); what Postgres numeric reads exactly. */
export function formatDecimal(d: Dec): string {
  if (d.units === 0n) return '0';
  const neg = d.units < 0n;
  let digits = (neg ? -d.units : d.units).toString();
  let scale = d.scale;
  while (scale > 0 && digits.endsWith('0') && digits.length > 1) {
    digits = digits.slice(0, -1);
    scale--;
  }
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return neg ? `-${digits}` : digits;
}

const ONE: Dec = { units: 1n, scale: 0 };

/**
 * Net proceeds in the purchase currency: gross × (1 − tax − commission), exactly. RevenueCat's tax and
 * commission are fractions of the gross price. Null unless all three are known, the gross is positive,
 * both fractions are ≥ 0, and something is left over.
 */
export function netAmount(
  gross: number | null | undefined,
  tax: number | null | undefined,
  commission: number | null | undefined,
): Dec | null {
  if (gross == null || tax == null || commission == null) return null;
  const g = parseDecimal(gross);
  const t = parseDecimal(tax);
  const c = parseDecimal(commission);
  if (!g || !t || !c || g.units <= 0n || t.units < 0n || c.units < 0n) return null;
  const s = Math.max(t.scale, c.scale);
  const keep = pow10(s) - t.units * pow10(s - t.scale) - c.units * pow10(s - c.scale);
  if (keep <= 0n) return null;
  return { units: g.units * keep, scale: g.scale + s };
}

/**
 * floor(amount × 1,000,000 / rate): euro micros for an amount in a currency quoted at `rate` units per
 * euro (1 for amounts already in euros). One floor, at the end. Throws on non-positive input or a
 * result beyond Number.MAX_SAFE_INTEGER (neither happens for real purchases).
 */
export function toEurMicros(amount: Dec, rate: Dec = ONE): number {
  if (amount.units <= 0n || rate.units <= 0n) throw new Error('toEurMicros needs positive amounts');
  const num = amount.units * 1_000_000n * pow10(rate.scale);
  const den = pow10(amount.scale) * rate.units;
  const micros = num / den; // BigInt division truncates, which is floor for positive numbers
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount too large');
  return Number(micros);
}

// ---- ECB reference rates -----------------------------------------------------------------------------

export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ECB_90D_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';

/** Rates per day: date (YYYY-MM-DD) → currency → units per 1 EUR. */
export interface RateTable {
  days: Map<string, Map<string, Dec>>;
  newest: string | null;
  oldest: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

export function isIsoDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The UTC calendar date of an instant, YYYY-MM-DD. */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return utcDate(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
}

/**
 * Parse an ECB eurofxref XML file (daily or history). The layout is nested <Cube> elements: one with a
 * `time` attribute per day, holding one per currency with `currency` and `rate`. Parsed with a tolerant
 * tag scan (attribute order, quote style and whitespace don't matter; Workers have no DOM parser).
 * Malformed entries are skipped, never guessed at; a file without one valid day gives an empty table.
 */
export function parseEcbXml(xml: string): RateTable {
  const days = new Map<string, Map<string, Dec>>();
  let current: Map<string, Dec> | null = null;
  for (const tag of xml.matchAll(/<(?:[\w.-]+:)?Cube\b([^>]*)>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of tag[1]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[a[1]!] = (a[2] ?? a[3] ?? '').trim();
    }
    if (attrs.time !== undefined) {
      // A new day starts; a malformed or repeated date ignores everything until the next day.
      current = isIsoDate(attrs.time) && !days.has(attrs.time) ? new Map() : null;
      if (current) days.set(attrs.time, current);
      continue;
    }
    if (current && attrs.currency !== undefined && attrs.rate !== undefined) {
      const rate = /^\d+(\.\d+)?$/.test(attrs.rate) ? parseDecimal(attrs.rate) : null;
      if (CURRENCY.test(attrs.currency) && attrs.currency !== 'EUR' && rate && rate.units > 0n && !current.has(attrs.currency)) {
        current.set(attrs.currency, rate);
      }
    }
  }
  for (const [day, rates] of days) if (rates.size === 0) days.delete(day);
  const sorted = [...days.keys()].sort();
  return { days, newest: sorted.at(-1) ?? null, oldest: sorted[0] ?? null };
}

export type RateLookup =
  | { ok: true; rate: Dec; rateDate: string }
  | {
      ok: false;
      /**
       * not_published_yet: the date is newer than the newest rate (wait). no_rate: the currency has no
       * rate on the latest working day ≤ date, or that day is more than 7 days back. unknown_currency:
       * the ECB doesn't quote it at all. out_of_range: older than the file covers. fetch_failed /
       * no_data: the ECB file couldn't be loaded or parsed.
       */
      reason: 'not_published_yet' | 'no_rate' | 'unknown_currency' | 'out_of_range' | 'fetch_failed' | 'no_data';
    };

export const MAX_RATE_AGE_DAYS = 7;

/** Pick the rate for `currency` on `date` from a table, by the rules at the top of this file. */
export function lookupRate(table: RateTable, currency: string, date: string): RateLookup {
  if (currency === 'EUR') return { ok: true, rate: ONE, rateDate: date };
  if (!table.newest || !table.oldest) return { ok: false, reason: 'no_data' };
  if (date > table.newest) return { ok: false, reason: 'not_published_yet' };
  if (date < table.oldest) return { ok: false, reason: 'out_of_range' };
  // The latest working day on or before the date. (Exists: oldest ≤ date.)
  let day = date;
  while (!table.days.has(day)) day = addDays(day, -1);
  if (day < addDays(date, -MAX_RATE_AGE_DAYS)) return { ok: false, reason: 'no_rate' };
  const rate = table.days.get(day)!.get(currency);
  if (rate) return { ok: true, rate, rateDate: day };
  const quoted = [...table.days.values()].some((r) => r.has(currency));
  return { ok: false, reason: quoted ? 'no_rate' : 'unknown_currency' };
}

// ---- Loading, with a per-day cache ---------------------------------------------------------------------

export interface FxRates {
  /** Never throws: failures come back as { ok: false }. */
  rate(currency: string, date: string): Promise<RateLookup>;
}

type MemoryEntry = { day: string; expires: number; table: RateTable };
/** Per-isolate fallback cache, shared by requests in the same isolate. */
const sharedMemory = new Map<string, MemoryEntry>();

export interface EcbOptions {
  fetchImpl?: typeof fetch;
  /** caches.default in Workers (see workerCache); null keeps only the in-memory cache. */
  cache?: Cache | null;
  /** An origin on our own zone for cache keys, e.g. https://reeltale.net. Nothing is served there. */
  cacheKeyBase: string;
  now?: () => number;
  timeoutMs?: number;
  memory?: Map<string, MemoryEntry>;
}

const FILES = { daily: ECB_DAILY_URL, hist90d: ECB_90D_URL } as const;
type FileKind = keyof typeof FILES;
const MAX_XML_BYTES = 2_000_000;
/** After a file failed to load, the same ecbRates() instance doesn't try it again for this long. */
const FAILED_RETRY_MS = 5 * 60_000;

/** The Workers Cache API when it exists (it doesn't in Node tests). */
export function workerCache(): Cache | null {
  try {
    return typeof caches !== 'undefined' && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

/**
 * How long a fetched file stays cached. Cache keys include the UTC day, so a new day always refetches.
 * Within the day: once the file has today's rate nothing more comes, so keep it until midnight UTC;
 * otherwise refetch hourly (today's rate appears around 16:00 CET on working days).
 */
export function cacheSeconds(table: RateTable, nowMs: number): number {
  const today = utcDate(nowMs);
  const midnight = Date.parse(`${addDays(today, 1)}T00:00:00Z`);
  const untilMidnight = Math.max(60, Math.floor((midnight - nowMs) / 1000));
  return table.newest === today ? untilMidnight : Math.min(3600, untilMidnight);
}

export function ecbRates(opts: EcbOptions): FxRates {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const memory = opts.memory ?? sharedMemory;
  const timeoutMs = opts.timeoutMs ?? 8000;
  // Files that just failed to load. While the ECB is down or hanging, a cron batch of 50 rows then makes
  // one attempt per file (with its timeout) instead of one per row: 2 fetches, not 100 (up to ~13 min).
  const failedAt = new Map<FileKind, number>();

  async function load(kind: FileKind): Promise<RateTable | null> {
    const nowMs = now();
    const failed = failedAt.get(kind);
    if (failed !== undefined && nowMs - failed < FAILED_RETRY_MS) return null;
    const table = await loadFile(kind, nowMs);
    if (!table) failedAt.set(kind, nowMs);
    return table;
  }

  async function loadFile(kind: FileKind, nowMs: number): Promise<RateTable | null> {
    const day = utcDate(nowMs);
    const key = `${opts.cacheKeyBase.replace(/\/+$/, '')}/__cache/ecb-fx/${kind}/${day}`;
    const mem = memory.get(kind);
    if (mem && mem.day === day && mem.expires > nowMs) return mem.table;

    let xml: string | null = null;
    if (opts.cache) {
      try {
        const hit = await opts.cache.match(key);
        if (hit) xml = await hit.text();
      } catch (err) {
        console.error('fx cache read failed', err instanceof Error ? err.message : err);
      }
    }
    const fromCache = xml !== null;
    if (xml === null) {
      try {
        const res = await fetchImpl(FILES[kind], { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) {
          console.error('ecb fetch failed', kind, res.status);
          return null;
        }
        xml = await res.text();
      } catch (err) {
        console.error('ecb fetch failed', kind, err instanceof Error ? err.message : err);
        return null;
      }
      if (xml.length > MAX_XML_BYTES) return null;
    }
    const table = parseEcbXml(xml);
    if (!table.newest) {
      if (fromCache) console.error('fx cache held an unusable ECB file', kind);
      return null;
    }
    const ttl = cacheSeconds(table, nowMs);
    // A copy from the Cache API may be close to its own expiry: hold it in memory for 5 minutes at most.
    memory.set(kind, { day, expires: nowMs + (fromCache ? Math.min(ttl, 300) : ttl) * 1000, table });
    if (opts.cache && !fromCache) {
      try {
        await opts.cache.put(key, new Response(xml, {
          headers: { 'Content-Type': 'application/xml', 'Cache-Control': `max-age=${ttl}` },
        }));
      } catch (err) {
        console.error('fx cache write failed', err instanceof Error ? err.message : err);
      }
    }
    return table;
  }

  return {
    async rate(currency, date) {
      if (currency === 'EUR') return { ok: true, rate: ONE, rateDate: date };
      if (!CURRENCY.test(currency)) return { ok: false, reason: 'unknown_currency' };
      if (!isIsoDate(date)) return { ok: false, reason: 'no_rate' };
      // The small daily file settles the latest working day and anything newer (not published yet).
      // Everything else, including "is this currency quoted at all", needs the 90-day history.
      const daily = await load('daily');
      if (daily?.newest && date >= daily.newest) {
        const r = lookupRate(daily, currency, date);
        if (r.ok || r.reason === 'not_published_yet') return r;
      }
      const hist = await load('hist90d');
      if (!hist) return { ok: false, reason: 'fetch_failed' };
      return lookupRate(hist, currency, date);
    },
  };
}
