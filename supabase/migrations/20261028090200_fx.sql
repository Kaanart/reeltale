-- FX valuations: coins bought in a currency other than the euro whose euro value wasn't known when they
-- were credited.
--
-- The RevenueCat webhook values a non-EUR purchase itself when the ECB reference rate for the purchase
-- date is already published. Otherwise (the rate comes out later that day, or the ECB doesn't quote the
-- currency) the lot is credited valuation_pending, as before, and the webhook records the original
-- currency and net amount here. The Worker's FX cron takes due rows, converts them with the ECB rate for
-- their date, calls svc.value_lot and marks them done; failures back off and finally wait for a person.
-- Rows are tied to the lot through the purchase (store + store transaction) or the subscription grant's
-- idempotency key, one row per source, so webhook retries can't record anything twice.
-- Service-only: no grants to any role; the Worker uses the svc functions below.

create table app_private.fx_valuations (
  id bigint generated always as identity primary key,
  source_key text not null unique,          -- 'purchase:<store>:<store txn>' or the grant's idempotency key
  kind text not null check (kind in ('purchase', 'sub_grant')),
  store text check (store in ('app_store', 'play_store', 'web')),
  store_transaction_id text,
  lot_id bigint references ledger.coin_lots (id),   -- null: a purchase that only repaid refund debt
  coins integer not null check (coins > 0),         -- the divisor the ledger uses for this source
  currency text not null check (currency ~ '^[A-Z]{3}$' and currency <> 'EUR'),
  net_amount numeric not null check (net_amount > 0 and net_amount < 1000000000),
  value_date date not null,                 -- UTC purchase date (grants: period start) whose rate applies
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 200),
  eur_micros bigint check (eur_micros >= 0),
  rate numeric check (rate > 0),            -- units of the currency per 1 EUR
  rate_date date,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchases_name_their_transaction check (
    (kind = 'purchase') = (store is not null and store_transaction_id is not null)),
  constraint grants_have_a_lot check (kind = 'purchase' or lot_id is not null),
  constraint done_rows_carry_the_value check (
    (status = 'done') = (eur_micros is not null and rate is not null and rate_date is not null and done_at is not null))
);
create index fx_valuations_due_idx on app_private.fx_valuations (next_attempt_at, id) where status = 'pending';
create trigger fx_valuations_touch before update on app_private.fx_valuations
  for each row execute function app_private.tg_touch_updated_at();
revoke all on app_private.fx_valuations from public, anon, authenticated, service_role;

-- Shared input checks for the two record functions.
create function app_private.check_fx_input(p_currency text, p_net_amount numeric, p_at timestamptz) returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' or p_currency = 'EUR'
     or p_net_amount is null or p_net_amount <= 0 or p_net_amount >= 1000000000
     or p_at is null or p_at < timestamptz '2020-01-01 00:00:00+00' or p_at > now() + interval '1 day' then
    raise exception 'invalid_fx_valuation' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app_private.check_fx_input(text, numeric, timestamptz) from public, anon, authenticated;

-- A coin-pack purchase in another currency, after svc.credit_purchase. The webhook calls this for every
-- production delivery in a non-EUR currency; the database decides whether there's anything to value.
-- Returns 'recorded', 'already_recorded' or 'not_needed' (sandbox, or valued already).
create function svc.record_purchase_fx(
  p_store text,
  p_store_transaction_id text,
  p_currency text,
  p_net_amount numeric,
  p_purchased_at timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase ledger.purchases;
  v_lot_pending boolean;
  v_id bigint;
begin
  perform svc.require_service_role();
  perform app_private.check_fx_input(p_currency, p_net_amount, p_purchased_at);
  -- The same lock svc.credit_purchase and svc.apply_refund take for this store transaction.
  perform pg_advisory_xact_lock(hashtext('purchase:' || p_store || ':' || p_store_transaction_id));
  select * into v_purchase from ledger.purchases x
  where x.store = p_store and x.store_transaction_id = p_store_transaction_id;
  if not found then
    raise exception 'purchase_not_found' using errcode = '22023';
  end if;
  if v_purchase.environment <> 'production' or v_purchase.net_eur_micros is not null then
    return 'not_needed';
  end if;
  if v_purchase.lot_id is not null then
    select l.valuation_pending into v_lot_pending from ledger.coin_lots l where l.id = v_purchase.lot_id;
    if not v_lot_pending then
      return 'not_needed';
    end if;
  end if;
  insert into app_private.fx_valuations (source_key, kind, store, store_transaction_id, lot_id, coins, currency,
                                         net_amount, value_date)
  values ('purchase:' || p_store || ':' || p_store_transaction_id, 'purchase', p_store, p_store_transaction_id,
          v_purchase.lot_id, v_purchase.coins, p_currency, p_net_amount,
          (p_purchased_at at time zone 'utc')::date)
  on conflict (source_key) do nothing
  returning id into v_id;
  return case when v_id is null then 'already_recorded' else 'recorded' end;
end;
$$;
revoke all on function svc.record_purchase_fx(text, text, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function svc.record_purchase_fx(text, text, text, numeric, timestamptz) to service_role;

-- A subscription grant paid in another currency, after svc.grant_sub_coins (same original transaction,
-- period start and grant number). Its rate is the one for the period start. Returns 'recorded',
-- 'already_recorded', 'not_needed' (trial, sandbox, valued already) or 'no_grant' (none was made:
-- sandbox non-tester, or the period was refunded first).
create function svc.record_sub_grant_fx(
  p_original_txn text,
  p_period_start timestamptz,
  p_grant_no integer,
  p_currency text,
  p_net_amount numeric
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_lot ledger.coin_lots;
  v_id bigint;
begin
  perform svc.require_service_role();
  perform app_private.check_fx_input(p_currency, p_net_amount, p_period_start);
  v_key := app_private.sub_grant_key(p_original_txn, p_period_start, p_grant_no);
  select l.* into v_lot from ledger.transactions t join ledger.coin_lots l on l.txn_id = t.id
  where t.idempotency_key = v_key
  order by l.id
  limit 1;
  if not found then
    return 'no_grant';
  end if;
  if v_lot.environment <> 'production' or not v_lot.valuation_pending then
    return 'not_needed';
  end if;
  insert into app_private.fx_valuations (source_key, kind, lot_id, coins, currency, net_amount, value_date)
  values (v_key, 'sub_grant', v_lot.id, v_lot.initial, p_currency, p_net_amount,
          (p_period_start at time zone 'utc')::date)
  on conflict (source_key) do nothing
  returning id into v_id;
  return case when v_id is null then 'already_recorded' else 'recorded' end;
end;
$$;
revoke all on function svc.record_sub_grant_fx(text, timestamptz, integer, text, numeric) from public, anon, authenticated;
grant execute on function svc.record_sub_grant_fx(text, timestamptz, integer, text, numeric) to service_role;

-- Due valuations for the FX cron, longest waiting first. Each returned row is leased for 15 minutes (its
-- next attempt moves forward), so overlapping runs don't take the same row; a run that dies mid-way just
-- leaves it due again later. net_amount is text so no JSON float touches it.
create function svc.fx_valuations_due(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_rows jsonb;
begin
  perform svc.require_service_role();
  with leased as (
    update app_private.fx_valuations v set next_attempt_at = now() + interval '15 minutes'
    where v.id in (select x.id from app_private.fx_valuations x
                   where x.status = 'pending' and x.next_attempt_at <= now()
                   order by x.next_attempt_at, x.id
                   limit v_limit
                   for update skip locked)
    returning v.id, v.lot_id, v.coins, v.currency, v.net_amount, v.value_date, v.attempts
  )
  select jsonb_agg(jsonb_build_object('id', d.id, 'lot_id', d.lot_id, 'coins', d.coins, 'currency', d.currency,
                                      'net_amount', d.net_amount::text, 'value_date', d.value_date::text,
                                      'attempts', d.attempts) order by d.id)
  into v_rows
  from leased d;
  return coalesce(v_rows, '[]'::jsonb);
end;
$$;
revoke all on function svc.fx_valuations_due(integer) from public, anon, authenticated;
grant execute on function svc.fx_valuations_due(integer) to service_role;

-- A valuation is finished: the lot has been valued (svc.value_lot ran first, or someone valued it by
-- hand). Records the euro amount and the rate used, and fills in the purchase's own net_eur_micros. The
-- rate must be from the value date or at most 7 days before it (the Worker's rule; checked again here).
-- Returns 'done' or 'already_done'.
create function svc.fx_valuation_done(p_id bigint, p_eur_micros bigint, p_rate numeric, p_rate_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app_private.fx_valuations;
begin
  perform svc.require_service_role();
  if p_eur_micros is null or p_eur_micros < 0 or p_rate is null or p_rate <= 0 or p_rate_date is null then
    raise exception 'invalid_fx_valuation' using errcode = '22023';
  end if;
  select * into v_row from app_private.fx_valuations x where x.id = p_id for update;
  if not found then
    raise exception 'valuation_not_found' using errcode = '22023';
  end if;
  if v_row.status = 'done' then
    return 'already_done';
  end if;
  if p_rate_date > v_row.value_date or p_rate_date < v_row.value_date - 7 then
    raise exception 'invalid_fx_valuation' using errcode = '22023', detail = 'rate_date';
  end if;
  if v_row.lot_id is not null
     and exists (select 1 from ledger.coin_lots l where l.id = v_row.lot_id and l.valuation_pending) then
    raise exception 'lot_still_pending' using errcode = '22023';
  end if;
  update app_private.fx_valuations
  set status = 'done', eur_micros = p_eur_micros, rate = p_rate, rate_date = p_rate_date, done_at = now(),
      last_error = null
  where id = p_id;
  if v_row.kind = 'purchase' then
    update ledger.purchases set net_eur_micros = p_eur_micros
    where store = v_row.store and store_transaction_id = v_row.store_transaction_id and net_eur_micros is null;
  end if;
  return 'done';
end;
$$;
revoke all on function svc.fx_valuation_done(bigint, bigint, numeric, date) from public, anon, authenticated;
grant execute on function svc.fx_valuation_done(bigint, bigint, numeric, date) to service_role;

-- A valuation attempt failed. With p_retry the row waits 1 h, 2 h, 4 h, 8 h, 16 h, then 24 h between
-- attempts (a weekend or holiday purchase waits for the next working day's rate); after 14 attempts
-- (about 9 days), or at once without p_retry (a currency the ECB doesn't quote, a date older than its
-- history), it is 'failed' and waits for a person (docs/RUNBOOK.md). Returns 'retry', 'failed', or the
-- row's status if it was no longer pending.
create function svc.fx_valuation_failed(p_id bigint, p_error text, p_retry boolean default true) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app_private.fx_valuations;
  v_attempts integer;
begin
  perform svc.require_service_role();
  select * into v_row from app_private.fx_valuations x where x.id = p_id for update;
  if not found then
    raise exception 'valuation_not_found' using errcode = '22023';
  end if;
  if v_row.status <> 'pending' then
    return v_row.status;
  end if;
  v_attempts := v_row.attempts + 1;
  if not coalesce(p_retry, true) or v_attempts >= 14 then
    update app_private.fx_valuations
    set status = 'failed', attempts = v_attempts, last_error = left(coalesce(p_error, 'unknown'), 200)
    where id = p_id;
    return 'failed';
  end if;
  update app_private.fx_valuations
  set attempts = v_attempts, last_error = left(coalesce(p_error, 'unknown'), 200),
      next_attempt_at = now() + least(interval '1 hour' * power(2, v_attempts - 1), interval '24 hours')
  where id = p_id;
  return 'retry';
end;
$$;
revoke all on function svc.fx_valuation_failed(bigint, text, boolean) from public, anon, authenticated;
grant execute on function svc.fx_valuation_failed(bigint, text, boolean) to service_role;
