-- Ledger: coins, purchases, subscriptions, unlocks, Free Pass, codes, refunds, creator earnings.
--
-- Model:
-- - Coins live in lots. A lot has an expiry (null = never, for coins bought in a store) and a value
--   in euro micros per coin, independently. Store coins: valued, never expire. VIP grants: valued at
--   the period's net proceeds, expire. Trial, promo, code and sandbox coins: worth 0.
-- - Spending takes soonest-expiring lots first (never-expiring last), oldest first on ties, and records
--   one consumption row per lot. Creator earnings are computed from those rows, so only coins someone
--   actually paid for create earnings. Coins whose value isn't known yet (non-EUR purchases before the
--   FX job) leave placeholder earnings that svc.value_lot turns into real ones.
-- - Every write takes the user's wallet row as a mutex (FOR UPDATE) and carries a unique idempotency
--   key, so retries and duplicate webhooks are no-ops. Lock order everywhere: episode, then wallet,
--   then lots, then earnings.
-- - Sandbox (TestFlight, App Review) purchases are free. They give coins only to allowlisted tester
--   accounts (app_private.sandbox_testers: App Review and our own demo accounts), those coins are worth
--   0, and only testers can spend sandbox coins or get sandbox VIP benefits.
-- - Refunds claw back unspent coins and turn spent ones (plus any debt the purchase had paid off) into
--   refund debt, which blocks spending until a later purchase repays it. Earnings from refunded coins
--   are voided or reversed. Coins returned later (failed AI job, removed episode) never go back into a
--   refunded lot: they cancel debt first.
-- - transactions and lot_consumptions are append-only, even for the owner role, and sum(coins_delta)
--   per user equals the coins in their lots (expired lots included until swept).
-- - Series whose creator hasn't joined the creator programme (creator_accounts.status = 'active')
--   are entirely free: otherwise default prices would lock episodes and Euragnos would keep the money.

-- ---------------------------------------------------------------------------------------------
-- Creator programme membership (apply to earn). Written by svc only. No foreign key to profiles: the
-- row (agreement, share) is kept for tax records after the account is deleted.
create table public.creator_accounts (
  user_id uuid primary key,
  status text not null default 'applied' check (status in ('applied', 'active', 'suspended', 'ended')),
  share_bps integer not null default 5000 check (share_bps between 0 and 10000),
  agreement_version text,
  accepted_at timestamptz,
  payouts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger creator_accounts_touch before update on public.creator_accounts
  for each row execute function app_private.tg_touch_updated_at();
revoke all on public.creator_accounts from anon, authenticated;
grant select (user_id, status, share_bps, agreement_version, accepted_at, payouts_enabled) on public.creator_accounts to authenticated;
alter table public.creator_accounts enable row level security;
create policy creator_accounts_owner_read on public.creator_accounts
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Prices and products: public configuration, changed by admins only.
create table public.pricing_config (
  key text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
revoke all on public.pricing_config from anon, authenticated;
grant select (key, value) on public.pricing_config to authenticated;
alter table public.pricing_config enable row level security;
create policy pricing_config_read on public.pricing_config for select to authenticated using (true);

insert into public.pricing_config (key, value) values
  ('default_price_short', '25'),          -- episodes up to 60 s
  ('default_price_long', '40'),           -- 61–120 s
  ('plus_discount_pct', '10'),
  ('premium_discount_pct', '20'),
  ('max_discount_pct', '30'),
  ('free_passes_per_day', '1'),
  ('free_passes_plus_bonus', '1'),
  ('creator_reserve_bps', '1500'),        -- 15% of each earning held 90 days
  ('earnings_hold_days', '30'),
  ('reserve_hold_days', '90'),
  ('sandbox_coin_days', '30'),
  ('ai_story_start_coins', '50'),
  ('ai_comic_scene_coins', '30'),
  ('ai_panel_reroll_coins', '5'),
  ('ai_video_scene_coins', '200');

create table public.products (
  product_id text primary key check (product_id ~ '^[a-z0-9._]{3,80}$'),
  kind text not null check (kind in ('coin_pack', 'subscription')),
  coins integer check (coins is null or coins > 0),
  tier text check (tier is null or tier in ('plus', 'premium')),
  period text check (period is null or period in ('week', 'month', 'year')),
  active boolean not null default true,
  sort smallint not null default 0,
  check ((kind = 'coin_pack' and coins is not null and tier is null) or (kind = 'subscription' and tier is not null and period is not null))
);
revoke all on public.products from anon, authenticated;
grant select (product_id, kind, coins, tier, period, active, sort) on public.products to authenticated;
alter table public.products enable row level security;
create policy products_read on public.products for select to authenticated using (true);

insert into public.products (product_id, kind, coins, tier, period, sort) values
  ('reeltale.coins.100', 'coin_pack', 100, null, null, 10),
  ('reeltale.coins.525', 'coin_pack', 525, null, null, 20),
  ('reeltale.coins.1150', 'coin_pack', 1150, null, null, 30),
  ('reeltale.plus.monthly', 'subscription', null, 'plus', 'month', 40);

-- Reads a numeric config value, with a default if missing.
create function app_private.cfg_int(p_key text, p_default integer) returns integer
language sql stable
set search_path = ''
as $$
  select coalesce((select (c.value #>> '{}')::integer from public.pricing_config c where c.key = p_key), p_default)
$$;
revoke all on function app_private.cfg_int(text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Ledger tables (no client or service_role access; only definer functions touch them).
create table ledger.wallets (
  user_id uuid primary key,
  refund_debt integer not null default 0 check (refund_debt >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ledger.transactions (
  id bigint generated always as identity primary key,
  idempotency_key text not null unique,
  user_id uuid not null,
  type text not null check (type in ('purchase', 'grant', 'unlock', 'ai_hold', 'ai_capture', 'ai_release',
                                     'refund', 'expire', 'recredit', 'adjust')),
  coins_delta integer not null,
  ref jsonb not null default '{}'::jsonb,
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  created_at timestamptz not null default now()
);
create index transactions_user_idx on ledger.transactions (user_id, created_at desc);

create table ledger.coin_lots (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  source text not null check (source in ('iap', 'web', 'sub_grant', 'trial', 'promo', 'code', 'sandbox',
                                         'refund_return', 'admin')),
  initial integer not null check (initial > 0),
  remaining integer not null check (remaining >= 0 and remaining <= initial),
  net_eur_micros_per_coin bigint not null default 0 check (net_eur_micros_per_coin >= 0),
  expires_at timestamptz,
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  valuation_pending boolean not null default false,
  voided_at timestamptz,                    -- the money behind this lot was refunded
  restored_from_lot bigint references ledger.coin_lots (id),  -- returned coins: root lot they came from
  txn_id bigint not null references ledger.transactions (id),
  created_at timestamptz not null default now(),
  constraint sandbox_is_worthless check (environment = 'production' or net_eur_micros_per_coin = 0),
  constraint only_paid_sources_have_value check (
    net_eur_micros_per_coin = 0 or source in ('iap', 'web', 'sub_grant', 'refund_return'))
);
create index coin_lots_spendable_idx on ledger.coin_lots (user_id, expires_at nulls last, id) where remaining > 0;
create index coin_lots_txn_idx on ledger.coin_lots (txn_id);

create table ledger.lot_consumptions (
  id bigint generated always as identity primary key,
  txn_id bigint not null references ledger.transactions (id),
  lot_id bigint not null references ledger.coin_lots (id),
  coins integer not null check (coins <> 0),           -- > 0 consumed, < 0 returned
  net_eur_micros bigint not null,
  created_at timestamptz not null default now()
);
create index lot_consumptions_txn_idx on ledger.lot_consumptions (txn_id);
create index lot_consumptions_lot_idx on ledger.lot_consumptions (lot_id);

create table ledger.purchases (
  store text not null check (store in ('app_store', 'play_store', 'web')),
  store_transaction_id text not null,
  user_id uuid not null,
  product_id text not null,
  coins integer not null check (coins > 0),
  environment text not null check (environment in ('production', 'sandbox')),
  net_eur_micros bigint,
  repaid_debt integer not null default 0 check (repaid_debt >= 0),
  lot_id bigint references ledger.coin_lots (id),
  txn_id bigint not null references ledger.transactions (id),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (store, store_transaction_id)
);

create trigger transactions_append_only before update or delete on ledger.transactions
  for each row execute function app_private.tg_forbid_mutation();
create trigger lot_consumptions_append_only before update or delete on ledger.lot_consumptions
  for each row execute function app_private.tg_forbid_mutation();
create trigger transactions_no_truncate before truncate on ledger.transactions
  for each statement execute function app_private.tg_forbid_mutation();
create trigger lot_consumptions_no_truncate before truncate on ledger.lot_consumptions
  for each statement execute function app_private.tg_forbid_mutation();

create table app_private.webhook_events (
  provider text not null check (provider in ('revenuecat', 'stream', 'stripe', 'admob')),
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- A refund that arrived before its purchase (out of order, or the purchase is still retrying). Applied
-- the moment the purchase is credited.
create table app_private.pending_refunds (
  store text not null,
  store_transaction_id text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (store, store_transaction_id)
);

-- Accounts allowed to receive and spend sandbox coins and sandbox VIP: App Review, our demo/judge
-- accounts, our own devices. Everyone else's sandbox purchases are recorded but give nothing.
create table app_private.sandbox_testers (
  user_id uuid primary key,
  note text,
  added_at timestamptz not null default now()
);

-- Earnings for coins whose value isn't known yet; turned into real earnings by svc.value_lot.
create table app_private.pending_earnings (
  id bigint generated always as identity primary key,
  creator_id uuid not null,
  episode_id uuid not null,
  unlock_txn_id bigint not null,
  lot_id bigint not null,
  coins integer not null check (coins > 0),
  share_bps integer not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  voided_at timestamptz,
  unique (unlock_txn_id, lot_id)
);

-- ---------------------------------------------------------------------------------------------
-- Public money-adjacent tables the client reads (own rows only).
create table public.subscriptions (
  store_original_transaction_id text primary key,
  user_id uuid not null,
  store text not null check (store in ('app_store', 'play_store', 'web')),
  product_id text not null,
  tier text not null check (tier in ('plus', 'premium')),
  period_type text not null default 'normal' check (period_type in ('normal', 'trial', 'intro')),
  status text not null check (status in ('active', 'expired', 'billing_issue', 'paused', 'refunded')),
  period_start timestamptz,
  period_end timestamptz,
  auto_renew boolean not null default true,
  environment text not null check (environment in ('production', 'sandbox')),
  last_event_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on public.subscriptions (user_id);
revoke all on public.subscriptions from anon, authenticated;
grant select (store_original_transaction_id, user_id, store, product_id, tier, period_type, status, period_start,
              period_end, auto_renew, environment)
  on public.subscriptions to authenticated;
alter table public.subscriptions enable row level security;
create policy subscriptions_owner_read on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

create table public.daily_passes (
  user_id uuid not null,
  utc_day date not null,
  used smallint not null default 0 check (used >= 0),
  primary key (user_id, utc_day)
);
revoke all on public.daily_passes from anon, authenticated;
grant select (user_id, utc_day, used) on public.daily_passes to authenticated;
alter table public.daily_passes enable row level security;
create policy daily_passes_owner_read on public.daily_passes
  for select to authenticated using (user_id = (select auth.uid()));

-- One row per valued lot consumption, split into a held part and a reserve part (the reserve row
-- carries coins = 0, so coin totals aren't doubled). Reversals are new rows for earnings already
-- available or paid; pending ones are voided in place.
create table public.earnings (
  id bigint generated always as identity primary key,
  creator_id uuid not null,
  kind text not null check (kind in ('earning', 'reversal')),
  is_reserve boolean not null default false,
  episode_id uuid not null references public.episodes (id),
  unlock_txn_id bigint not null,
  lot_id bigint not null,
  coins integer not null,
  amount_eur_micros bigint not null,
  share_bps integer not null,
  reverses_id bigint references public.earnings (id),
  status text not null default 'pending' check (status in ('pending', 'available', 'paid', 'void')),
  available_at timestamptz not null,
  payout_id bigint,
  created_at timestamptz not null default now(),
  constraint earning_sign check (
    (kind = 'earning' and amount_eur_micros > 0 and reverses_id is null)
    or (kind = 'reversal' and amount_eur_micros < 0 and reverses_id is not null))
);
create index earnings_creator_idx on public.earnings (creator_id, status, available_at);
create index earnings_lot_idx on public.earnings (lot_id);
create unique index earnings_one_reversal on public.earnings (reverses_id) where reverses_id is not null;
create unique index earnings_one_per_part on public.earnings (unlock_txn_id, lot_id, is_reserve) where kind = 'earning';
revoke all on public.earnings from anon, authenticated;
grant select (id, creator_id, kind, is_reserve, episode_id, coins, amount_eur_micros, status, available_at, created_at)
  on public.earnings to authenticated;
alter table public.earnings enable row level security;
create policy earnings_owner_read on public.earnings
  for select to authenticated using (creator_id = (select auth.uid()));

-- Codes are stored uppercase and compared as plain text. (citext's = isn't found inside functions with
-- search_path = '', where comparisons silently fall back to case-sensitive text equality.)
create table app_private.access_codes (
  code text primary key check (code ~ '^[A-Z0-9-]{6,40}$'),
  coins integer not null default 0 check (coins >= 0),
  coins_expire_at timestamptz,
  ai_days integer not null default 0 check (ai_days between 0 and 60),
  max_redemptions integer not null check (max_redemptions > 0),
  redemptions integer not null default 0 check (redemptions >= 0),
  valid_until timestamptz not null,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  check (redemptions <= max_redemptions),
  check (coins = 0 or coins_expire_at is not null)
);

create table app_private.code_redemptions (
  code text not null references app_private.access_codes (code),
  user_id uuid not null,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);

-- ---------------------------------------------------------------------------------------------
-- Internal helpers

-- Per-user mutex. Every ledger write starts here (after any episode lock). Returns the refund debt.
create function app_private.lock_wallet(p_user uuid) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_debt integer;
begin
  insert into ledger.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select w.refund_debt into v_debt from ledger.wallets w where w.user_id = p_user for update;
  return v_debt;
end;
$$;
revoke all on function app_private.lock_wallet(uuid) from public, anon, authenticated;

-- Insert a transaction; returns null if the idempotency key was already used.
create function app_private.new_txn(p_key text, p_user uuid, p_type text, p_delta integer, p_ref jsonb, p_env text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into ledger.transactions (idempotency_key, user_id, type, coins_delta, ref, environment)
  values (p_key, p_user, p_type, p_delta, coalesce(p_ref, '{}'::jsonb), coalesce(p_env, 'production'))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app_private.new_txn(text, uuid, text, integer, jsonb, text) from public, anon, authenticated;

create function app_private.is_sandbox_tester(p_user uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from app_private.sandbox_testers t where t.user_id = p_user)
$$;
revoke all on function app_private.is_sandbox_tester(uuid) from public, anon, authenticated;

create function app_private.balance(p_user uuid) returns integer
language sql stable
set search_path = ''
as $$
  select coalesce(sum(l.remaining), 0)::integer from ledger.coin_lots l
  where l.user_id = p_user and l.remaining > 0 and (l.expires_at is null or l.expires_at > now())
$$;
revoke all on function app_private.balance(uuid) from public, anon, authenticated;

-- Spend p_amount coins for transaction p_txn. Caller holds the wallet lock. With p_production_only,
-- sandbox coins are skipped. Raises insufficient_coins (rolling back the caller) if it can't cover it.
create function app_private.spend_coins(p_user uuid, p_amount integer, p_txn bigint, p_production_only boolean)
returns table (lot_id bigint, coins integer, value_micros_per_coin bigint, valuation_pending boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_need integer := p_amount;
  v_take integer;
  r record;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  for r in
    select l.id, l.remaining, l.net_eur_micros_per_coin, l.valuation_pending as pending
    from ledger.coin_lots l
    where l.user_id = p_user and l.remaining > 0 and (l.expires_at is null or l.expires_at > now())
      and (not p_production_only or l.environment = 'production')
    order by l.expires_at asc nulls last, l.id asc
    for update
  loop
    exit when v_need = 0;
    v_take := least(r.remaining, v_need);
    update ledger.coin_lots set remaining = remaining - v_take where id = r.id;
    insert into ledger.lot_consumptions (txn_id, lot_id, coins, net_eur_micros)
    values (p_txn, r.id, v_take, v_take * r.net_eur_micros_per_coin);
    v_need := v_need - v_take;
    lot_id := r.id;
    coins := v_take;
    value_micros_per_coin := r.net_eur_micros_per_coin;
    valuation_pending := r.pending;
    return next;
  end loop;
  if v_need > 0 then
    raise exception 'insufficient_coins' using errcode = 'P0001', detail = v_need::text;   -- coins short; passed to the client
  end if;
end;
$$;
revoke all on function app_private.spend_coins(uuid, integer, bigint, boolean) from public, anon, authenticated;

-- How many coins giving back p_orig_txn's consumptions would put back into lots, and how much would
-- cancel refund debt instead (coins from voided lots pay down debt first).
create function app_private.plan_restore(p_orig_txn bigint, p_user uuid, out returned integer, out to_debt integer)
language plpgsql stable
set search_path = ''
as $$
declare
  r record;
  v_debt integer := coalesce((select w.refund_debt from ledger.wallets w where w.user_id = p_user), 0);
  v_cancel integer;
begin
  returned := 0;
  to_debt := 0;
  for r in
    select c.lot_id, sum(c.coins)::integer as coins, l.voided_at
    from ledger.lot_consumptions c join ledger.coin_lots l on l.id = c.lot_id
    where c.txn_id = p_orig_txn
    group by c.lot_id, l.voided_at
    having sum(c.coins) > 0
    order by c.lot_id
  loop
    if r.voided_at is not null then
      v_cancel := least(r.coins, v_debt);
      v_debt := v_debt - v_cancel;
      to_debt := to_debt + v_cancel;
      returned := returned + (r.coins - v_cancel);
    else
      returned := returned + r.coins;
    end if;
  end loop;
end;
$$;
revoke all on function app_private.plan_restore(bigint, uuid) from public, anon, authenticated;

-- Give back the coins consumed by p_orig_txn, recorded under p_new_txn (whose coins_delta must equal
-- plan_restore's `returned`). Coins return to their lot with the same kind and value. An original lot
-- that has expired or expires within a day gets one fresh copy instead, extended by 7 days. A copy is
-- never extended again: coins go back into it with its own expiry, and if that has passed they come
-- back as an already-expired lot that expire_lots sweeps. Coins from a voided (refunded) lot cancel
-- refund debt first; the rest come back worthless.
create function app_private.restore_consumptions(p_orig_txn bigint, p_new_txn bigint) returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_lot bigint;
  v_total integer := 0;
  v_coins integer;
  v_cancel integer;
begin
  for r in
    select c.lot_id, sum(c.coins)::integer as coins, l.user_id, l.expires_at, l.net_eur_micros_per_coin,
           l.environment, l.source, l.voided_at, l.restored_from_lot, l.valuation_pending
    from ledger.lot_consumptions c
    join ledger.coin_lots l on l.id = c.lot_id
    where c.txn_id = p_orig_txn
    group by c.lot_id, l.user_id, l.expires_at, l.net_eur_micros_per_coin, l.environment, l.source, l.voided_at,
             l.restored_from_lot, l.valuation_pending
    having sum(c.coins) > 0
    order by c.lot_id
  loop
    v_coins := r.coins;
    if r.voided_at is not null then
      select least(v_coins, w.refund_debt) into v_cancel from ledger.wallets w where w.user_id = r.user_id;
      if v_cancel > 0 then
        update ledger.wallets set refund_debt = refund_debt - v_cancel, updated_at = now() where user_id = r.user_id;
        v_coins := v_coins - v_cancel;
      end if;
      -- the consumption ledger still records that these coins left the voided lot's spend
      insert into ledger.lot_consumptions (txn_id, lot_id, coins, net_eur_micros)
      values (p_new_txn, r.lot_id, -r.coins, 0);
      if v_coins > 0 then
        insert into ledger.coin_lots (user_id, source, initial, remaining, net_eur_micros_per_coin, expires_at,
                                      environment, restored_from_lot, txn_id)
        values (r.user_id, 'refund_return', v_coins, v_coins, 0, now() + interval '30 days', r.environment,
                coalesce(r.restored_from_lot, r.lot_id), p_new_txn);
        v_total := v_total + v_coins;
      end if;
      continue;
    end if;

    if r.expires_at is null or r.expires_at > now() + interval '1 day'
       or (r.restored_from_lot is not null and r.expires_at > now()) then
      update ledger.coin_lots set remaining = remaining + v_coins where id = r.lot_id;
      v_lot := r.lot_id;
    else
      -- An original lot near or past expiry: one copy, 7 days past its expiry (or now). A copy whose
      -- date has passed: an already-expired lot (its own lot, so the sweep records its own expiry).
      insert into ledger.coin_lots (user_id, source, initial, remaining, net_eur_micros_per_coin, expires_at,
                                    environment, valuation_pending, restored_from_lot, txn_id)
      values (r.user_id, r.source, v_coins, v_coins, r.net_eur_micros_per_coin,
              case when r.restored_from_lot is null then greatest(r.expires_at, now()) + interval '7 days'
                   else r.expires_at end,
              r.environment, r.valuation_pending, coalesce(r.restored_from_lot, r.lot_id), p_new_txn)
      returning id into v_lot;
    end if;
    insert into ledger.lot_consumptions (txn_id, lot_id, coins, net_eur_micros)
    values (p_new_txn, v_lot, -v_coins, -v_coins * r.net_eur_micros_per_coin);
    v_total := v_total + v_coins;
  end loop;
  return v_total;
end;
$$;
revoke all on function app_private.restore_consumptions(bigint, bigint) from public, anon, authenticated;

-- Reverse creator earnings that came from the given unlock and/or lot. Pending earnings are voided;
-- available or paid ones get a negative reversal row. Placeholder (pending-valuation) earnings are voided.
create function app_private.reverse_earnings(p_unlock_txn bigint, p_lot bigint) returns void
language plpgsql
set search_path = ''
as $$
declare
  e record;
begin
  for e in
    select * from public.earnings x
    where x.kind = 'earning' and x.status <> 'void'
      and (p_unlock_txn is null or x.unlock_txn_id = p_unlock_txn)
      and (p_lot is null or x.lot_id = p_lot)
      and not exists (select 1 from public.earnings r where r.reverses_id = x.id)
    order by x.id
    for update
  loop
    if e.status = 'pending' then
      update public.earnings set status = 'void' where id = e.id;
    else
      insert into public.earnings (creator_id, kind, is_reserve, episode_id, unlock_txn_id, lot_id, coins,
                                   amount_eur_micros, share_bps, reverses_id, status, available_at)
      values (e.creator_id, 'reversal', e.is_reserve, e.episode_id, e.unlock_txn_id, e.lot_id, -e.coins,
              -e.amount_eur_micros, e.share_bps, e.id, 'available', now());
    end if;
  end loop;
  update app_private.pending_earnings pe set voided_at = now()
  where pe.settled_at is null and pe.voided_at is null
    and (p_unlock_txn is null or pe.unlock_txn_id = p_unlock_txn)
    and (p_lot is null or pe.lot_id = p_lot);
end;
$$;
revoke all on function app_private.reverse_earnings(bigint, bigint) from public, anon, authenticated;

-- Write the two earnings rows (held part and 15% reserve) for one valued consumption.
create function app_private.write_earnings(p_creator uuid, p_episode uuid, p_txn bigint, p_lot bigint, p_coins integer,
                                           p_value_micros bigint, p_share integer, p_from timestamptz) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_amount bigint := (p_coins::bigint * p_value_micros * p_share) / 10000;
  v_reserve bigint := (v_amount * app_private.cfg_int('creator_reserve_bps', 1500)) / 10000;
begin
  if v_amount - v_reserve > 0 then
    insert into public.earnings (creator_id, kind, is_reserve, episode_id, unlock_txn_id, lot_id, coins,
                                 amount_eur_micros, share_bps, available_at)
    values (p_creator, 'earning', false, p_episode, p_txn, p_lot, p_coins, v_amount - v_reserve, p_share,
            p_from + make_interval(days => app_private.cfg_int('earnings_hold_days', 30)));
  end if;
  if v_reserve > 0 then
    insert into public.earnings (creator_id, kind, is_reserve, episode_id, unlock_txn_id, lot_id, coins,
                                 amount_eur_micros, share_bps, available_at)
    values (p_creator, 'earning', true, p_episode, p_txn, p_lot, 0, v_reserve, p_share,
            p_from + make_interval(days => app_private.cfg_int('reserve_hold_days', 90)));
  end if;
end;
$$;
revoke all on function app_private.write_earnings(uuid, uuid, bigint, bigint, integer, bigint, integer, timestamptz) from public, anon, authenticated;

-- The user's active VIP tier. Sandbox subscriptions count only for sandbox testers.
create function app_private.active_tier(p_user uuid) returns text
language sql stable
set search_path = ''
as $$
  select case when bool_or(s.tier = 'premium') then 'premium' when bool_or(s.tier = 'plus') then 'plus' end
  from public.subscriptions s
  where s.user_id = p_user and s.status = 'active' and s.period_end > now()
    and (s.environment = 'production' or app_private.is_sandbox_tester(p_user))
$$;
revoke all on function app_private.active_tier(uuid) from public, anon, authenticated;

-- Can this user unlock this episode, is it free, and what does it cost them? Unknown and invisible
-- episodes both report not_available (ids of hidden content can't be probed).
create function app_private.resolve_episode_price(p_episode uuid, p_user uuid)
returns table (purchasable boolean, is_own boolean, is_free boolean, base_price integer, discount_pct integer,
               price integer, reason text, creator_id uuid)
language plpgsql stable
set search_path = ''
as $$
declare
  e public.episodes;
  s public.series;
  v_creator_active boolean;
  v_tier text;
  v_disc integer := 0;
  v_base integer;
begin
  select * into e from public.episodes where id = p_episode;
  if not found then
    return query select false, false, false, 0, 0, 0, 'not_available'::text, null::uuid;
    return;
  end if;
  select * into s from public.series where id = e.series_id;

  if s.creator_id = p_user then
    return query select true, true, true, 0, 0, 0, 'own_episode'::text, s.creator_id;
    return;
  end if;

  if e.status <> 'published' or e.moderation_status <> 'approved'
     or s.status <> 'published' or s.moderation_status <> 'approved'
     or not app_private.is_live_adult(s.creator_id) then
    return query select false, false, false, 0, 0, 0, 'not_available'::text, s.creator_id;
    return;
  end if;
  if s.maturity = 'mature' and not coalesce((select pp.mature_opt_in from public.profile_private pp where pp.user_id = p_user), false) then
    return query select false, false, false, 0, 0, 0, 'mature_opt_in_required'::text, s.creator_id;
    return;
  end if;

  select exists (select 1 from public.creator_accounts ca where ca.user_id = s.creator_id and ca.status = 'active')
    into v_creator_active;

  if e.is_free or e.number <= s.free_episode_count
     or (s.format = 'ai_generated' and not s.editors_pick)
     or not v_creator_active then
    return query select true, false, true, 0, 0, 0, 'free'::text, s.creator_id;
    return;
  end if;

  v_base := coalesce(e.price_coins, s.default_price_coins,
                     case when coalesce(e.duration_s, 0) <= 60 then app_private.cfg_int('default_price_short', 25)
                          else app_private.cfg_int('default_price_long', 40) end);
  v_tier := app_private.active_tier(p_user);
  if v_tier = 'premium' then
    v_disc := app_private.cfg_int('premium_discount_pct', 20);
  elsif v_tier = 'plus' then
    v_disc := app_private.cfg_int('plus_discount_pct', 10);
  end if;
  v_disc := least(v_disc, app_private.cfg_int('max_discount_pct', 30));

  return query select true, false, false, v_base, v_disc, greatest(1, (v_base * (100 - v_disc)) / 100),
                      'priced'::text, s.creator_id;
end;
$$;
revoke all on function app_private.resolve_episode_price(uuid, uuid) from public, anon, authenticated;

-- AI stories need a live adult with a production purchase, an active production VIP, or code/allowlist
-- access. Sandbox purchases and sandbox subscriptions never count (TestFlight purchases are free).
create function app_private.has_ai_access(p_user uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select app_private.is_live_adult(p_user)
     and (
       exists (select 1 from ledger.purchases p where p.user_id = p_user and p.environment = 'production' and p.refunded_at is null)
       or exists (select 1 from public.subscriptions s where s.user_id = p_user and s.environment = 'production'
                  and s.status = 'active' and s.period_end > now())
       or exists (select 1 from public.profile_private pp where pp.user_id = p_user and pp.ai_access_until > now())
     )
$$;
revoke all on function app_private.has_ai_access(uuid) from public, anon, authenticated;

-- Dedupe a webhook event inside the caller's transaction. Returns false if already processed.
-- Because it is part of the same transaction as the ledger write, a failure rolls both back and the
-- provider's retry is processed again.
create function app_private.first_delivery(p_provider text, p_event_id text) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inserted text;
begin
  insert into app_private.webhook_events (provider, event_id) values (p_provider, p_event_id)
  on conflict do nothing
  returning event_id into v_inserted;
  return v_inserted is not null;
end;
$$;
revoke all on function app_private.first_delivery(text, text) from public, anon, authenticated;

-- The core of a coin-pack refund, shared by svc.apply_refund and the out-of-order path in
-- svc.credit_purchase. Caller has locked the purchase row.
create function app_private.refund_purchase(p_store text, p_store_transaction_id text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  p ledger.purchases;
  l ledger.coin_lots;
  v_unspent integer := 0;
  v_spent integer := 0;
  v_debt_add integer := 0;
  c record;
begin
  select * into p from ledger.purchases x where x.store = p_store and x.store_transaction_id = p_store_transaction_id for update;
  if p.refunded_at is not null then
    return jsonb_build_object('status', 'already_refunded');
  end if;
  perform app_private.lock_wallet(p.user_id);
  if p.lot_id is not null then
    select * into l from ledger.coin_lots where id = p.lot_id for update;
    v_unspent := l.remaining;
    v_spent := l.initial - l.remaining;
    update ledger.coin_lots set remaining = 0, voided_at = now() where id = l.id;
    for c in select distinct x.txn_id from ledger.lot_consumptions x where x.lot_id = l.id and x.coins > 0 order by x.txn_id loop
      perform app_private.reverse_earnings(c.txn_id, l.id);
    end loop;
  end if;
  if p.environment = 'production' then
    -- Spent coins, and any refund debt this purchase had paid off, become debt again.
    v_debt_add := v_spent + p.repaid_debt;
    if v_debt_add > 0 then
      update ledger.wallets set refund_debt = refund_debt + v_debt_add, updated_at = now() where user_id = p.user_id;
    end if;
  end if;
  perform app_private.new_txn('refund:' || p_store || ':' || p_store_transaction_id, p.user_id, 'refund', -v_unspent,
                              jsonb_build_object('store_transaction_id', p_store_transaction_id, 'spent', v_spent,
                                                 'repaid_debt', p.repaid_debt),
                              p.environment);
  update ledger.purchases set refunded_at = now() where store = p_store and store_transaction_id = p_store_transaction_id;
  return jsonb_build_object('status', 'refunded', 'removed', v_unspent, 'debt_added', v_debt_add);
end;
$$;
revoke all on function app_private.refund_purchase(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- User RPCs

create function public.get_my_wallet() returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_adult();
begin
  return jsonb_build_object(
    'balance', app_private.balance(v_uid),
    'paid', coalesce((select sum(l.remaining) from ledger.coin_lots l
                      where l.user_id = v_uid and l.remaining > 0 and l.expires_at is null), 0),
    'bonus', coalesce((select sum(l.remaining) from ledger.coin_lots l
                       where l.user_id = v_uid and l.remaining > 0 and l.expires_at > now()), 0),
    'refund_debt', coalesce((select w.refund_debt from ledger.wallets w where w.user_id = v_uid), 0),
    'expiring', coalesce((
      select jsonb_agg(jsonb_build_object('coins', l.remaining, 'expires_at', l.expires_at, 'source', l.source)
                       order by l.expires_at)
      from ledger.coin_lots l
      where l.user_id = v_uid and l.remaining > 0 and l.expires_at > now()), '[]'::jsonb),
    'free_passes_left', greatest(0,
      app_private.cfg_int('free_passes_per_day', 1)
      + case when app_private.active_tier(v_uid) is not null then app_private.cfg_int('free_passes_plus_bonus', 1) else 0 end
      - coalesce((select d.used from public.daily_passes d
                  where d.user_id = v_uid and d.utc_day = (now() at time zone 'utc')::date), 0))
  );
end;
$$;
revoke all on function public.get_my_wallet() from public, anon, authenticated;
grant execute on function public.get_my_wallet() to authenticated;

-- What the unlock sheet shows.
create function public.get_episode_price(p_episode uuid) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_adult();
  r record;
begin
  select * into r from app_private.resolve_episode_price(p_episode, v_uid);
  return jsonb_build_object(
    'purchasable', r.purchasable, 'free', r.is_free, 'own', r.is_own,
    'base_price', r.base_price, 'discount_pct', r.discount_pct, 'price', r.price, 'reason', r.reason,
    'unlocked', exists (select 1 from public.episode_unlocks u where u.user_id = v_uid and u.episode_id = p_episode));
end;
$$;
revoke all on function public.get_episode_price(uuid) from public, anon, authenticated;
grant execute on function public.get_episode_price(uuid) to authenticated;

-- Unlock with coins. p_expected_price is what the sheet showed; a different price raises price_changed
-- instead of charging something the user didn't see. The episode row is share-locked first, so a
-- concurrent removal either sees this unlock (and re-credits it) or this unlock sees 'removed'.
create function public.unlock_episode(p_episode uuid, p_expected_price integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_adult();
  v_debt integer;
  r record;
  c record;
  v_txn bigint;
  v_share integer;
begin
  perform 1 from public.episodes e where e.id = p_episode for share;
  v_debt := app_private.lock_wallet(v_uid);

  if exists (select 1 from public.episode_unlocks u where u.user_id = v_uid and u.episode_id = p_episode) then
    return jsonb_build_object('status', 'already_unlocked', 'balance', app_private.balance(v_uid));
  end if;

  select * into r from app_private.resolve_episode_price(p_episode, v_uid);
  if not r.purchasable then
    raise exception '%', r.reason using errcode = '22023';
  end if;
  if r.is_own then
    insert into public.episode_unlocks (user_id, episode_id, source) values (v_uid, p_episode, 'creator');
    return jsonb_build_object('status', 'unlocked', 'coins_spent', 0, 'balance', app_private.balance(v_uid));
  end if;
  if r.is_free then
    return jsonb_build_object('status', 'free', 'balance', app_private.balance(v_uid));
  end if;
  if p_expected_price is distinct from r.price then
    raise exception 'price_changed' using errcode = '22023', detail = r.price::text;
  end if;
  if v_debt > 0 then
    raise exception 'refund_debt_outstanding' using errcode = '22023', detail = v_debt::text;
  end if;

  v_txn := app_private.new_txn('unlock:' || v_uid || ':' || p_episode, v_uid, 'unlock', -r.price,
                               jsonb_build_object('episode_id', p_episode), 'production');
  if v_txn is null then
    return jsonb_build_object('status', 'already_unlocked', 'balance', app_private.balance(v_uid));
  end if;

  select ca.share_bps into v_share from public.creator_accounts ca
  where ca.user_id = r.creator_id and ca.status = 'active';

  for c in select * from app_private.spend_coins(v_uid, r.price, v_txn, not app_private.is_sandbox_tester(v_uid)) loop
    if v_share is null or r.creator_id is null or r.creator_id = v_uid then
      continue;
    end if;
    if c.valuation_pending then
      insert into app_private.pending_earnings (creator_id, episode_id, unlock_txn_id, lot_id, coins, share_bps)
      values (r.creator_id, p_episode, v_txn, c.lot_id, c.coins, v_share);
    elsif c.value_micros_per_coin > 0 then
      perform app_private.write_earnings(r.creator_id, p_episode, v_txn, c.lot_id, c.coins, c.value_micros_per_coin,
                                         v_share, now());
    end if;
  end loop;

  insert into public.episode_unlocks (user_id, episode_id, source, coins_spent, txn_id)
  values (v_uid, p_episode, 'coins', r.price, v_txn);

  return jsonb_build_object('status', 'unlocked', 'coins_spent', r.price, 'balance', app_private.balance(v_uid));
end;
$$;
revoke all on function public.unlock_episode(uuid, integer) from public, anon, authenticated;
grant execute on function public.unlock_episode(uuid, integer) to authenticated;

-- Unlock with today's Free Pass (one a day, two with VIP). Free Pass unlocks earn creators nothing.
create function public.use_free_pass(p_episode uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_adult();
  r record;
  v_day date := (now() at time zone 'utc')::date;
  v_allow integer;
  v_used integer;
begin
  perform 1 from public.episodes e where e.id = p_episode for share;
  perform app_private.lock_wallet(v_uid);
  if exists (select 1 from public.episode_unlocks u where u.user_id = v_uid and u.episode_id = p_episode) then
    return jsonb_build_object('status', 'already_unlocked');
  end if;
  select * into r from app_private.resolve_episode_price(p_episode, v_uid);
  if not r.purchasable then
    raise exception '%', r.reason using errcode = '22023';
  end if;
  if r.is_free or r.is_own then
    return jsonb_build_object('status', 'free');
  end if;

  v_allow := app_private.cfg_int('free_passes_per_day', 1)
             + case when app_private.active_tier(v_uid) is not null then app_private.cfg_int('free_passes_plus_bonus', 1) else 0 end;
  insert into public.daily_passes (user_id, utc_day, used) values (v_uid, v_day, 0)
  on conflict (user_id, utc_day) do nothing;
  select d.used into v_used from public.daily_passes d where d.user_id = v_uid and d.utc_day = v_day for update;
  if v_used >= v_allow then
    raise exception 'no_free_pass_left' using errcode = '22023';
  end if;
  update public.daily_passes set used = used + 1 where user_id = v_uid and utc_day = v_day;
  insert into public.episode_unlocks (user_id, episode_id, source) values (v_uid, p_episode, 'free_pass');
  return jsonb_build_object('status', 'unlocked', 'free_passes_left', v_allow - v_used - 1);
end;
$$;
revoke all on function public.use_free_pass(uuid) from public, anon, authenticated;
grant execute on function public.use_free_pass(uuid) to authenticated;

create function public.has_ai_access() returns boolean
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  return app_private.has_ai_access(app_private.require_adult());
end;
$$;
revoke all on function public.has_ai_access() from public, anon, authenticated;
grant execute on function public.has_ai_access() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Service RPCs (Worker: RevenueCat webhooks, codes, cron, AI holds, playback)

-- A consumable coin pack was bought (RevenueCat NON_RENEWING_PURCHASE). p_net_eur_micros is what
-- Euragnos receives after store commission and tax, converted to EUR; null if not known yet.
create function svc.credit_purchase(
  p_user uuid,
  p_event_id text,
  p_store text,
  p_store_transaction_id text,
  p_product_id text,
  p_environment text,
  p_net_eur_micros bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coins integer;
  v_credit integer;
  v_debt integer;
  v_repay integer := 0;
  v_txn bigint;
  v_lot bigint;
  v_value bigint := 0;
  v_sandbox boolean := (p_environment = 'sandbox');
  v_gets_coins boolean;
  v_refund jsonb;
begin
  perform svc.require_service_role();
  if p_environment not in ('production', 'sandbox') or p_store not in ('app_store', 'play_store', 'web') then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  if not app_private.first_delivery('revenuecat', p_event_id) then
    return jsonb_build_object('status', 'duplicate_event');
  end if;
  select p.coins into v_coins from public.products p where p.product_id = p_product_id and p.kind = 'coin_pack';
  if v_coins is null then
    raise exception 'unknown_product' using errcode = '22023', detail = p_product_id;
  end if;
  -- Serialise deliveries of the same store transaction (two events can carry one purchase).
  perform pg_advisory_xact_lock(hashtext('purchase:' || p_store || ':' || p_store_transaction_id));
  if exists (select 1 from ledger.purchases x where x.store = p_store and x.store_transaction_id = p_store_transaction_id) then
    return jsonb_build_object('status', 'duplicate_purchase');
  end if;

  v_debt := app_private.lock_wallet(p_user);
  v_gets_coins := not v_sandbox or app_private.is_sandbox_tester(p_user);
  v_credit := case when v_gets_coins then v_coins else 0 end;
  if not v_sandbox and v_debt > 0 then
    v_repay := least(v_debt, v_coins);
    v_credit := v_coins - v_repay;
    update ledger.wallets set refund_debt = refund_debt - v_repay, updated_at = now() where user_id = p_user;
  end if;
  if not v_sandbox and p_net_eur_micros is not null and p_net_eur_micros > 0 then
    v_value := p_net_eur_micros / v_coins;
  end if;

  v_txn := app_private.new_txn('rcpurchase:' || p_store || ':' || p_store_transaction_id, p_user, 'purchase',
                               v_credit,
                               jsonb_build_object('product_id', p_product_id, 'repaid_debt', v_repay,
                                                  'sandbox_ignored', v_sandbox and not v_gets_coins),
                               p_environment);
  if v_credit > 0 then
    insert into ledger.coin_lots (user_id, source, initial, remaining, net_eur_micros_per_coin, expires_at,
                                  environment, valuation_pending, txn_id)
    values (p_user, case when v_sandbox then 'sandbox' else 'iap' end, v_credit, v_credit, v_value,
            case when v_sandbox then now() + make_interval(days => app_private.cfg_int('sandbox_coin_days', 30)) end,
            p_environment, (not v_sandbox and p_net_eur_micros is null), v_txn)
    returning id into v_lot;
  end if;

  insert into ledger.purchases (store, store_transaction_id, user_id, product_id, coins, environment, net_eur_micros,
                                repaid_debt, lot_id, txn_id)
  values (p_store, p_store_transaction_id, p_user, p_product_id, v_coins, p_environment, p_net_eur_micros,
          v_repay, v_lot, v_txn);

  -- A refund for this purchase arrived first: apply it now.
  if exists (select 1 from app_private.pending_refunds r where r.store = p_store and r.store_transaction_id = p_store_transaction_id) then
    v_refund := app_private.refund_purchase(p_store, p_store_transaction_id);
    delete from app_private.pending_refunds where store = p_store and store_transaction_id = p_store_transaction_id;
    return jsonb_build_object('status', 'credited_and_refunded', 'refund', v_refund);
  end if;

  return jsonb_build_object('status', case when v_gets_coins then 'credited' else 'sandbox_ignored' end,
                            'coins', v_credit, 'repaid_debt', v_repay, 'balance', app_private.balance(p_user));
end;
$$;
revoke all on function svc.credit_purchase(uuid, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function svc.credit_purchase(uuid, text, text, text, text, text, bigint) to service_role;

-- A coin-pack purchase was refunded by the store (RevenueCat CANCELLATION with
-- cancel_reason = CUSTOMER_SUPPORT and a negative price; a plain CANCELLATION is not a refund).
create function svc.apply_refund(p_event_id text, p_store text, p_store_transaction_id text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  if not app_private.first_delivery('revenuecat', p_event_id) then
    return jsonb_build_object('status', 'duplicate_event');
  end if;
  perform pg_advisory_xact_lock(hashtext('purchase:' || p_store || ':' || p_store_transaction_id));
  if not exists (select 1 from ledger.purchases x where x.store = p_store and x.store_transaction_id = p_store_transaction_id) then
    insert into app_private.pending_refunds (store, store_transaction_id, event_id)
    values (p_store, p_store_transaction_id, p_event_id)
    on conflict do nothing;
    return jsonb_build_object('status', 'refund_pending');
  end if;
  return app_private.refund_purchase(p_store, p_store_transaction_id);
end;
$$;
revoke all on function svc.apply_refund(text, text, text) from public, anon, authenticated;
grant execute on function svc.apply_refund(text, text, text) to service_role;

-- Subscription state from a RevenueCat event. Out-of-order events are ignored inside the upsert itself,
-- so two concurrent first deliveries can't let an older one win.
create function svc.upsert_subscription(
  p_user uuid,
  p_original_txn text,
  p_store text,
  p_product_id text,
  p_period_type text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_auto_renew boolean,
  p_environment text,
  p_event_at timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_written text;
begin
  perform svc.require_service_role();
  select p.tier into v_tier from public.products p where p.product_id = p_product_id and p.kind = 'subscription';
  if v_tier is null then
    raise exception 'unknown_product' using errcode = '22023', detail = p_product_id;
  end if;
  insert into public.subscriptions (store_original_transaction_id, user_id, store, product_id, tier, period_type, status,
                                    period_start, period_end, auto_renew, environment, last_event_at, updated_at)
  values (p_original_txn, p_user, p_store, p_product_id, v_tier, p_period_type, p_status, p_period_start, p_period_end,
          p_auto_renew, p_environment, p_event_at, now())
  on conflict (store_original_transaction_id) do update
    set user_id = excluded.user_id, product_id = excluded.product_id, tier = excluded.tier,
        period_type = excluded.period_type, status = excluded.status, period_start = excluded.period_start,
        period_end = excluded.period_end, auto_renew = excluded.auto_renew, environment = excluded.environment,
        last_event_at = excluded.last_event_at, updated_at = now()
    where public.subscriptions.last_event_at < excluded.last_event_at
  returning store_original_transaction_id into v_written;
  return case when v_written is null then 'stale_event_ignored' else 'applied' end;
end;
$$;
revoke all on function svc.upsert_subscription(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function svc.upsert_subscription(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, text, timestamptz) to service_role;

-- The idempotency key of one subscription period's coin grant.
create function app_private.sub_grant_key(p_original_txn text, p_period_start timestamptz, p_grant_no integer) returns text
language sql immutable
set search_path = ''
as $$
  select 'grant:' || p_original_txn || ':' || to_char(p_period_start at time zone 'utc', 'YYYYMMDDHH24MISS') || ':' || p_grant_no
$$;
revoke all on function app_private.sub_grant_key(text, timestamptz, integer) from public, anon, authenticated;

create function app_private.sub_refund_key(p_original_txn text, p_period_start timestamptz) returns text
language sql immutable
set search_path = ''
as $$
  select 'subrefund:' || p_original_txn || ':' || to_char(p_period_start at time zone 'utc', 'YYYYMMDDHH24MISS')
$$;
revoke all on function app_private.sub_refund_key(text, timestamptz) from public, anon, authenticated;

-- VIP coins for one grant period. Idempotent per (subscription, period start, grant number). Trial
-- grants are worth nothing. Sandbox grants go only to sandbox testers.
create function svc.grant_sub_coins(
  p_user uuid,
  p_original_txn text,
  p_period_start timestamptz,
  p_grant_no integer,
  p_coins integer,
  p_expires_at timestamptz,
  p_net_eur_micros_total bigint,
  p_environment text,
  p_is_trial boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn bigint;
  v_value bigint := 0;
begin
  perform svc.require_service_role();
  if p_coins is null or p_coins <= 0 or p_expires_at is null or p_expires_at <= now() or p_grant_no is null or p_grant_no < 0 then
    raise exception 'invalid_grant' using errcode = '22023';
  end if;
  if p_environment = 'sandbox' and not app_private.is_sandbox_tester(p_user) then
    return jsonb_build_object('status', 'sandbox_ignored');
  end if;
  perform app_private.lock_wallet(p_user);
  -- A refund can arrive before the grant (webhooks are retried and unordered): never grant it then.
  if exists (select 1 from ledger.transactions t where t.idempotency_key = app_private.sub_refund_key(p_original_txn, p_period_start)) then
    return jsonb_build_object('status', 'period_refunded');
  end if;
  v_txn := app_private.new_txn(app_private.sub_grant_key(p_original_txn, p_period_start, p_grant_no),
                               p_user, 'grant', p_coins,
                               jsonb_build_object('original_txn', p_original_txn, 'trial', p_is_trial), p_environment);
  if v_txn is null then
    return jsonb_build_object('status', 'duplicate');
  end if;
  if p_environment = 'production' and not p_is_trial and p_net_eur_micros_total is not null and p_net_eur_micros_total > 0 then
    v_value := p_net_eur_micros_total / p_coins;
  end if;
  insert into ledger.coin_lots (user_id, source, initial, remaining, net_eur_micros_per_coin, expires_at, environment,
                                valuation_pending, txn_id)
  values (p_user, case when p_is_trial then 'trial' else 'sub_grant' end, p_coins, p_coins, v_value, p_expires_at,
          p_environment, (p_environment = 'production' and not p_is_trial and p_net_eur_micros_total is null), v_txn);
  return jsonb_build_object('status', 'granted', 'coins', p_coins);
end;
$$;
revoke all on function svc.grant_sub_coins(uuid, text, timestamptz, integer, integer, timestamptz, bigint, text, boolean) from public, anon, authenticated;
grant execute on function svc.grant_sub_coins(uuid, text, timestamptz, integer, integer, timestamptz, bigint, text, boolean) to service_role;

-- A subscription period was refunded: its unspent coins (including coins later returned from them)
-- are removed, coins actually spent become refund debt (paid periods only; expired or returned coins
-- are not debt), earnings from them are reversed. Once per period, whatever the event id.
create function svc.refund_subscription_period(p_event_id text, p_user uuid, p_original_txn text, p_period_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Every grant of the period (any grant number) has this key prefix.
  v_prefix text := 'grant:' || p_original_txn || ':' || to_char(p_period_start at time zone 'utc', 'YYYYMMDDHH24MISS') || ':';
  l record;
  v_removed integer := 0;
  v_debt integer := 0;
  c record;
begin
  perform svc.require_service_role();
  if not app_private.first_delivery('revenuecat', p_event_id) then
    return jsonb_build_object('status', 'duplicate_event');
  end if;
  perform app_private.lock_wallet(p_user);
  if exists (select 1 from ledger.transactions t where t.idempotency_key = app_private.sub_refund_key(p_original_txn, p_period_start)) then
    return jsonb_build_object('status', 'already_refunded');
  end if;
  for l in
    with grants as (
      select t.id from ledger.transactions t
      where t.user_id = p_user and t.type = 'grant' and starts_with(t.idempotency_key, v_prefix)
    ), grant_lots as (
      select x.id from ledger.coin_lots x where x.txn_id in (select id from grants)
    )
    select x.* from ledger.coin_lots x
    where x.user_id = p_user and x.voided_at is null and x.source <> 'refund_return'
      and (x.id in (select id from grant_lots) or x.restored_from_lot in (select id from grant_lots))
    order by x.id
    for update
  loop
    v_removed := v_removed + l.remaining;
    -- Net consumption of the lot (spends minus returns into it) is what was really spent; summed over
    -- a lot and its returned copies it never counts coins that came back or expired unspent.
    if l.environment = 'production' and l.source = 'sub_grant' then
      v_debt := v_debt + coalesce((select sum(lc.coins) from ledger.lot_consumptions lc where lc.lot_id = l.id), 0)::integer;
    end if;
    update ledger.coin_lots set remaining = 0, voided_at = now() where id = l.id;
    for c in select distinct x.txn_id from ledger.lot_consumptions x where x.lot_id = l.id and x.coins > 0 order by x.txn_id loop
      perform app_private.reverse_earnings(c.txn_id, l.id);
    end loop;
  end loop;
  v_debt := greatest(v_debt, 0);
  if v_debt > 0 then
    update ledger.wallets set refund_debt = refund_debt + v_debt, updated_at = now() where user_id = p_user;
  end if;
  perform app_private.new_txn(app_private.sub_refund_key(p_original_txn, p_period_start),
                              p_user, 'refund', -v_removed, jsonb_build_object('original_txn', p_original_txn), 'production');
  return jsonb_build_object('status', 'refunded', 'removed', v_removed, 'debt_added', v_debt);
end;
$$;
revoke all on function svc.refund_subscription_period(text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function svc.refund_subscription_period(text, uuid, text, timestamptz) to service_role;

-- Promotional coins (worth nothing to creators). The key is scoped to the user. Expiry, if any, must
-- leave at least a day to use them.
create function svc.grant_promo(p_user uuid, p_key text, p_coins integer, p_expires_at timestamptz, p_source text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn bigint;
begin
  perform svc.require_service_role();
  if p_source not in ('promo', 'code', 'admin') or p_coins is null or p_coins <= 0
     or (p_expires_at is not null and p_expires_at <= now() + interval '1 day') then
    raise exception 'invalid_grant' using errcode = '22023';
  end if;
  perform app_private.lock_wallet(p_user);
  v_txn := app_private.new_txn('promo:' || p_user || ':' || p_key, p_user, 'grant', p_coins, jsonb_build_object('note', p_note), 'production');
  if v_txn is null then
    return jsonb_build_object('status', 'duplicate');
  end if;
  insert into ledger.coin_lots (user_id, source, initial, remaining, net_eur_micros_per_coin, expires_at, txn_id)
  values (p_user, p_source, p_coins, p_coins, 0, p_expires_at, v_txn);
  return jsonb_build_object('status', 'granted', 'coins', p_coins);
end;
$$;
revoke all on function svc.grant_promo(uuid, text, integer, timestamptz, text, text) from public, anon, authenticated;
grant execute on function svc.grant_promo(uuid, text, integer, timestamptz, text, text) to service_role;

-- Event/judge access code, redeemed on the web only (the Worker route checks that; native apps never
-- offer redemption, Apple 3.1.1).
create function svc.redeem_access_code(p_user uuid, p_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app_private.access_codes;
begin
  perform svc.require_service_role();
  if not app_private.is_live_adult(p_user) then
    raise exception 'not_adult' using errcode = '42501';
  end if;
  select * into c from app_private.access_codes x where x.code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or not c.active or c.valid_until <= now()
     or (c.coins > 0 and c.coins_expire_at <= now() + interval '1 day') then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  if exists (select 1 from app_private.code_redemptions r where r.code = c.code and r.user_id = p_user) then
    return jsonb_build_object('status', 'already_redeemed');
  end if;
  if c.redemptions >= c.max_redemptions then
    raise exception 'code_used_up' using errcode = '22023';
  end if;
  update app_private.access_codes set redemptions = redemptions + 1 where code = c.code;
  insert into app_private.code_redemptions (code, user_id) values (c.code, p_user);
  if c.coins > 0 then
    perform svc.grant_promo(p_user, 'code:' || c.code, c.coins, c.coins_expire_at, 'code', 'access code');
  end if;
  if c.ai_days > 0 then
    update public.profile_private
    set ai_access_until = greatest(coalesce(ai_access_until, now()), now()) + make_interval(days => c.ai_days)
    where user_id = p_user;
  end if;
  return jsonb_build_object('status', 'redeemed', 'coins', c.coins, 'coins_expire_at', c.coins_expire_at, 'ai_days', c.ai_days);
end;
$$;
revoke all on function svc.redeem_access_code(uuid, text) from public, anon, authenticated;
grant execute on function svc.redeem_access_code(uuid, text) to service_role;

-- Hold coins for an AI job before any model is called. Idempotent per (user, key): a retry with the
-- same key, user and amount returns the same hold; anything else conflicts. The caller must not run
-- models when `settled` is true.
create function svc.ai_hold(p_user uuid, p_key text, p_coins integer, p_ref jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt integer;
  v_key text := 'aihold:' || p_user || ':' || p_key;
  h ledger.transactions;
  v_txn bigint;
begin
  perform svc.require_service_role();
  if p_coins is null or p_coins <= 0 or p_key is null or length(p_key) > 200 then
    raise exception 'invalid_hold' using errcode = '22023';
  end if;
  if not app_private.has_ai_access(p_user) then
    raise exception 'ai_access_required' using errcode = '42501';
  end if;
  v_debt := app_private.lock_wallet(p_user);
  select * into h from ledger.transactions t where t.idempotency_key = v_key;
  if found then
    if h.user_id <> p_user or h.coins_delta <> -p_coins then
      raise exception 'idempotency_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('hold_txn', h.id,
      'settled', exists (select 1 from ledger.transactions t where t.idempotency_key = 'aisettle:' || h.id));
  end if;
  if v_debt > 0 then
    raise exception 'refund_debt_outstanding' using errcode = '22023';
  end if;
  v_txn := app_private.new_txn(v_key, p_user, 'ai_hold', -p_coins, coalesce(p_ref, '{}'::jsonb), 'production');
  perform app_private.spend_coins(p_user, p_coins, v_txn, not app_private.is_sandbox_tester(p_user));
  return jsonb_build_object('hold_txn', v_txn, 'settled', false);
end;
$$;
revoke all on function svc.ai_hold(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function svc.ai_hold(uuid, text, integer, jsonb) to service_role;

-- Settle a hold exactly once: capture (the scene was delivered) or release (it failed; coins go back).
create function svc.ai_settle(p_user uuid, p_hold_txn bigint, p_capture boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h ledger.transactions;
  v_txn bigint;
  v_back integer := 0;
  v_plan record;
begin
  perform svc.require_service_role();
  if p_capture is null then
    raise exception 'invalid_capture' using errcode = '22023';
  end if;
  select * into h from ledger.transactions t where t.id = p_hold_txn and t.type = 'ai_hold';
  if not found or h.user_id <> p_user then
    raise exception 'hold_not_found' using errcode = 'P0002';
  end if;
  perform app_private.lock_wallet(h.user_id);
  if exists (select 1 from ledger.transactions t where t.idempotency_key = 'aisettle:' || p_hold_txn) then
    return jsonb_build_object('status', 'already_settled');
  end if;
  if p_capture then
    perform app_private.new_txn('aisettle:' || p_hold_txn, h.user_id, 'ai_capture', 0,
                                jsonb_build_object('hold_txn', p_hold_txn), h.environment);
    return jsonb_build_object('status', 'captured', 'returned', 0);
  end if;
  select * into v_plan from app_private.plan_restore(p_hold_txn, h.user_id);
  v_txn := app_private.new_txn('aisettle:' || p_hold_txn, h.user_id, 'ai_release', v_plan.returned,
                               jsonb_build_object('hold_txn', p_hold_txn, 'debt_cancelled', v_plan.to_debt), h.environment);
  v_back := app_private.restore_consumptions(p_hold_txn, v_txn);
  return jsonb_build_object('status', 'released', 'returned', v_back);
end;
$$;
revoke all on function svc.ai_settle(uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function svc.ai_settle(uuid, bigint, boolean) to service_role;

-- An episode was removed (moderation, copyright) or its creator deleted their account: every buyer
-- gets the coins back as the kind they spent, and the creator's earnings from it are reversed.
-- The episode is marked removed first, so concurrent unlocks (which share-lock the episode) are either
-- already visible here or will see 'removed'.
-- Remove an episode for good and give its coin buyers their coins back. Works in pages of p_limit
-- buyers so a popular episode doesn't lock every buyer's wallet in one transaction: call it until it
-- returns 0 (each buyer is re-credited once, whatever the number of calls).
create function svc.recredit_episode(p_episode uuid, p_reason text, p_limit integer default 200) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
  v_txn bigint;
  v_plan record;
  v_count integer := 0;
begin
  perform svc.require_service_role();
  update public.episodes set status = 'removed' where id = p_episode and status <> 'removed';
  for u in
    select x.user_id, x.txn_id from public.episode_unlocks x
    where x.episode_id = p_episode and x.source = 'coins' and x.txn_id is not null
      and not exists (select 1 from ledger.transactions t where t.idempotency_key = 'recredit:' || x.txn_id)
    order by x.user_id
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  loop
    perform app_private.lock_wallet(u.user_id);
    select * into v_plan from app_private.plan_restore(u.txn_id, u.user_id);
    v_txn := app_private.new_txn('recredit:' || u.txn_id, u.user_id, 'recredit', v_plan.returned,
                                 jsonb_build_object('episode_id', p_episode, 'reason', p_reason, 'debt_cancelled', v_plan.to_debt),
                                 'production');
    if v_txn is not null then
      perform app_private.restore_consumptions(u.txn_id, v_txn);
      perform app_private.reverse_earnings(u.txn_id, null);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function svc.recredit_episode(uuid, text, integer) from public, anon, authenticated;
grant execute on function svc.recredit_episode(uuid, text, integer) to service_role;

-- The value of a pending-valuation lot became known (FX job): record it and turn the placeholder
-- earnings for coins already spent from it into real earnings, on their original schedule.
create function svc.value_lot(p_lot bigint, p_micros_per_coin bigint) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  l ledger.coin_lots;
  pe record;
  v_net integer;
  v_count integer := 0;
begin
  perform svc.require_service_role();
  if p_micros_per_coin is null or p_micros_per_coin < 0 then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select * into l from ledger.coin_lots where id = p_lot;
  if not found or not l.valuation_pending or l.environment <> 'production' then
    raise exception 'lot_not_pending' using errcode = '22023';
  end if;
  perform app_private.lock_wallet(l.user_id);
  update ledger.coin_lots set net_eur_micros_per_coin = p_micros_per_coin, valuation_pending = false where id = p_lot;
  -- Returned copies of this lot carry the same value.
  update ledger.coin_lots set net_eur_micros_per_coin = p_micros_per_coin, valuation_pending = false
  where restored_from_lot = p_lot and valuation_pending;
  -- Placeholders for spends from this lot or from its returned copies.
  for pe in
    select * from app_private.pending_earnings x
    where (x.lot_id = p_lot or x.lot_id in (select c.id from ledger.coin_lots c where c.restored_from_lot = p_lot))
      and x.settled_at is null and x.voided_at is null
    order by x.id
    for update
  loop
    -- Coins of this unlock that are still spent from that lot (not returned since).
    select coalesce(sum(c.coins), 0)::integer into v_net from ledger.lot_consumptions c
    where c.lot_id = pe.lot_id and c.txn_id = pe.unlock_txn_id;
    if v_net > 0 and p_micros_per_coin > 0 then
      perform app_private.write_earnings(pe.creator_id, pe.episode_id, pe.unlock_txn_id, pe.lot_id, least(v_net, pe.coins),
                                         p_micros_per_coin, pe.share_bps, pe.created_at);
      v_count := v_count + 1;
    end if;
    update app_private.pending_earnings set settled_at = now() where id = pe.id;
  end loop;
  return v_count;
end;
$$;
revoke all on function svc.value_lot(bigint, bigint) from public, anon, authenticated;
grant execute on function svc.value_lot(bigint, bigint) to service_role;

-- Cron: expire lots past their date, a bounded batch per call, one user at a time in user order.
-- Wallets busy right now are skipped and picked up next run.
create function svc.expire_lots(p_limit integer default 500) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
  l record;
  v_count integer := 0;
begin
  perform svc.require_service_role();
  for u in
    select x.user_id from ledger.coin_lots x
    where x.remaining > 0 and x.expires_at <= now()
    group by x.user_id order by x.user_id
    limit greatest(1, least(p_limit, 5000))
  loop
    insert into ledger.wallets (user_id) values (u.user_id) on conflict (user_id) do nothing;
    perform 1 from ledger.wallets w where w.user_id = u.user_id for update skip locked;
    if not found then
      continue;
    end if;
    for l in select x.id, x.remaining, x.environment from ledger.coin_lots x
             where x.user_id = u.user_id and x.remaining > 0 and x.expires_at <= now() order by x.id for update loop
      update ledger.coin_lots set remaining = 0 where id = l.id;
      perform app_private.new_txn('expire:' || l.id, u.user_id, 'expire', -l.remaining,
                                  jsonb_build_object('lot_id', l.id), l.environment);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke all on function svc.expire_lots(integer) from public, anon, authenticated;
grant execute on function svc.expire_lots(integer) to service_role;

-- Cron: pending earnings whose hold has passed become available, in bounded, ordered batches.
create function svc.release_earnings(p_limit integer default 5000) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform svc.require_service_role();
  update public.earnings set status = 'available'
  where id in (
    select x.id from public.earnings x
    where x.status = 'pending' and x.kind = 'earning' and x.available_at <= now()
    order by x.id
    limit greatest(1, least(p_limit, 50000))
    for update skip locked
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function svc.release_earnings(integer) from public, anon, authenticated;
grant execute on function svc.release_earnings(integer) to service_role;

-- Creator programme status (after the creator accepts the Creator Terms in the studio).
create function svc.set_creator_status(p_user uuid, p_status text, p_agreement_version text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  if p_status not in ('applied', 'active', 'suspended', 'ended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status = 'active' and not app_private.is_live_adult(p_user) then
    raise exception 'not_adult' using errcode = '42501';
  end if;
  insert into public.creator_accounts (user_id, status, agreement_version, accepted_at)
  values (p_user, p_status, p_agreement_version, case when p_agreement_version is not null then now() end)
  on conflict (user_id) do update
    set status = excluded.status,
        agreement_version = coalesce(excluded.agreement_version, public.creator_accounts.agreement_version),
        accepted_at = coalesce(excluded.accepted_at, public.creator_accounts.accepted_at);
end;
$$;
revoke all on function svc.set_creator_status(uuid, text, text) from public, anon, authenticated;
grant execute on function svc.set_creator_status(uuid, text, text) to service_role;

-- Sandbox tester allowlist (App Review and demo accounts).
create function svc.set_sandbox_tester(p_user uuid, p_on boolean, p_note text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  if p_on then
    insert into app_private.sandbox_testers (user_id, note) values (p_user, p_note)
    on conflict (user_id) do update set note = excluded.note;
  else
    delete from app_private.sandbox_testers where user_id = p_user;
  end if;
end;
$$;
revoke all on function svc.set_sandbox_tester(uuid, boolean, text) from public, anon, authenticated;
grant execute on function svc.set_sandbox_tester(uuid, boolean, text) to service_role;

-- Playback entitlement for the Worker. Returns the media to sign only if the user may watch it now.
-- Order matters: takedowns (removed, rejected) and creators who are no longer live adults block
-- everyone, owners included; buyers keep access while an edit is re-reviewed.
create function svc.playback_check(p_user uuid, p_episode uuid) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  e public.episodes;
  s public.series;
  m app_private.episode_media;
  v_mature boolean;
  r record;
  v_media jsonb;
begin
  perform svc.require_service_role();
  if not app_private.is_live_adult(p_user) then
    return jsonb_build_object('allowed', false, 'reason', 'not_adult');
  end if;
  select pp.mature_opt_in into v_mature from public.profile_private pp where pp.user_id = p_user;

  select * into e from public.episodes where id = p_episode;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'not_available');
  end if;
  select * into s from public.series where id = e.series_id;
  select * into m from app_private.episode_media where episode_id = p_episode;
  if m.asset_id is null and m.manifest_key is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_media');
  end if;
  v_media := jsonb_build_object('provider', m.provider, 'asset_id', m.asset_id, 'manifest_key', m.manifest_key);

  -- Rejected media is never served, not even to its creator (it can only be replaced).
  if e.status = 'removed' or s.status = 'removed' or e.moderation_status = 'rejected'
     or not app_private.is_live_adult(s.creator_id) then
    return jsonb_build_object('allowed', false, 'reason', 'not_available');
  end if;
  if s.creator_id = p_user then
    return jsonb_build_object('allowed', true, 'reason', 'own') || v_media;
  end if;
  -- Everyone else: only approved content (approval is never withdrawn; takedowns remove).
  if s.moderation_status <> 'approved' or e.moderation_status <> 'approved' then
    return jsonb_build_object('allowed', false, 'reason', 'not_available');
  end if;
  if s.maturity = 'mature' and not coalesce(v_mature, false) then
    return jsonb_build_object('allowed', false, 'reason', 'mature_opt_in_required');
  end if;
  if exists (select 1 from public.episode_unlocks u where u.user_id = p_user and u.episode_id = p_episode) then
    return jsonb_build_object('allowed', true, 'reason', 'unlocked') || v_media;
  end if;
  select * into r from app_private.resolve_episode_price(p_episode, p_user);
  if r.purchasable and r.is_free then
    return jsonb_build_object('allowed', true, 'reason', 'free') || v_media;
  end if;
  if r.purchasable then
    return jsonb_build_object('allowed', false, 'reason', 'locked', 'price', r.price);
  end if;
  return jsonb_build_object('allowed', false, 'reason', r.reason);
end;
$$;
revoke all on function svc.playback_check(uuid, uuid) from public, anon, authenticated;
grant execute on function svc.playback_check(uuid, uuid) to service_role;
