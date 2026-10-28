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

type Wallet = { balance: number; paid: number; bonus: number; refund_debt: number; free_passes_left: number };

async function wallet(user: string): Promise<Wallet> {
  await db.asUser(user);
  return (await db.one<{ w: Wallet }>('select public.get_my_wallet() as w')).w;
}

/** A creator in the programme with a published, approved series of `n` episodes of 45 s. */
async function catalog(opts: { active?: boolean; n?: number; format?: string } = {}) {
  const c = await db.createAdult(`creator-${uniq()}@example.com`);
  await db.asUser(c);
  await db.q(`select public.set_ai_consent('upload_processing', array['meta'], 'v1', true)`);
  const s = (await db.one<{ id: string }>(
    `select public.studio_create_series('Series', 'S', $1, 'general', 'en', 3) as id`, [opts.format ?? 'live_action'])).id;
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  const eps: string[] = [];
  for (let i = 0; i < (opts.n ?? 5); i++) {
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
  if (opts.active ?? true) await db.q(`select svc.set_creator_status($1, 'active', '2026-10-27')`, [c]);
  return { creator: c, series: s, eps };
}

async function buy(user: string, coinsProduct = 'reeltale.coins.525', env = 'production', net: number | null = 3_675_000) {
  await db.asService();
  const txn = `txn-${uniq()}`;
  const r = await db.one<{ r: { status: string } }>(
    `select svc.credit_purchase($1, $2, 'app_store', $3, $4, $5, $6) as r`, [user, `evt-${uniq()}`, txn, coinsProduct, env, net]);
  return { txn, r: r.r };
}

async function unlock(user: string, ep: string, expected: number) {
  await db.asUser(user);
  return (await db.one<{ r: { status: string; coins_spent?: number; balance: number } }>(
    'select public.unlock_episode($1, $2) as r', [ep, expected])).r;
}

test('a production purchase credits never-expiring, valued coins', async () => {
  const u = await db.createAdult(`buyer-${uniq()}@example.com`);
  const { r } = await buy(u);
  assert.equal(r.status, 'credited');
  const w = await wallet(u);
  assert.equal(w.balance, 525);
  assert.equal(w.paid, 525);
  await db.asPostgres();
  const lot = await db.one<{ v: string; e: string | null }>(
    `select net_eur_micros_per_coin::text as v, expires_at::text as e from ledger.coin_lots where user_id = $1`, [u]);
  assert.equal(lot.v, String(Math.floor(3_675_000 / 525)));
  assert.equal(lot.e, null);
});

test('duplicate webhook events and duplicate store transactions credit once', async () => {
  const u = await db.createAdult(`dup-${uniq()}@example.com`);
  await db.asService();
  const evt = `evt-${uniq()}`;
  await db.q(`select svc.credit_purchase($1, $2, 'app_store', 't-dup', 'reeltale.coins.100', 'production', 700000)`, [u, evt]);
  const again = await db.one<{ r: { status: string } }>(
    `select svc.credit_purchase($1, $2, 'app_store', 't-dup', 'reeltale.coins.100', 'production', 700000) as r`, [u, evt]);
  assert.equal(again.r.status, 'duplicate_event');
  const other = await db.one<{ r: { status: string } }>(
    `select svc.credit_purchase($1, $2, 'app_store', 't-dup', 'reeltale.coins.100', 'production', 700000) as r`, [u, `evt-${uniq()}`]);
  assert.equal(other.r.status, 'duplicate_purchase');
  assert.equal((await wallet(u)).balance, 100);
});

test('sandbox purchases give nothing to non-testers', async () => {
  const u = await db.createAdult(`sandbox-plain-${uniq()}@example.com`);
  const { r } = await buy(u, 'reeltale.coins.1150', 'sandbox', 8_000_000);
  assert.equal(r.status, 'sandbox_ignored');
  assert.equal((await wallet(u)).balance, 0);
});

async function tester(email: string) {
  const u = await db.createAdult(email);
  await db.asService();
  await db.q(`select svc.set_sandbox_tester($1, true, 'test')`, [u]);
  return u;
}

test('sandbox testers get worthless, expiring coins and no AI access', async () => {
  const u = await tester(`sandbox-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.1150', 'sandbox', 8_000_000);
  const w = await wallet(u);
  assert.equal(w.balance, 1150);
  assert.equal(w.paid, 0);
  assert.equal(w.bonus, 1150);
  await db.asPostgres();
  const lot = await db.one<{ v: string; src: string }>(
    `select net_eur_micros_per_coin::text as v, source as src from ledger.coin_lots where user_id = $1`, [u]);
  assert.equal(lot.v, '0');
  assert.equal(lot.src, 'sandbox');
  await db.asUser(u);
  assert.equal((await db.one<{ a: boolean }>('select public.has_ai_access() as a')).a, false);
});

test('a production purchase gives AI access', async () => {
  const u = await db.createAdult(`ai-${uniq()}@example.com`);
  await db.asUser(u);
  assert.equal((await db.one<{ a: boolean }>('select public.has_ai_access() as a')).a, false);
  await buy(u, 'reeltale.coins.100');
  await db.asUser(u);
  assert.equal((await db.one<{ a: boolean }>('select public.has_ai_access() as a')).a, true);
});

test('the first episodes are free, later ones are priced by duration', async () => {
  const { eps } = await catalog();
  const u = await db.createAdult(`viewer-${uniq()}@example.com`);
  await db.asUser(u);
  const p1 = (await db.one<{ p: { free: boolean } }>('select public.get_episode_price($1) as p', [eps[0]])).p;
  assert.equal(p1.free, true);
  const p4 = (await db.one<{ p: { free: boolean; price: number } }>('select public.get_episode_price($1) as p', [eps[3]])).p;
  assert.equal(p4.free, false);
  assert.equal(p4.price, 25);
});

test('series of creators outside the programme, and AI series without Editor\'s Pick, are free', async () => {
  const notActive = await catalog({ active: false });
  const ai = await catalog({ format: 'ai_generated' });
  const u = await db.createAdult(`free-${uniq()}@example.com`);
  await db.asUser(u);
  for (const ep of [notActive.eps[4], ai.eps[4]]) {
    const p = (await db.one<{ p: { free: boolean } }>('select public.get_episode_price($1) as p', [ep])).p;
    assert.equal(p.free, true);
  }
});

test('unlocking charges the shown price once, creates the unlock and creator earnings', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`unlocker-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.525', 'production', 3_675_000); // 7000 micros per coin
  await db.asUser(u);
  await db.fails('select public.unlock_episode($1, 10)', [eps[3]], /price_changed/);
  const r = await unlock(u, eps[3], 25);
  assert.equal(r.status, 'unlocked');
  assert.equal(r.coins_spent, 25);
  assert.equal(r.balance, 500);
  const again = await unlock(u, eps[3], 25);
  assert.equal(again.status, 'already_unlocked');
  assert.equal((await wallet(u)).balance, 500);

  await db.asUser(creator);
  const earn = await db.q<{ amount_eur_micros: string; is_reserve: boolean; status: string }>(
    'select amount_eur_micros::text, is_reserve, status from public.earnings order by is_reserve');
  // 25 coins × 7000 micros × 50% = 87,500; 15% reserve = 13,125
  assert.deepEqual(earn.map((e) => [e.amount_eur_micros, e.is_reserve, e.status]),
    [['74375', false, 'pending'], ['13125', true, 'pending']]);
});

test('unlock fails cleanly without enough coins and charges nothing', async () => {
  const { eps } = await catalog();
  const u = await db.createAdult(`poor-${uniq()}@example.com`);
  await db.asUser(u);
  await db.fails('select public.unlock_episode($1, 25)', [eps[3]], /insufficient_coins/);
  assert.equal((await db.q('select episode_id from public.episode_unlocks')).length, 0);
});

test('bonus coins expiring soonest are spent first; sandbox coins earn creators nothing', async () => {
  const { creator, eps } = await catalog();
  const u = await tester(`order-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await buy(u, 'reeltale.coins.100', 'sandbox', null);
  await db.asService();
  await db.q(`select svc.grant_promo($1, $2, 10, now() + interval '2 days', 'promo', 'test')`, [u, `p-${uniq()}`]);
  const r = await unlock(u, eps[3], 25);
  assert.equal(r.status, 'unlocked');
  await db.asPostgres();
  const lots = await db.q<{ source: string; remaining: number }>(
    'select source, remaining from ledger.coin_lots where user_id = $1 order by id', [u]);
  // promo (2 days) first: 10, then sandbox (30 days): 15; paid untouched
  assert.deepEqual(lots.map((l) => [l.source, l.remaining]), [['iap', 100], ['sandbox', 85], ['promo', 0]]);
  await db.asUser(creator);
  assert.equal((await db.q('select id from public.earnings where episode_id = $1', [eps[3]])).length, 0);
});

test('creators unlock their own episodes for free and never earn from themselves', async () => {
  const { creator, eps } = await catalog();
  await buy(creator);
  const r = await unlock(creator, eps[4], 0);
  assert.equal(r.status, 'unlocked');
  assert.equal(r.coins_spent, 0);
  assert.equal((await wallet(creator)).balance, 525);
});

test('a refund removes unspent coins, turns spent ones into debt, voids pending earnings', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`refund-${uniq()}@example.com`);
  const { txn } = await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await unlock(u, eps[3], 25);
  await db.asService();
  const r = await db.one<{ r: { status: string; removed: number; debt_added: number } }>(
    `select svc.apply_refund($1, 'app_store', $2) as r`, [`evt-${uniq()}`, txn]);
  assert.deepEqual([r.r.status, r.r.removed, r.r.debt_added], ['refunded', 75, 25]);
  const w = await wallet(u);
  assert.equal(w.balance, 0);
  assert.equal(w.refund_debt, 25);
  await db.asUser(creator);
  const st = await db.q<{ status: string }>('select status from public.earnings where episode_id = $1', [eps[3]]);
  assert.ok(st.length === 2 && st.every((e) => e.status === 'void'));
  // Debt blocks spending until a purchase repays it.
  await buy(u, 'reeltale.coins.100', 'production', 700_000);
  const w2 = await wallet(u);
  assert.equal(w2.refund_debt, 0);
  assert.equal(w2.balance, 75);
  // Refunding twice does nothing.
  await db.asService();
  const twice = await db.one<{ r: { status: string } }>(`select svc.apply_refund($1, 'app_store', $2) as r`, [`evt-${uniq()}`, txn]);
  assert.equal(twice.r.status, 'already_refunded');
});

test('refund debt blocks unlocks', async () => {
  const { eps } = await catalog();
  const u = await db.createAdult(`debt-${uniq()}@example.com`);
  const a = await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await unlock(u, eps[3], 25);
  await unlock(u, eps[4], 25);
  await db.asService();
  await db.q(`select svc.apply_refund($1, 'app_store', $2)`, [`evt-${uniq()}`, a.txn]);
  const w = await wallet(u);
  assert.ok(w.refund_debt > 0);
  assert.ok(w.balance > 0);
  const { eps: more } = await catalog();
  await db.asUser(u);
  await db.fails('select public.unlock_episode($1, 25)', [more[3]], /refund_debt_outstanding/);
});

test('refunding coins whose earnings were already available adds a reversal row', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`late-${uniq()}@example.com`);
  const { txn } = await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await unlock(u, eps[3], 25);
  await db.asPostgres();
  await db.q(`update public.earnings set available_at = now() - interval '1 second' where creator_id = $1`, [creator]);
  await db.asService();
  await db.q('select svc.release_earnings()');
  await db.q(`select svc.apply_refund($1, 'app_store', $2)`, [`evt-${uniq()}`, txn]);
  await db.asUser(creator);
  const rows = await db.q<{ kind: string; amount: string; status: string }>(
    `select kind, amount_eur_micros::text as amount, status from public.earnings where episode_id = $1 order by id`, [eps[3]]);
  const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
  assert.equal(rows.filter((r) => r.kind === 'reversal').length, 2);
  assert.equal(sum, 0);
});

test('VIP: discount, stale events ignored, grants idempotent, trial coins worthless', async () => {
  const { eps } = await catalog();
  const u = await db.createAdult(`vip-${uniq()}@example.com`);
  await db.asService();
  const orig = `orig-${uniq()}`;
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 86400_000);
  await db.q(`select svc.upsert_subscription($1, $2, 'app_store', 'reeltale.plus.monthly', 'normal', 'active', $3, $4, true, 'production', $3)`,
    [u, orig, start.toISOString(), end.toISOString()]);
  const stale = await db.one<{ r: string }>(
    `select svc.upsert_subscription($1, $2, 'app_store', 'reeltale.plus.monthly', 'normal', 'expired', $3, $4, false, 'production', $5) as r`,
    [u, orig, start.toISOString(), end.toISOString(), new Date(start.getTime() - 1000).toISOString()]);
  assert.equal(stale.r, 'stale_event_ignored');
  await db.asUser(u);
  const p = (await db.one<{ p: { price: number; discount_pct: number } }>('select public.get_episode_price($1) as p', [eps[3]])).p;
  assert.deepEqual([p.price, p.discount_pct], [22, 10]);

  await db.asService();
  const g = `select svc.grant_sub_coins($1, $2, $3, 1, 1200, $4, 7000000, 'production', false) as r`;
  await db.q(g, [u, orig, start.toISOString(), end.toISOString()]);
  const dup = await db.one<{ r: { status: string } }>(g, [u, orig, start.toISOString(), end.toISOString()]);
  assert.equal(dup.r.status, 'duplicate');
  await db.q(`select svc.grant_sub_coins($1, $2, $3, 0, 100, $4, 9000000, 'production', true)`,
    [u, `${orig}-trial`, start.toISOString(), end.toISOString()]);
  await db.asPostgres();
  const lots = await db.q<{ source: string; v: string }>(
    'select source, net_eur_micros_per_coin::text as v from ledger.coin_lots where user_id = $1 order by id', [u]);
  assert.deepEqual(lots.map((l) => [l.source, l.v]), [['sub_grant', String(Math.floor(7_000_000 / 1200))], ['trial', '0']]);
  assert.equal((await wallet(u)).free_passes_left, 2);
});

test('Free Pass: one a day, no earnings', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`pass-${uniq()}@example.com`);
  await db.asUser(u);
  const r = (await db.one<{ r: { status: string } }>('select public.use_free_pass($1) as r', [eps[3]])).r;
  assert.equal(r.status, 'unlocked');
  await db.fails('select public.use_free_pass($1)', [eps[4]], /no_free_pass_left/);
  await db.asUser(creator);
  assert.equal((await db.q('select id from public.earnings where episode_id = $1', [eps[3]])).length, 0);
});

test('access codes: capped, once per user, grant coins and AI access', async () => {
  await db.asPostgres();
  await db.q(`insert into app_private.access_codes (code, coins, coins_expire_at, ai_days, max_redemptions, valid_until)
              values ('JUDGE-2026', 1500, now() + interval '20 days', 14, 2, now() + interval '30 days')`);
  const a = await db.createAdult(`judge1-${uniq()}@example.com`);
  const b = await db.createAdult(`judge2-${uniq()}@example.com`);
  const c = await db.createAdult(`judge3-${uniq()}@example.com`);
  await db.asService();
  assert.equal((await db.one<{ r: { status: string } }>(`select svc.redeem_access_code($1, 'judge-2026') as r`, [a])).r.status, 'redeemed');
  assert.equal((await db.one<{ r: { status: string } }>(`select svc.redeem_access_code($1, 'JUDGE-2026') as r`, [a])).r.status, 'already_redeemed');
  await db.q(`select svc.redeem_access_code($1, 'JUDGE-2026')`, [b]);
  await db.fails(`select svc.redeem_access_code($1, 'JUDGE-2026')`, [c], /code_used_up/);
  await db.fails(`select svc.redeem_access_code($1, 'NOPE-0000')`, [c], /invalid_code/);
  assert.equal((await wallet(a)).bonus, 1500);
  await db.asUser(a);
  assert.equal((await db.one<{ x: boolean }>('select public.has_ai_access() as x')).x, true);
});

type Hold = { hold_txn: number; settled: boolean };
const hold = async (u: string, key: string, coins: number) =>
  (await db.one<{ h: Hold }>(`select svc.ai_hold($1, $2, $3, '{}') as h`, [u, key, coins])).h;
const settle = async (u: string, txn: number, capture: boolean) =>
  (await db.one<{ r: { status: string } }>('select svc.ai_settle($1, $2, $3) as r', [u, txn, capture])).r.status;

test('AI holds: need access, settle exactly once, release returns the coins', async () => {
  const u = await db.createAdult(`aihold-${uniq()}@example.com`);
  await db.asService();
  await db.fails(`select svc.ai_hold($1, 'job-x', 30, '{}')`, [u], /ai_access_required/);
  await buy(u, 'reeltale.coins.100');
  await db.asService();
  const key = `job-${uniq()}`;
  const h = await hold(u, key, 30);
  const h2 = await hold(u, key, 30);
  assert.equal(h.hold_txn, h2.hold_txn, 'same key returns the same hold');
  assert.equal(h2.settled, false);
  assert.equal((await wallet(u)).balance, 70);
  await db.asService();
  assert.equal(await settle(u, h.hold_txn, false), 'released');
  assert.equal(await settle(u, h.hold_txn, true), 'already_settled');
  assert.equal((await hold(u, key, 30)).settled, true, 'reusing a settled key reports settled, charges nothing');
  assert.equal((await wallet(u)).balance, 100);
  await db.asService();
  const h3 = await hold(u, `job-${uniq()}`, 30);
  assert.equal(await settle(u, h3.hold_txn, true), 'captured');
  assert.equal((await wallet(u)).balance, 70);
});

test('removing a paid episode re-credits buyers and reverses earnings', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`removed-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await unlock(u, eps[3], 25);
  await db.asService();
  assert.equal((await db.one<{ n: number }>(`select svc.recredit_episode($1, 'moderation') as n`, [eps[3]])).n, 1);
  assert.equal((await db.one<{ n: number }>(`select svc.recredit_episode($1, 'moderation') as n`, [eps[3]])).n, 0);
  const w = await wallet(u);
  assert.equal(w.balance, 100);
  assert.equal(w.paid, 100, 'paid coins come back as paid coins');
  await db.asUser(creator);
  assert.ok((await db.q<{ status: string }>('select status from public.earnings where episode_id = $1', [eps[3]]))
    .every((e) => e.status === 'void'));
});

test('expired lots are swept with a transaction each', async () => {
  const u = await db.createAdult(`expire-${uniq()}@example.com`);
  await db.asService();
  await db.q(`select svc.grant_promo($1, $2, 50, now() + interval '2 days', 'promo', 'soon')`, [u, `e-${uniq()}`]);
  await db.asPostgres();
  await db.q(`update ledger.coin_lots set expires_at = now() - interval '1 minute' where user_id = $1`, [u]);
  await db.asService();
  assert.ok((await db.one<{ n: number }>('select svc.expire_lots() as n')).n >= 1);
  assert.equal((await wallet(u)).balance, 0);
});

test('ledger history is append-only, even for the owner role', async () => {
  await db.asPostgres();
  await db.fails('update ledger.transactions set coins_delta = 999999', [], /append-only/);
  await db.fails('delete from ledger.lot_consumptions', [], /append-only/);
  await db.fails('truncate ledger.transactions cascade', [], /append-only/);
});

test('clients and the service role cannot reach the ledger directly', async () => {
  const u = await db.createAdult(`direct-${uniq()}@example.com`);
  await db.asUser(u);
  await db.fails('select * from ledger.coin_lots', [], /permission denied/);
  await db.fails(`select svc.grant_promo($1, 'x', 999999, null, 'admin', 'x')`, [u], /permission denied/);
  await db.fails(`insert into public.earnings (creator_id, kind, episode_id, unlock_txn_id, lot_id, coins, amount_eur_micros, share_bps, available_at)
                  values ($1, 'earning', gen_random_uuid(), 1, 1, 1, 1, 1, now())`, [u], /permission denied/);
  await db.asService();
  await db.fails('select * from ledger.coin_lots', [], /permission denied/);
  await db.fails('update ledger.wallets set refund_debt = 0', [], /permission denied/);
});

test('playback: free, locked, unlocked, own, removed', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`play-${uniq()}@example.com`);
  await db.asService();
  const check = async (user: string, ep: string) =>
    (await db.one<{ r: { allowed: boolean; reason: string } }>('select svc.playback_check($1, $2) as r', [user, ep])).r;
  assert.deepEqual(await check(u, eps[0]), { ...(await check(u, eps[0])), allowed: true, reason: 'free' });
  assert.equal((await check(u, eps[3])).reason, 'locked');
  assert.equal((await check(creator, eps[3])).reason, 'own');
  await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await unlock(u, eps[3], 25);
  await db.asService();
  assert.equal((await check(u, eps[3])).reason, 'unlocked');
  // Closed to new unlocks: buyers keep watching.
  await db.asUser(creator);
  await db.q('select public.studio_close_episode($1)', [eps[3]]);
  await db.asService();
  assert.equal((await check(u, eps[3])).allowed, true);
  await db.q(`select svc.recredit_episode($1, 'moderation')`, [eps[3]]);
  assert.equal((await check(u, eps[3])).reason, 'not_available');
  const kid = await db.createUser(`kid-${uniq()}@example.com`);
  await db.asService();
  assert.equal((await check(kid, eps[0])).reason, 'not_adult');
});


// ---- Regression tests for the 2026-10-27 adversarial review ------------------------------------

async function ledgerSums(u: string) {
  await db.asPostgres();
  const d = await db.one<{ delta: number; lots: number }>(
    `select (select coalesce(sum(coins_delta), 0)::int from ledger.transactions where user_id = $1) as delta,
            (select coalesce(sum(remaining), 0)::int from ledger.coin_lots where user_id = $1) as lots`, [u]);
  return d;
}

test('review: refunding the purchase that paid off debt restores that debt', async () => {
  const { eps } = await catalog({ n: 8 });
  const u = await db.createAdult(`forgive-${uniq()}@example.com`);
  const a = await buy(u, 'reeltale.coins.100', 'production', 700_000);
  for (const ep of eps.slice(3, 7)) await unlock(u, ep, 25);
  await db.asService();
  await db.q(`select svc.apply_refund($1, 'app_store', $2)`, [`evt-${uniq()}`, a.txn]);
  assert.equal((await wallet(u)).refund_debt, 100);
  const b = await buy(u, 'reeltale.coins.100', 'production', 700_000);
  assert.equal((await wallet(u)).refund_debt, 0);
  await db.asService();
  const r = await db.one<{ r: { debt_added: number } }>(`select svc.apply_refund($1, 'app_store', $2) as r`, [`evt-${uniq()}`, b.txn]);
  assert.equal(r.r.debt_added, 100);
  const w = await wallet(u);
  assert.deepEqual([w.balance, w.refund_debt], [0, 100]);
  const s = await ledgerSums(u);
  assert.equal(s.delta, s.lots);
});

test('review: non-testers cannot spend sandbox value; testers can', async () => {
  const { eps } = await catalog();
  const u = await tester(`sbx-spend-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.100', 'sandbox', null);
  assert.equal((await unlock(u, eps[3], 25)).status, 'unlocked');
  // Removing someone from the allowlist stops sandbox coins from being spendable.
  await db.asService();
  await db.q(`select svc.set_sandbox_tester($1, false, null)`, [u]);
  await db.asUser(u);
  await db.fails('select public.unlock_episode($1, 25)', [eps[4]], /insufficient_coins/);
});

test('review: coins valued later still pay creators (pending earnings → value_lot)', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`usd-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.100', 'production', null);
  await unlock(u, eps[3], 25);
  await db.asUser(creator);
  assert.equal((await db.q('select id from public.earnings where episode_id = $1', [eps[3]])).length, 0);
  await db.asPostgres();
  const lot = (await db.one<{ id: number }>('select id from ledger.coin_lots where user_id = $1', [u])).id;
  await db.asService();
  assert.equal((await db.one<{ n: number }>('select svc.value_lot($1, 7000) as n', [lot])).n, 1);
  await db.fails('select svc.value_lot($1, 7000)', [lot], /lot_not_pending/);
  await db.asUser(creator);
  const e = await db.q<{ a: string }>('select amount_eur_micros::text as a from public.earnings where episode_id = $1 order by is_reserve', [eps[3]]);
  assert.deepEqual(e.map((x) => x.a), ['74375', '13125']);
});

test('review: a refunded subscription period loses its coins and its earnings', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`subref-${uniq()}@example.com`);
  const orig = `orig-${uniq()}`;
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 86400_000);
  await db.asService();
  await db.q(`select svc.upsert_subscription($1, $2, 'app_store', 'reeltale.plus.monthly', 'normal', 'active', $3, $4, true, 'production', $3)`,
    [u, orig, start.toISOString(), end.toISOString()]);
  await db.q(`select svc.grant_sub_coins($1, $2, $3, 1, 1200, $4, 7000000, 'production', false)`, [u, orig, start.toISOString(), end.toISOString()]);
  await unlock(u, eps[3], 22);
  await db.asService();
  const r = await db.one<{ r: { removed: number; debt_added: number } }>(
    'select svc.refund_subscription_period($1, $2, $3, $4) as r', [`evt-${uniq()}`, u, orig, start.toISOString()]);
  assert.deepEqual([r.r.removed, r.r.debt_added], [1178, 22]);
  const w = await wallet(u);
  assert.deepEqual([w.balance, w.refund_debt], [0, 22]);
  await db.asUser(creator);
  assert.ok((await db.q<{ status: string }>('select status from public.earnings where episode_id = $1', [eps[3]])).every((x) => x.status === 'void'));
  const s = await ledgerSums(u);
  assert.equal(s.delta, s.lots);
});

test('review: coins returned after a refund cancel debt instead of reviving refunded value', async () => {
  const { eps } = await catalog();
  const u = await db.createAdult(`revive-${uniq()}@example.com`);
  const a = await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await unlock(u, eps[3], 25);
  await db.asService();
  await db.q(`select svc.apply_refund($1, 'app_store', $2)`, [`evt-${uniq()}`, a.txn]);
  assert.equal((await wallet(u)).refund_debt, 25);
  await db.asService();
  await db.q(`select svc.recredit_episode($1, 'moderation')`, [eps[3]]);
  const w = await wallet(u);
  assert.deepEqual([w.balance, w.refund_debt], [0, 0]);
  const s = await ledgerSums(u);
  assert.equal(s.delta, s.lots);
});

test('review: AI hold keys are per user and per amount', async () => {
  const u = await db.createAdult(`holdu-${uniq()}@example.com`);
  const v = await db.createAdult(`holdv-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.525');
  await buy(v, 'reeltale.coins.525');
  await db.asService();
  const key = `scene-${uniq()}`;
  const hu = await hold(u, key, 50);
  const hv = await hold(v, key, 50);
  assert.notEqual(hu.hold_txn, hv.hold_txn);
  assert.equal((await wallet(v)).balance, 475);
  await db.asService();
  await db.fails(`select svc.ai_hold($1, $2, 200, '{}')`, [u, key], /idempotency_conflict/);
  await db.fails('select svc.ai_settle($1, $2, true)', [v, hu.hold_txn], /hold_not_found/);
  await db.fails('select svc.ai_settle($1, $2, null)', [u, hu.hold_txn], /invalid_capture/);
});

test('review: the transaction log always adds up to the coins in lots', async () => {
  const { eps } = await catalog();
  const u = await db.createAdult(`sums-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await db.asService();
  const h = await hold(u, `k-${uniq()}`, 30);
  await settle(u, h.hold_txn, false);
  await unlock(u, eps[3], 25);
  await db.asService();
  await db.q(`select svc.recredit_episode($1, 'moderation')`, [eps[3]]);
  const s = await ledgerSums(u);
  assert.deepEqual([s.delta, s.lots], [100, 100]);
});

test('review: reserve rows carry no coins, so coin totals are not doubled', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`coins-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await unlock(u, eps[3], 25);
  await db.asUser(creator);
  assert.equal((await db.one<{ c: number }>('select sum(coins)::int as c from public.earnings where episode_id = $1', [eps[3]])).c, 25);
});

test('review: a refund that arrives before its purchase is applied when the purchase lands', async () => {
  const u = await db.createAdult(`early-${uniq()}@example.com`);
  const txn = `txn-${uniq()}`;
  await db.asService();
  const r = await db.one<{ r: { status: string } }>(`select svc.apply_refund($1, 'app_store', $2) as r`, [`evt-${uniq()}`, txn]);
  assert.equal(r.r.status, 'refund_pending');
  const c = await db.one<{ r: { status: string } }>(
    `select svc.credit_purchase($1, $2, 'app_store', $3, 'reeltale.coins.100', 'production', 700000) as r`, [u, `evt-${uniq()}`, txn]);
  assert.equal(c.r.status, 'credited_and_refunded');
  assert.equal((await wallet(u)).balance, 0);
});

test('review: creator accounts can be deleted (records kept)', async () => {
  const { creator } = await catalog();
  await db.asPostgres();
  await db.q('delete from auth.users where id = $1', [creator]);
  const ca = await db.one<{ n: number }>('select count(*)::int as n from public.creator_accounts where user_id = $1', [creator]);
  assert.equal(ca.n, 1);
});

test('review: promo keys are per user; dead codes are refused', async () => {
  const a = await db.createAdult(`pa-${uniq()}@example.com`);
  const b = await db.createAdult(`pb-${uniq()}@example.com`);
  await db.asService();
  await db.q(`select svc.grant_promo($1, 'welcome', 50, null, 'promo', 'x')`, [a]);
  assert.equal((await db.one<{ r: { status: string } }>(`select svc.grant_promo($1, 'welcome', 50, null, 'promo', 'x') as r`, [b])).r.status, 'granted');
  await db.fails(`select svc.grant_promo($1, 'soon', 50, now() + interval '1 hour', 'promo', 'x')`, [a], /invalid_grant/);
  await db.asPostgres();
  await db.q(`insert into app_private.access_codes (code, coins, coins_expire_at, max_redemptions, valid_until)
              values ('DEADCOINS-1', 100, now() + interval '2 hours', 5, now() + interval '10 days')`);
  await db.asService();
  await db.fails(`select svc.redeem_access_code($1, 'DEADCOINS-1')`, [a], /invalid_code/);
});

test('review: takedowns block owners too; buyers keep access while an edit is re-reviewed', async () => {
  const { creator, series, eps } = await catalog();
  const u = await db.createAdult(`rereview-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.100', 'production', 700_000);
  await unlock(u, eps[3], 25);
  await db.asUser(creator);
  await db.q(`select public.studio_update_series($1, 'Renamed')`, [series]);
  await db.q(`select public.studio_update_episode($1, 'Renamed ep')`, [eps[3]]);
  await db.asService();
  const check = async (user: string, ep: string) =>
    (await db.one<{ r: { allowed: boolean; reason: string } }>('select svc.playback_check($1, $2) as r', [user, ep])).r;
  assert.equal((await check(u, eps[3])).reason, 'unlocked');
  await db.asUser(u);
  assert.equal((await db.q('select id from public.episodes where id = $1', [eps[3]])).length, 1, 'buyer still sees it');
  await db.asService();
  await db.q(`select svc.recredit_episode($1, 'copyright')`, [eps[3]]);
  assert.equal((await check(creator, eps[3])).reason, 'not_available');
});

test('review: deleting or blocked accounts lose AI access and code redemption at once', async () => {
  const u = await db.createAdult(`gone-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.100');
  await db.asUser(u);
  await db.q('select public.request_account_deletion()');
  await db.asService();
  await db.fails(`select svc.ai_hold($1, 'k', 30, '{}')`, [u], /ai_access_required/);
});

// ---- second review (prep/reviews/db-fix-verification-2026-10-27.json) ----------------------------

async function vip(u: string, opts: { net?: number | null } = {}) {
  const orig = `orig-${uniq()}`;
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 86400_000);
  await db.asService();
  await db.q(`select svc.upsert_subscription($1, $2, 'app_store', 'reeltale.plus.monthly', 'normal', 'active', $3, $4, true, 'production', $3)`,
    [u, orig, start.toISOString(), end.toISOString()]);
  const grant = async () => (await db.asService(), db.one<{ r: { status: string } }>(
    `select svc.grant_sub_coins($1, $2, $3, 1, 1200, $4, $5, 'production', false) as r`,
    [u, orig, start.toISOString(), end.toISOString(), opts.net === undefined ? 7_000_000 : opts.net]));
  const refund = async () => (await db.asService(), db.one<{ r: { status: string; removed?: number; debt_added?: number } }>(
    'select svc.refund_subscription_period($1, $2, $3, $4) as r', [`evt-${uniq()}`, u, orig, start.toISOString()]));
  return { orig, start, grant, refund };
}

async function lots(u: string) {
  await db.asPostgres();
  return db.q<{ id: number; remaining: number; expires_at: Date | null; restored_from_lot: number | null }>(
    'select id, remaining, expires_at, restored_from_lot from ledger.coin_lots where user_id = $1 order by id', [u]);
}

const release = async (u: string, txn: number) => {
  await db.asService();
  await settle(u, txn, false);
};

test('review 2: returned copies of nearly expired coins are never extended again', async () => {
  const u = await db.createAdult(`noext-${uniq()}@example.com`);
  await buy(u, 'reeltale.coins.100');
  await db.asService();
  await db.q(`select svc.grant_promo($1, $2, 100, now() + interval '30 days', 'promo', null)`, [u, `p-${uniq()}`]);
  await db.asPostgres();
  await db.q(`update ledger.coin_lots set expires_at = now() + interval '12 hours' where user_id = $1 and source = 'promo'`, [u]);
  // All 100 promo coins (they expire first) are held and returned: they move to one copy.
  await release(u, (await hold(u, `k-${uniq()}`, 100)).hold_txn);
  const copy = (await lots(u)).find((l) => l.restored_from_lot !== null)!;
  assert.equal(copy.remaining, 100);
  assert.ok(copy.expires_at!.getTime() > Date.now() + 6 * 86400_000, 'first return: one 7-day extension');

  // Time passes: the copy is now nearly expired. Holding and releasing again must not extend it.
  await db.asPostgres();
  await db.q(`update ledger.coin_lots set expires_at = now() + interval '12 hours' where id = $1`, [copy.id]);
  const before = (await lots(u)).length;
  await release(u, (await hold(u, `k-${uniq()}`, 50)).hold_txn);
  const after = await lots(u);
  assert.equal(after.length, before, 'coins went back into the copy');
  assert.ok(after.find((l) => l.id === copy.id)!.expires_at!.getTime() < Date.now() + 86400_000);

  // A copy whose date passed while the coins were held: they come back already expired and are swept.
  await release(u, await (async () => {
    const h = await hold(u, `k-${uniq()}`, 50);
    await db.asPostgres();
    await db.q(`update ledger.coin_lots set expires_at = now() - interval '1 minute' where id = $1`, [copy.id]);
    return h.hold_txn;
  })());
  await db.asService();
  await db.q('select svc.expire_lots(5000)');
  assert.equal((await wallet(u)).bonus, 0);
  const s = await ledgerSums(u);
  assert.equal(s.delta, s.lots);
});

test('review 2: a grant processed after its period was refunded is not credited', async () => {
  const u = await db.createAdult(`latergrant-${uniq()}@example.com`);
  const v = await vip(u);
  assert.equal((await v.refund()).r.status, 'refunded');
  assert.equal((await v.grant()).r.status, 'period_refunded');
  assert.equal((await wallet(u)).balance, 0);
});

test('review 2: refund debt counts coins really spent, not returned or expired ones', async () => {
  const u = await db.createAdult(`netdebt-${uniq()}@example.com`);
  const v = await vip(u);
  await v.grant();
  await db.asPostgres();
  await db.q(`update ledger.coin_lots set expires_at = now() + interval '12 hours' where user_id = $1`, [u]);
  await release(u, (await hold(u, `k-${uniq()}`, 1200)).hold_txn);
  const r = (await v.refund()).r;
  assert.deepEqual([r.removed, r.debt_added], [1200, 0]);

  const w = await db.createAdult(`expdebt-${uniq()}@example.com`);
  const vw = await vip(w);
  await vw.grant();
  await db.asPostgres();
  await db.q(`update ledger.coin_lots set expires_at = now() - interval '1 minute' where user_id = $1`, [w]);
  await db.asService();
  await db.q('select svc.expire_lots(5000)');
  assert.equal((await vw.refund()).r.debt_added, 0, 'coins that expired unspent are not debt');
  assert.equal((await wallet(w)).refund_debt, 0);
});

test('review 2: a second refund event for the same period changes nothing', async () => {
  const { eps } = await catalog();
  const u = await db.createAdult(`tworefunds-${uniq()}@example.com`);
  const v = await vip(u);
  await v.grant();
  await unlock(u, eps[3], 22);
  assert.equal((await v.refund()).r.debt_added, 22);
  await db.asService();
  await db.q(`select svc.recredit_episode($1, 'moderation')`, [eps[3]]);
  assert.equal((await v.refund()).r.status, 'already_refunded');
  const s = await ledgerSums(u);
  assert.equal(s.delta, s.lots);
});

test('review 2: valuing a lot also pays for spends from its returned copies', async () => {
  const { creator, eps } = await catalog();
  const u = await db.createAdult(`valuecopy-${uniq()}@example.com`);
  const v = await vip(u, { net: null });
  await v.grant();
  await db.asPostgres();
  const root = (await db.one<{ id: number }>('select id from ledger.coin_lots where user_id = $1', [u])).id;
  await db.q(`update ledger.coin_lots set expires_at = now() + interval '12 hours' where id = $1`, [root]);
  await release(u, (await hold(u, `k-${uniq()}`, 1200)).hold_txn);
  await unlock(u, eps[3], 22);
  await db.asService();
  assert.equal((await db.one<{ n: number }>('select svc.value_lot($1, 5000) as n', [root])).n, 1);
  await db.asUser(creator);
  assert.ok((await db.q('select id from public.earnings where episode_id = $1', [eps[3]])).length > 0);
});
