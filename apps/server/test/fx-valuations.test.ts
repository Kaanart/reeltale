import { test } from 'node:test';
import assert from 'node:assert/strict';
import { microsPerCoin, valueDueLots, type DueValuation } from '../src/ledger/fx-valuations.ts';
import { DbError } from '../src/lib/db.ts';
import { ECB_90D_URL, ECB_DAILY_URL, parseDecimal, type FxRates, type RateLookup } from '../src/lib/fx.ts';
import { scheduled } from '../src/app.ts';
import type { Env } from '../src/env.ts';

const row = (over: Partial<DueValuation>): DueValuation => ({
  id: 1, lot_id: 10, coins: 100, currency: 'USD', net_amount: '1', value_date: '2026-10-27', attempts: 0, ...over,
});

function harness(due: DueValuation[], rates: Record<string, RateLookup | Error>, answers: Record<string, unknown> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  const fx: FxRates = {
    async rate(currency, date) {
      const r = rates[`${currency}@${date}`];
      if (r instanceof Error) throw r;
      return r ?? { ok: false, reason: 'no_rate' };
    },
  };
  const io = {
    fx,
    log: (m: string) => logs.push(m),
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (fn === 'fx_valuations_due') return due as T;
      const a = answers[`${fn}:${String(args.p_id ?? args.p_lot)}`] ?? answers[fn];
      if (a instanceof Error) throw a;
      return (a ?? 'ok') as T;
    },
  };
  return { io, calls, logs };
}

const ok = (rate: string, rateDate = '2026-10-27'): RateLookup => ({ ok: true, rate: parseDecimal(rate)!, rateDate });

test('micros per coin is an exact floor', () => {
  assert.equal(microsPerCoin(924_898, 100), 9248);
  assert.equal(microsPerCoin(3_675_000, 525), 7000);
  assert.equal(microsPerCoin(Number.MAX_SAFE_INTEGER, 3), 3_002_399_751_580_330);
  assert.equal(microsPerCoin(0, 7), 0);
  assert.throws(() => microsPerCoin(1.5, 1));
  assert.throws(() => microsPerCoin(100, 0));
  assert.throws(() => microsPerCoin(-1, 1));
});

test('a due row is valued: ECB rate → euro micros → value_lot per coin → done with the rate used', async () => {
  const h = harness([row({ id: 7, lot_id: 42, coins: 525, net_amount: '4.2415', value_date: '2026-10-25' })],
    { 'USD@2026-10-25': ok('1.0765', '2026-10-23') });
  const s = await valueDueLots(h.io);
  assert.deepEqual(s, { valued: 1, waiting: 0, failed: 0 });
  assert.deepEqual(h.calls, [
    { fn: 'fx_valuations_due', args: { p_limit: 50 } },
    // floor(4.2415 / 1.0765 × 10^6) = 3940083; per coin floor(3940083 / 525) = 7504.
    { fn: 'value_lot', args: { p_lot: 42, p_micros_per_coin: 7504 } },
    { fn: 'fx_valuation_done', args: { p_id: 7, p_eur_micros: 3_940_083, p_rate: '1.0765', p_rate_date: '2026-10-23' } },
  ]);
});

test('JPY rows convert from whole yen', async () => {
  const h = harness([row({ currency: 'JPY', net_amount: '607.28' })], { 'JPY@2026-10-27': ok('162.45') });
  await valueDueLots(h.io);
  assert.deepEqual(h.calls[1]?.args, { p_lot: 10, p_micros_per_coin: 37382 });
  assert.equal(h.calls[2]?.args.p_eur_micros, 3_738_257);
});

test('an already valued lot (lot_not_pending) is only marked done; a purchase without a lot skips value_lot', async () => {
  const h = harness([row({ id: 1, lot_id: 10 }), row({ id: 2, lot_id: null })], { 'USD@2026-10-27': ok('1.0812') },
    { 'value_lot:10': new DbError(400, 'lot_not_pending') });
  const s = await valueDueLots(h.io);
  assert.deepEqual(s, { valued: 2, waiting: 0, failed: 0 });
  assert.deepEqual(h.calls.map((c) => `${c.fn}:${String(c.args.p_id ?? c.args.p_lot ?? '')}`),
    ['fx_valuations_due:', 'value_lot:10', 'fx_valuation_done:1', 'fx_valuation_done:2']);
});

test('no rate yet backs off; a currency the ECB never quotes or a date older than its history gives up at once', async () => {
  const h = harness([
    row({ id: 1 }),
    row({ id: 2, currency: 'ARS' }),
    row({ id: 3, value_date: '2026-01-02' }),
    row({ id: 4, value_date: '2026-10-28' }),
  ], {
    'ARS@2026-10-27': { ok: false, reason: 'unknown_currency' },
    'USD@2026-01-02': { ok: false, reason: 'out_of_range' },
    'USD@2026-10-28': { ok: false, reason: 'not_published_yet' },
  }, { 'fx_valuation_failed:2': 'failed', 'fx_valuation_failed:3': 'failed', fx_valuation_failed: 'retry' });
  const s = await valueDueLots(h.io);
  assert.deepEqual(s, { valued: 0, waiting: 2, failed: 2 });
  const failed = h.calls.filter((c) => c.fn === 'fx_valuation_failed').map((c) => c.args);
  assert.deepEqual(failed, [
    { p_id: 1, p_error: 'no_rate', p_retry: true },
    { p_id: 2, p_error: 'unknown_currency', p_retry: false },
    { p_id: 3, p_error: 'out_of_range', p_retry: false },
    { p_id: 4, p_error: 'not_published_yet', p_retry: true },
  ]);
  assert.ok(!h.calls.some((c) => c.fn === 'value_lot' || c.fn === 'fx_valuation_done'));
  assert.equal(h.logs.length, 2, 'giving up is logged');
});

test('errors back off without stopping the batch; a malformed amount gives up', async () => {
  const h = harness([row({ id: 1 }), row({ id: 2, lot_id: 20 }), row({ id: 3, net_amount: 'NaN' }), row({ id: 4, lot_id: 40 })],
    { 'USD@2026-10-27': ok('1.0812') },
    { 'fx_valuation_done:1': new DbError(503, 'database not configured'), 'value_lot:20': new DbError(400, 'invalid_value') });
  const s = await valueDueLots(h.io);
  assert.deepEqual(s, { valued: 1, waiting: 0, failed: 3 });
  const failed = h.calls.filter((c) => c.fn === 'fx_valuation_failed').map((c) => c.args);
  assert.deepEqual(failed, [
    { p_id: 1, p_error: 'valuation_error', p_retry: true },
    { p_id: 2, p_error: 'valuation_error', p_retry: true },
    { p_id: 3, p_error: 'bad_amount', p_retry: false },
  ]);
  assert.ok(!h.calls.some((c) => c.fn === 'fx_valuation_done' && c.args.p_id === 2), 'not done when value_lot failed');
  assert.ok(h.calls.some((c) => c.fn === 'fx_valuation_done' && c.args.p_id === 4));
});

test('a throwing rate source backs the row off instead of crashing the batch', async () => {
  const h = harness([row({ id: 1 })], { 'USD@2026-10-27': new Error('boom') });
  const s = await valueDueLots(h.io);
  assert.deepEqual(s, { valued: 0, waiting: 0, failed: 1 });
  assert.deepEqual(h.calls.at(-1)?.args, { p_id: 1, p_error: 'valuation_error', p_retry: true });
});

// ---- The cron entry point ------------------------------------------------------------------------------

const DAILY = `<Cube><Cube time='2026-10-27'><Cube currency='USD' rate='1.0812'/></Cube></Cube>`;

function cronFetch() {
  const rpcs: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === ECB_DAILY_URL || url === ECB_90D_URL) return new Response(DAILY);
    const m = /\/rest\/v1\/rpc\/(\w+)$/.exec(url);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    rpcs.push(m[1]!);
    assert.equal((init?.headers as Record<string, string>)['Content-Profile'], 'svc');
    if (m[1] === 'fx_valuations_due') return Response.json([row({ id: 9 })]);
    if (m[1] === 'moderation_queue') return Response.json([]);   // the ingest sweep, every tick
    return Response.json('done');
  }) as typeof fetch;
  return { impl, rpcs };
}

const cronEnv = { SUPABASE_URL: 'https://fx-cron.supabase.co', SUPABASE_SECRET_KEY: 'k', APP_ORIGIN: 'https://reeltale.net' } as Env;

test('the cron values FX only on the tick at minute 0, without needing the Meta key', async () => {
  const f = cronFetch();
  const fxCalls = () => f.rpcs.filter((r) => r !== 'moderation_queue');
  await scheduled(cronEnv, Date.parse('2026-10-27T16:02:00Z'), f.impl);
  assert.deepEqual(f.rpcs, ['moderation_queue'], 'other ticks: the ingest sweep only (text moderation skipped: no Meta key)');
  f.rpcs.length = 0;
  await scheduled(cronEnv, Date.parse('2026-10-27T16:00:00Z'), f.impl);
  assert.deepEqual(fxCalls(), ['fx_valuations_due', 'value_lot', 'fx_valuation_done']);
  f.rpcs.length = 0;
  await scheduled(cronEnv, undefined, f.impl);
  assert.deepEqual(fxCalls(), [], 'direct calls without a scheduled time never run FX'); 
});

test('the FX cron does nothing until the database is configured', async () => {
  const f = cronFetch();
  await scheduled({ APP_ORIGIN: 'https://reeltale.net' } as Env, Date.parse('2026-10-27T16:00:00Z'), f.impl);
  assert.deepEqual(f.rpcs, []);
});

test('an FX failure fails the cron run after moderation had its turn', async () => {
  const impl = (async () => new Response('{"message":"boom"}', { status: 500 })) as typeof fetch;
  await assert.rejects(scheduled(cronEnv, Date.parse('2026-10-27T16:00:00Z'), impl), /boom/);
});
