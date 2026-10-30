import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheSeconds, ecbRates, ECB_90D_URL, ECB_DAILY_URL, formatDecimal, lookupRate, netAmount, parseDecimal, parseEcbXml,
  toEurMicros, type Dec, type RateTable,
} from '../src/lib/fx.ts';

const dec = (s: string) => parseDecimal(s)!;

// ECB-shaped fixtures (no network). Oct 2026: 23rd Fri, 24–25 weekend, 26 Mon, 27 Tue; nothing from the 10th
// to the 21st (a gap longer than a week); ISK missing on the 26th. Plus junk the parser must skip.
const HIST = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
  <Cube>
    <Cube time='2026-10-27'>
      <Cube currency='USD' rate='1.0812'/><Cube currency='JPY' rate='162.45'/>
      <Cube rate="0.8712" currency="GBP" /><Cube currency='ISK' rate='149.30'/>
    </Cube>
    <Cube time='2026-10-26'>
      <Cube currency='USD' rate='1.0790'/><Cube currency='JPY' rate='161.90'/><Cube currency='GBP' rate='0.8700'/>
    </Cube>
    <Cube time='2026-10-23'>
      <Cube currency='USD' rate='1.0765'/><Cube currency='JPY' rate='161.02'/><Cube currency='GBP' rate='0.8690'/>
      <Cube currency='ISK' rate='149.10'/>
      <Cube currency='usd' rate='9.9'/><Cube currency='XAU' rate='abc'/><Cube currency='CHF' rate='0'/>
      <Cube currency='NOK' rate='-11.2'/><Cube currency='EUR' rate='1'/><Cube currency='USD' rate='2.0'/>
    </Cube>
    <Cube time='2026-02-30'>
      <Cube currency='USD' rate='5.0'/>
    </Cube>
    <Cube time='2026-10-09'>
      <Cube currency='USD' rate='1.0900'/><Cube currency='JPY' rate='160.00'/><Cube currency='GBP' rate='0.8650'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const DAILY = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube><Cube time='2026-10-27'>
    <Cube currency='USD' rate='1.0812'/><Cube currency='JPY' rate='162.45'/><Cube currency='GBP' rate='0.8712'/>
  </Cube></Cube>
</gesmes:Envelope>`;

const text = (d: Dec | undefined) => (d ? formatDecimal(d) : undefined);

test('decimals are parsed exactly, from text and from JSON numbers', () => {
  assert.deepEqual(parseDecimal('4.99'), { units: 499n, scale: 2 });
  assert.deepEqual(parseDecimal(4.99), { units: 499n, scale: 2 }, 'a JSON number is read through its exact decimal text');
  assert.deepEqual(parseDecimal(0.17355371900826447), { units: 17355371900826447n, scale: 17 });
  assert.deepEqual(parseDecimal('1e-7'), { units: 1n, scale: 7 });
  assert.deepEqual(parseDecimal(1.5e21), { units: 1500000000000000000000n, scale: 0 });
  assert.deepEqual(parseDecimal('-2.50'), { units: -250n, scale: 2 });
  for (const bad of ['', 'abc', '1.', '.5', '1,5', '0x10', '1e999', ' ', '--1']) assert.equal(parseDecimal(bad), null, bad);
  for (const bad of [NaN, Infinity, -Infinity]) assert.equal(parseDecimal(bad), null);
});

test('decimals print as plain text without trailing zeros', () => {
  assert.equal(formatDecimal({ units: 3375236n, scale: 6 }), '3.375236');
  assert.equal(formatDecimal({ units: 80000n, scale: 2 }), '800');
  assert.equal(formatDecimal({ units: 5n, scale: 3 }), '0.005');
  assert.equal(formatDecimal({ units: 0n, scale: 2 }), '0');
  assert.equal(formatDecimal({ units: -250n, scale: 2 }), '-2.5');
  assert.equal(formatDecimal({ units: 120n, scale: 0 }), '120');
});

test('net proceeds are exact where floats lose a micro', () => {
  const net = netAmount(5.99, 0, 0.3)!;
  assert.equal(formatDecimal(net), '4.193');
  assert.equal(toEurMicros(net), 4_193_000);
  assert.equal(Math.floor(5.99 * (1 - 0 - 0.3) * 1_000_000), 4_192_999, 'the float formula this replaces');
  assert.equal(formatDecimal(netAmount(4.99, 0.1736, 0.15)!), '3.375236');
  assert.equal(formatDecimal(netAmount(800, 0.0909, 0.15)!), '607.28', 'zero-decimal currencies come in whole units');
});

test('net proceeds are unknown without tax and commission, or when nothing is left', () => {
  assert.equal(netAmount(4.99, null, 0.15), null);
  assert.equal(netAmount(4.99, 0.1, undefined), null);
  assert.equal(netAmount(null, 0.1, 0.15), null);
  assert.equal(netAmount(0, 0.1, 0.15), null);
  assert.equal(netAmount(-4.99, 0.1, 0.15), null);
  assert.equal(netAmount(4.99, 0.7, 0.3), null, 'tax + commission = 100%');
  assert.equal(netAmount(4.99, 0.8, 0.3), null);
  assert.equal(netAmount(4.99, -0.1, 0.15), null, 'negative fractions are not trusted');
  assert.equal(netAmount(4.99, 0.1, -0.15), null);
});

test('conversion floors once, at the end, in euro micros', () => {
  assert.equal(toEurMicros(dec('3.375236'), dec('1.0812')), 3_121_749);
  assert.equal(toEurMicros(dec('1'), dec('1.0812')), 924_898);
  assert.equal(toEurMicros(dec('1.0812'), dec('1.0812')), 1_000_000, 'exactly one euro, not 999999');
  assert.equal(toEurMicros(dec('0.99'), dec('1.1')), 900_000);
  assert.equal(Math.floor((0.99 / 1.1) * 1_000_000), 899_999, 'the float formula would lose a micro');
  // JPY: no minor unit; 607.28 yen at 162.45 yen per euro.
  assert.equal(toEurMicros(netAmount(800, 0.0909, 0.15)!, dec('162.45')), 3_738_257);
  assert.equal(toEurMicros(dec('6.123'), dec('0.8712')), 7_028_236, 'a currency worth more than the euro');
  assert.throws(() => toEurMicros(dec('0'), dec('1.1')));
  assert.throws(() => toEurMicros(dec('1'), dec('0')));
});

test('the ECB file parser reads days and rates and skips anything malformed', () => {
  const t = parseEcbXml(HIST);
  assert.deepEqual([...t.days.keys()].sort(), ['2026-10-09', '2026-10-23', '2026-10-26', '2026-10-27']);
  assert.equal(t.newest, '2026-10-27');
  assert.equal(t.oldest, '2026-10-09');
  assert.equal(text(t.days.get('2026-10-27')!.get('GBP')), '0.8712', 'double quotes, attributes in any order');
  assert.equal(text(t.days.get('2026-10-27')!.get('ISK')), '149.3');
  const fri = t.days.get('2026-10-23')!;
  assert.deepEqual([...fri.keys()].sort(), ['GBP', 'ISK', 'JPY', 'USD'], 'lowercase, junk, zero, negative and EUR rows are skipped');
  assert.equal(text(fri.get('USD')), '1.0765', 'a repeated currency keeps the first rate');
  assert.equal(t.days.has('2026-02-30'), false);

  const empty = parseEcbXml('<html>Service unavailable</html>');
  assert.deepEqual([empty.newest, empty.oldest, empty.days.size], [null, null, 0]);
});

test('rate lookup: the purchase day, else the latest earlier working day within 7 days, never a guess', () => {
  const t: RateTable = parseEcbXml(HIST);
  const r = (cur: string, date: string) => {
    const x = lookupRate(t, cur, date);
    return x.ok ? [text(x.rate), x.rateDate] : x.reason;
  };
  assert.deepEqual(r('USD', '2026-10-27'), ['1.0812', '2026-10-27']);
  assert.deepEqual(r('JPY', '2026-10-25'), ['161.02', '2026-10-23'], 'Sunday uses Friday');
  assert.deepEqual(r('USD', '2026-10-24'), ['1.0765', '2026-10-23']);
  assert.equal(r('USD', '2026-10-28'), 'not_published_yet', 'newer than the newest rate: wait, do not use the 27th');
  assert.equal(r('USD', '2026-10-21'), 'no_rate', 'the latest earlier day is 12 days back');
  assert.deepEqual(r('USD', '2026-10-16'), ['1.09', '2026-10-09'], 'exactly 7 days back is still fine');
  assert.equal(r('USD', '2026-10-17'), 'no_rate', '8 days back is not');
  assert.equal(r('USD', '2026-10-08'), 'out_of_range');
  assert.equal(r('ISK', '2026-10-26'), 'no_rate', 'quoted elsewhere but not on that day: no older rate in its place');
  assert.equal(r('ARS', '2026-10-27'), 'unknown_currency');
  assert.deepEqual(r('EUR', '2026-10-28'), ['1', '2026-10-28']);
  assert.equal(lookupRate(parseEcbXml(''), 'USD', '2026-10-27').ok, false);
});

function fakeFetch(files: Partial<Record<string, string | Error | number>>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const f = files[url];
    if (f === undefined) throw new Error(`unexpected fetch ${url}`);
    if (f instanceof Error) throw f;
    if (typeof f === 'number') return new Response('nope', { status: f });
    return new Response(f, { headers: { 'Content-Type': 'text/xml' } });
  }) as typeof fetch;
  return { impl, calls };
}

function fakeCache() {
  const store = new Map<string, { body: string; cacheControl: string | null }>();
  const matches: string[] = [];
  const cache = {
    async match(key: string) {
      matches.push(key);
      const hit = store.get(key);
      return hit ? new Response(hit.body) : undefined;
    },
    async put(key: string, res: Response) {
      store.set(key, { body: await res.text(), cacheControl: res.headers.get('Cache-Control') });
    },
  } as unknown as Cache;
  return { cache, store, matches };
}

const AFTERNOON = Date.parse('2026-10-27T15:30:00Z'); // the 27th's rates are out

test('the daily file settles the latest day; older dates load the 90-day file; both are cached', async () => {
  const f = fakeFetch({ [ECB_DAILY_URL]: DAILY, [ECB_90D_URL]: HIST });
  const fx = ecbRates({ fetchImpl: f.impl, cache: null, cacheKeyBase: 'https://reeltale.net', now: () => AFTERNOON, memory: new Map() });
  const today = await fx.rate('USD', '2026-10-27');
  assert.deepEqual(today.ok && [text(today.rate), today.rateDate], ['1.0812', '2026-10-27']);
  assert.deepEqual(f.calls, [ECB_DAILY_URL]);
  assert.deepEqual(await fx.rate('JPY', '2026-10-28'), { ok: false, reason: 'not_published_yet' });
  assert.deepEqual(f.calls, [ECB_DAILY_URL], 'a future date needs no history');

  const sunday = await fx.rate('GBP', '2026-10-25');
  assert.deepEqual(sunday.ok && [text(sunday.rate), sunday.rateDate], ['0.869', '2026-10-23']);
  assert.deepEqual(f.calls, [ECB_DAILY_URL, ECB_90D_URL]);
  await fx.rate('USD', '2026-10-26');
  await fx.rate('USD', '2026-10-27');
  assert.equal(f.calls.length, 2, 'served from memory');

  // Not in the daily file: the history decides (and knows the ECB never quoted it).
  const ars = await fx.rate('ARS', '2026-10-27');
  assert.equal(!ars.ok && ars.reason, 'unknown_currency');
  const isk = await fx.rate('ISK', '2026-10-27');
  assert.deepEqual(isk.ok && text(isk.rate), '149.3');
  assert.equal(f.calls.length, 2);
});

test('bad input is answered without fetching', async () => {
  const f = fakeFetch({});
  const fx = ecbRates({ fetchImpl: f.impl, cache: null, cacheKeyBase: 'https://reeltale.net', now: () => AFTERNOON, memory: new Map() });
  assert.deepEqual(await fx.rate('usd', '2026-10-27'), { ok: false, reason: 'unknown_currency' });
  assert.deepEqual(await fx.rate('USD', '2026-13-01'), { ok: false, reason: 'no_rate' });
  assert.deepEqual(await fx.rate('USD', '27/10/2026'), { ok: false, reason: 'no_rate' });
  const eur = await fx.rate('EUR', '2026-10-27');
  assert.deepEqual(eur.ok && text(eur.rate), '1');
  assert.equal(f.calls.length, 0);
});

test('fetch failures, error statuses and unusable files give no rate and are not cached', async () => {
  for (const failure of [new Error('network down'), 503, '<html>maintenance</html>']) {
    const f = fakeFetch({ [ECB_DAILY_URL]: failure, [ECB_90D_URL]: failure });
    const c = fakeCache();
    const memory = new Map();
    const make = () => ecbRates({ fetchImpl: f.impl, cache: c.cache, cacheKeyBase: 'https://reeltale.net', now: () => AFTERNOON, memory });
    assert.deepEqual(await make().rate('USD', '2026-10-27'), { ok: false, reason: 'fetch_failed' });
    assert.equal(c.store.size, 0);
    assert.equal(memory.size, 0);
    await make().rate('USD', '2026-10-27');
    assert.equal(f.calls.length, 4, 'tried again by the next webhook or cron run');
  }
});

test('while the ECB is down, one cron batch tries each file once, not once per row', async () => {
  let now = AFTERNOON;
  const f = fakeFetch({ [ECB_DAILY_URL]: new Error('timeout'), [ECB_90D_URL]: new Error('timeout') });
  const fx = ecbRates({ fetchImpl: f.impl, cache: null, cacheKeyBase: 'https://reeltale.net', now: () => now, memory: new Map() });
  for (let row = 0; row < 50; row++) {
    assert.deepEqual(await fx.rate('USD', '2026-10-26'), { ok: false, reason: 'fetch_failed' });
  }
  assert.deepEqual(f.calls, [ECB_DAILY_URL, ECB_90D_URL]);
  // The same instance tries again after 5 minutes.
  now += 5 * 60_000;
  await fx.rate('USD', '2026-10-26');
  assert.equal(f.calls.length, 4);

  // Only the file that failed is skipped: the daily file keeps working while the history is down.
  const g = fakeFetch({ [ECB_DAILY_URL]: DAILY, [ECB_90D_URL]: new Error('timeout') });
  const fx2 = ecbRates({ fetchImpl: g.impl, cache: null, cacheKeyBase: 'https://reeltale.net', now: () => AFTERNOON, memory: new Map() });
  assert.equal((await fx2.rate('USD', '2026-10-26')).ok, false);
  assert.equal((await fx2.rate('USD', '2026-10-25')).ok, false);
  const today = await fx2.rate('USD', '2026-10-27');
  assert.deepEqual(today.ok && text(today.rate), '1.0812');
  assert.deepEqual(g.calls, [ECB_DAILY_URL, ECB_90D_URL]);
});

test('the Cache API copy is keyed per file and UTC day and reused by other isolates', async () => {
  const f = fakeFetch({ [ECB_DAILY_URL]: DAILY, [ECB_90D_URL]: HIST });
  const c = fakeCache();
  let now = AFTERNOON;
  const make = () => ecbRates({ fetchImpl: f.impl, cache: c.cache, cacheKeyBase: 'https://reeltale.net/', now: () => now, memory: new Map() });
  await make().rate('USD', '2026-10-23');
  assert.deepEqual([...c.store.keys()].sort(), [
    'https://reeltale.net/__cache/ecb-fx/daily/2026-10-27',
    'https://reeltale.net/__cache/ecb-fx/hist90d/2026-10-27',
  ]);
  assert.equal(c.store.get('https://reeltale.net/__cache/ecb-fx/daily/2026-10-27')!.cacheControl, 'max-age=30600',
    "today's rate is in: kept until midnight UTC");
  const isolate = make();
  const again = await isolate.rate('USD', '2026-10-23');
  assert.deepEqual(again.ok && text(again.rate), '1.0765');
  assert.equal(f.calls.length, 2, 'a fresh isolate reads the cached copies');
  // A copy read from the Cache API stays in memory for 5 minutes at most, then the Cache API decides again.
  const reads = c.matches.length;
  now += 4 * 60_000;
  await isolate.rate('USD', '2026-10-27');
  assert.equal(c.matches.length, reads);
  now += 2 * 60_000;
  await isolate.rate('USD', '2026-10-27');
  assert.equal(c.matches.length, reads + 1);
  assert.equal(f.calls.length, 2);
});

test('memory entries expire hourly until the day has its rate, and always at the next UTC day', async () => {
  let now = Date.parse('2026-10-28T10:00:00Z'); // the 28th's rates aren't out yet
  const f = fakeFetch({ [ECB_DAILY_URL]: DAILY, [ECB_90D_URL]: HIST });
  const fx = ecbRates({ fetchImpl: f.impl, cache: null, cacheKeyBase: 'https://reeltale.net', now: () => now, memory: new Map() });
  await fx.rate('USD', '2026-10-28');
  now += 59 * 60_000;
  await fx.rate('USD', '2026-10-28');
  assert.equal(f.calls.length, 1);
  now += 2 * 60_000;
  await fx.rate('USD', '2026-10-28');
  assert.equal(f.calls.length, 2, 'refetched after an hour');

  assert.equal(cacheSeconds(parseEcbXml(DAILY), Date.parse('2026-10-27T15:30:00Z')), 30_600);
  assert.equal(cacheSeconds(parseEcbXml(DAILY), Date.parse('2026-10-28T10:00:00Z')), 3600);
  assert.equal(cacheSeconds(parseEcbXml(DAILY), Date.parse('2026-10-28T23:59:30Z')), 60, 'never below a minute');
  assert.equal(cacheSeconds(parseEcbXml(DAILY), Date.parse('2026-10-28T23:30:00Z')), 1800, 'never past midnight');
});
