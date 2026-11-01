// FX valuations (20261028090200_fx.sql): non-EUR coins recorded by the webhook, valued by the FX cron.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, type TestDb } from './harness.ts';

let db: TestDb;
before(async () => {
  db = await freshDb({ seed: true });
});
after(async () => {
  await db.close();
});

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

type FxRow = {
  id: number; kind: string; lot_id: number | null; coins: number; currency: string; net_amount: string;
  value_date: string; status: string; attempts: number; last_error: string | null; eur_micros: string | null;
  rate: string | null; rate_date: string | null; wait_min: number;
};

async function fxRow(id: number): Promise<FxRow> {
  await db.asPostgres();
  return db.one<FxRow>(
    `select id, kind, lot_id, coins, currency, net_amount::text, value_date::text, status, attempts, last_error,
            eur_micros::text, rate::text, rate_date::text,
            round(extract(epoch from next_attempt_at - now()) / 60)::int as wait_min
     from app_private.fx_valuations where id = $1`, [id]);
}

/** A creator in the programme with a published, approved series; episodes 4 and later cost 25 coins. */
async function catalog(n = 5) {
  const c = await db.createAdult(`creator-${uniq()}@example.com`);
  await db.asUser(c);
  await db.q(`select public.set_ai_consent('upload_processing', array['meta'], 'v1', true)`);
  const s = (await db.one<{ id: string }>(
    `select public.studio_create_series('Series', 'S', 'live_action', 'general', 'en', 3) as id`)).id;
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  const eps: string[] = [];
  for (let i = 0; i < n; i++) {
    await db.asUser(c);
    const ep = (await db.one<{ id: string }>('select public.studio_create_episode($1) as id', [s])).id;
    await db.asService();
    await db.q('select svc.check_episode_upload($1, $2)', [c, ep]);
    await db.q('select svc.bind_episode_upload($1, $2)', [ep, `asset-${ep}`]);
    await db.q(`select svc.attach_episode_media($1, 'cf_stream', $2, 45, null, null)`, [ep, `asset-${ep}`]);
    await db.q(`select svc.set_moderation('episode', $1, 'approved', (select content_version from public.episodes where id = $1))`, [ep]);
    await db.asUser(c);
    await db.q('select public.studio_publish_episode($1)', [ep]);
    eps.push(ep);
  }
  await db.asService();
  await db.q(`select svc.set_moderation('series', $1, 'approved', (select content_version from public.series where id = $1))`, [s]);
  await db.q(`select svc.set_creator_status($1, 'active', '2026-10-27')`, [c]);
  return { creator: c, eps };
}

async function buy(user: string, product = 'reeltale.coins.100', env = 'production', net: number | null = null) {
  await db.asService();
  const txn = `txn-${uniq()}`;
  const r = await db.one<{ r: { status: string } }>(
    `select svc.credit_purchase($1, $2, 'app_store', $3, $4, $5, $6) as r`, [user, `evt-${uniq()}`, txn, product, env, net]);
  return { txn, status: r.r.status };
}

async function unlock(user: string, ep: string, expected: number) {
  await db.asUser(user);
  return (await db.one<{ r: { status: string } }>('select public.unlock_episode($1, $2) as r', [ep, expected])).r;
}

async function recordPurchase(txn: string, currency = 'USD', net = '1', at = '2026-03-01T23:30:00-05:00') {
  await db.asService();
  return (await db.one<{ s: string }>(
    `select svc.record_purchase_fx('app_store', $1, $2, $3, $4) as s`, [txn, currency, net, at])).s;
}

async function rowFor(txn: string): Promise<FxRow> {
  await db.asPostgres();
  const { id } = await db.one<{ id: number }>(
    `select id from app_private.fx_valuations where source_key = $1`, [`purchase:app_store:${txn}`]);
  return fxRow(id);
}

async function lotOf(user: string): Promise<number> {
  await db.asPostgres();
  return (await db.one<{ id: number }>('select id from ledger.coin_lots where user_id = $1 order by id limit 1', [user])).id;
}

test('a non-EUR purchase without a rate is recorded once, with the product coins and the UTC purchase date', async () => {
  const u = await db.createAdult(`usd-${uniq()}@example.com`);
  const { txn } = await buy(u, 'reeltale.coins.525');
  assert.equal(await recordPurchase(txn, 'USD', '3.375236'), 'recorded');
  assert.equal(await recordPurchase(txn, 'USD', '3.375236'), 'already_recorded');
  const row = await rowFor(txn);
  assert.equal(row.kind, 'purchase');
  assert.equal(row.lot_id, await lotOf(u));
  assert.equal(row.coins, 525);
  assert.equal(row.currency, 'USD');
  assert.equal(row.net_amount, '3.375236');
  assert.equal(row.value_date, '2026-03-02', '23:30 at UTC-5 is the next day in UTC');
  assert.deepEqual([row.status, row.attempts], ['pending', 0]);
});

test('nothing is recorded for sandbox or already valued purchases; unknown purchases and bad input are refused', async () => {
  const u = await db.createAdult(`fx-skip-${uniq()}@example.com`);
  const sandbox = await buy(u, 'reeltale.coins.100', 'sandbox');
  assert.equal(await recordPurchase(sandbox.txn), 'not_needed');
  const valued = await buy(u, 'reeltale.coins.100', 'production', 700_000);
  assert.equal(await recordPurchase(valued.txn), 'not_needed');
  await db.asService();
  await db.fails(`select svc.record_purchase_fx('app_store', 'no-such-txn', 'USD', 1, now())`, [], /purchase_not_found/);

  const { txn } = await buy(u);
  const bad: [string, unknown, string | null][] = [
    ['EUR', '1', '2026-03-01T00:00:00Z'],
    ['usd', '1', '2026-03-01T00:00:00Z'],
    ['US', '1', '2026-03-01T00:00:00Z'],
    ['USD', '0', '2026-03-01T00:00:00Z'],
    ['USD', '-1', '2026-03-01T00:00:00Z'],
    ['USD', '1000000000', '2026-03-01T00:00:00Z'],
    ['USD', '1', new Date(Date.now() + 3 * 86400_000).toISOString()],
    ['USD', '1', '2019-12-31T00:00:00Z'],
    ['USD', '1', null],
  ];
  await db.asService();
  for (const [cur, net, at] of bad) {
    await db.fails(`select svc.record_purchase_fx('app_store', $1, $2, $3, $4)`, [txn, cur, net, at], /invalid_fx_valuation/);
  }
  await db.asPostgres();
  const n = await db.one<{ n: number }>(
    `select count(*)::int as n from app_private.fx_valuations where source_key = any($1)`,
    [[sandbox.txn, valued.txn, txn].map((t) => `purchase:app_store:${t}`)]);
  assert.equal(n.n, 0);
});

test('subscription grants are recorded by their grant key; trials, valued grants and missing grants are not', async () => {
  const u = await db.createAdult(`fx-sub-${uniq()}@example.com`);
  const orig = `orig-${uniq()}`;
  const start = new Date(Date.now() - 86400_000);
  const end = new Date(start.getTime() + 30 * 86400_000);
  const grant = (o: string, net: number | null, trial = false) => db.q(
    `select svc.grant_sub_coins($1, $2, $3, 1, $4, $5, $6, 'production', $7)`,
    [u, o, start.toISOString(), trial ? 100 : 1200, end.toISOString(), net, trial]);
  const record = async (o: string, at = start) => (await db.one<{ s: string }>(
    `select svc.record_sub_grant_fx($1, $2, 1, 'GBP', '6.123') as s`, [o, at.toISOString()])).s;

  await db.asService();
  await grant(orig, null);
  assert.equal(await record(orig), 'recorded');
  assert.equal(await record(orig), 'already_recorded');
  await db.asPostgres();
  const r = await db.one<{ id: number }>(`select id from app_private.fx_valuations where kind = 'sub_grant' and lot_id = $1`,
    [await lotOf(u)]);
  const row = await fxRow(r.id);
  assert.deepEqual([row.coins, row.currency, row.net_amount, row.value_date], [1200, 'GBP', '6.123', start.toISOString().slice(0, 10)]);

  await db.asService();
  await grant(`${orig}-trial`, null, true);
  assert.equal(await record(`${orig}-trial`), 'not_needed', 'trial coins are worth nothing, not pending');
  await grant(`${orig}-valued`, 7_000_000);
  assert.equal(await record(`${orig}-valued`), 'not_needed');
  assert.equal(await record(orig, new Date(start.getTime() + 1000)), 'no_grant', 'another period start is another grant');
  assert.equal(await record(`${orig}-never`), 'no_grant');
});

test('the FX cron round trip: due rows are leased, value_lot pays the creator, done completes the purchase record', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`fx-cron-${uniq()}@example.com`);
  const { txn } = await buy(u);
  await unlock(u, eps[3], 25);
  await db.asUser(creator);
  assert.equal((await db.q('select id from public.earnings where episode_id = $1', [eps[3]])).length, 0, 'placeholder only');
  assert.equal(await recordPurchase(txn, 'USD', '1', '2026-03-02T12:00:00Z'), 'recorded');
  const id = (await rowFor(txn)).id;

  await db.asService();
  const due = (await db.one<{ d: { id: number; lot_id: number; coins: number; net_amount: string; value_date: string }[] }>(
    'select svc.fx_valuations_due(500) as d')).d;
  const mine = due.find((d) => d.id === id);
  assert.deepEqual(mine && [mine.lot_id, mine.coins, mine.net_amount, mine.value_date], [await lotOf(u), 100, '1', '2026-03-02']);
  await db.asService();
  const again = (await db.one<{ d: { id: number }[] }>('select svc.fx_valuations_due(500) as d')).d;
  assert.ok(!again.some((d) => d.id === id), 'leased for 15 minutes');
  assert.equal((await fxRow(id)).wait_min, 15);

  // 1 USD at 1.0812 USD per EUR: floor(1e6 / 1.0812) = 924898 micros; per coin floor(924898 / 100) = 9248.
  await db.asService();
  await db.fails(`select svc.fx_valuation_done($1, 924898, 1.0812, '2026-03-02')`, [id], /lot_still_pending/);
  await db.fails(`select svc.fx_valuation_done($1, 924898, 1.0812, '2026-03-03')`, [id], /invalid_fx_valuation/);
  await db.fails(`select svc.fx_valuation_done($1, 924898, 1.0812, '2026-02-22')`, [id], /invalid_fx_valuation/);
  await db.fails(`select svc.fx_valuation_done($1, -1, 1.0812, '2026-03-02')`, [id], /invalid_fx_valuation/);
  await db.fails(`select svc.fx_valuation_done($1, 924898, 0, '2026-03-02')`, [id], /invalid_fx_valuation/);
  assert.equal((await db.one<{ n: number }>('select svc.value_lot($1, 9248) as n', [await lotOf(u)])).n, 1);
  await db.asService();
  assert.equal((await db.one<{ s: string }>(`select svc.fx_valuation_done($1, 924898, '1.0812', '2026-02-27') as s`, [id])).s, 'done');
  assert.equal((await db.one<{ s: string }>(`select svc.fx_valuation_done($1, 1, '9', '2026-03-02') as s`, [id])).s, 'already_done');
  assert.equal((await db.one<{ s: string }>(`select svc.fx_valuation_failed($1, 'late', true) as s`, [id])).s, 'done');

  const row = await fxRow(id);
  assert.deepEqual([row.status, row.eur_micros, row.rate, row.rate_date], ['done', '924898', '1.0812', '2026-02-27']);
  await db.asPostgres();
  const p = await db.one<{ v: string }>(`select net_eur_micros::text as v from ledger.purchases where store_transaction_id = $1`, [txn]);
  assert.equal(p.v, '924898');
  await db.asUser(creator);
  const e = await db.q<{ a: string }>('select amount_eur_micros::text as a from public.earnings where episode_id = $1 order by is_reserve', [eps[3]]);
  assert.equal(e.length, 2, 'the placeholder became a real earning (held part + reserve)');
  assert.equal(e.reduce((s, x) => s + Number(x.a), 0), Math.floor((25 * 9248 * 5000) / 10000));

  // Done rows are never offered again, even when their time has come.
  await db.asPostgres();
  await db.q(`update app_private.fx_valuations set next_attempt_at = now() - interval '1 hour' where id = $1`, [id]);
  await db.asService();
  assert.ok(!(await db.one<{ d: { id: number }[] }>('select svc.fx_valuations_due(500) as d')).d.some((d) => d.id === id));
});

test('failures back off 1 h, 2 h, ... 24 h, give up after 14 attempts or at once, and can still be valued by hand', async () => {
  const u = await db.createAdult(`fx-fail-${uniq()}@example.com`);
  const a = await buy(u);
  await recordPurchase(a.txn, 'ARS', '1500');
  const id = (await rowFor(a.txn)).id;
  const fail = async (retry: boolean) => {
    await db.asService();
    return (await db.one<{ s: string }>('select svc.fx_valuation_failed($1, $2, $3) as s', [id, 'not_published_yet', retry])).s;
  };
  const waits: number[] = [];
  for (let i = 0; i < 7; i++) {
    assert.equal(await fail(true), 'retry');
    waits.push((await fxRow(id)).wait_min);
  }
  // 5 minutes early, so the hourly cron tick (minute 0) catches each retry on time.
  assert.deepEqual(waits, [55, 115, 235, 475, 955, 1435, 1435]);
  assert.equal((await fxRow(id)).last_error, 'not_published_yet');
  await db.asPostgres();
  await db.q('update app_private.fx_valuations set attempts = 12 where id = $1', [id]);
  assert.equal(await fail(true), 'retry', 'attempt 13 still retries');
  assert.equal(await fail(true), 'failed', 'attempt 14 gives up');
  assert.deepEqual([(await fxRow(id)).status, (await fxRow(id)).attempts], ['failed', 14]);
  assert.equal(await fail(true), 'failed', 'nothing changes once failed');
  assert.equal((await fxRow(id)).attempts, 14);

  await db.asPostgres();
  await db.q(`update app_private.fx_valuations set next_attempt_at = now() - interval '1 hour' where id = $1`, [id]);
  await db.asService();
  assert.ok(!(await db.one<{ d: { id: number }[] }>('select svc.fx_valuations_due(500) as d')).d.some((d) => d.id === id));

  // Without retry (a currency the ECB doesn't quote) it fails at once.
  const b = await buy(u);
  await recordPurchase(b.txn, 'ARS', '1500');
  const idB = (await rowFor(b.txn)).id;
  await db.asService();
  assert.equal((await db.one<{ s: string }>(`select svc.fx_valuation_failed($1, 'unknown_currency', false) as s`, [idB])).s, 'failed');
  assert.equal((await fxRow(idB)).attempts, 1);

  // A person values it from another source (RUNBOOK): value_lot, then done.
  await db.asService();
  await db.q('select svc.value_lot($1, 50)', [(await rowFor(a.txn)).lot_id]);
  await db.asService();
  assert.equal((await db.one<{ s: string }>(`select svc.fx_valuation_done($1, 5000, '300', '2026-03-02') as s`, [id])).s, 'done');

  await db.asService();
  await db.fails(`select svc.fx_valuation_failed(-1, 'x', true)`, [], /valuation_not_found/);
  await db.fails(`select svc.fx_valuation_done(-1, 1, 1, '2026-03-02')`, [], /valuation_not_found/);
});

test('a purchase that only repaid refund debt has no lot: it is recorded and valued on the purchase record alone', async () => {
  const { eps } = await catalog(8);
  const u = await db.createAdult(`fx-debt-${uniq()}@example.com`);
  const first = await buy(u, 'reeltale.coins.100', 'production', 700_000);
  for (const ep of eps.slice(3, 7)) await unlock(u, ep, 25);
  await db.asService();
  await db.q(`select svc.apply_refund($1, 'app_store', $2)`, [`evt-${uniq()}`, first.txn]);
  const { txn } = await buy(u);
  await db.asPostgres();
  const p = await db.one<{ lot_id: number | null; repaid_debt: number }>(
    'select lot_id, repaid_debt from ledger.purchases where store_transaction_id = $1', [txn]);
  assert.deepEqual([p.lot_id, p.repaid_debt], [null, 100]);

  assert.equal(await recordPurchase(txn, 'CHF', '0.9'), 'recorded');
  const row = await rowFor(txn);
  assert.equal(row.lot_id, null);
  await db.asService();
  assert.equal((await db.one<{ s: string }>(`select svc.fx_valuation_done($1, 961538, '0.936', '2026-03-02') as s`, [row.id])).s, 'done');
  await db.asPostgres();
  const v = await db.one<{ v: string }>('select net_eur_micros::text as v from ledger.purchases where store_transaction_id = $1', [txn]);
  assert.equal(v.v, '961538');

  // Refunding it brings the debt back; a debt-only purchase whose value was known at once needs nothing.
  await db.asService();
  await db.q(`select svc.apply_refund($1, 'app_store', $2)`, [`evt-${uniq()}`, txn]);
  const valued = await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await db.asPostgres();
  assert.equal((await db.one<{ l: number | null }>('select lot_id as l from ledger.purchases where store_transaction_id = $1', [valued.txn])).l, null);
  assert.equal(await recordPurchase(valued.txn, 'CHF', '0.9'), 'not_needed');
});

test('only the service role gets in, and every FX function checks it again itself', async () => {
  const u = await db.createAdult(`fx-priv-${uniq()}@example.com`);
  const calls = [
    `select svc.record_purchase_fx('app_store', 'x', 'USD', 1, now())`,
    `select svc.record_sub_grant_fx('x', now(), 1, 'USD', 1)`,
    'select svc.fx_valuations_due(10)',
    `select svc.fx_valuation_done(1, 1, 1, current_date)`,
    `select svc.fx_valuation_failed(1, 'x', true)`,
  ];
  const signatures = [
    'svc.record_purchase_fx(text, text, text, numeric, timestamptz)',
    'svc.record_sub_grant_fx(text, timestamptz, integer, text, numeric)',
    'svc.fx_valuations_due(integer)',
    'svc.fx_valuation_done(bigint, bigint, numeric, date)',
    'svc.fx_valuation_failed(bigint, text, boolean)',
  ];
  for (const sql of calls) {
    await db.asUser(u);
    await db.fails(sql, [], /permission denied/);
    await db.asAnon();
    await db.fails(sql, [], /permission denied/);
  }
  await db.asService();
  await db.fails('select * from app_private.fx_valuations', [], /permission denied/);

  // Second barrier: even with EXECUTE granted by mistake, svc.require_service_role() refuses a user.
  for (const [i, sql] of calls.entries()) {
    await db.asPostgres();
    await db.pg.exec(`grant usage on schema svc to authenticated; grant execute on function ${signatures[i]} to authenticated`);
    try {
      await db.asUser(u);
      await db.fails(sql, [], /service role required/);
    } finally {
      await db.asPostgres();
      await db.pg.exec(`revoke execute on function ${signatures[i]} from authenticated; revoke usage on schema svc from authenticated`);
    }
  }
});
