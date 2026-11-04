-- Hard limits on R2 use, so the free tier (10 GB stored, 1M Class A and 10M Class B operations a month) is never
-- exceeded by surprise. The Worker reserves every R2 call here first (svc.r2_reserve) and makes no call that is
-- refused. Caps sit at 80% of the free tier, because a step that is retried after its write counts twice.
--   Class A: writes (and lists, which the Worker doesn't make). Class B: reads. Deletes are free.
--   Stored bytes: every byte ever written; deletes are not subtracted (takedowns are rare), so this overcounts.
-- New AI scenes check svc.r2_has_room() before any coins are held or models are called.

insert into public.pricing_config (key, value) values
  ('r2_class_a_per_month', '800000'),
  ('r2_class_b_per_month', '8000000'),
  ('r2_stored_mb_cap', '8000')
on conflict (key) do nothing;

create table app_private.r2_usage_monthly (
  month date primary key,
  class_a bigint not null default 0 check (class_a >= 0),
  class_b bigint not null default 0 check (class_b >= 0)
);
revoke all on app_private.r2_usage_monthly from anon, authenticated;

create table app_private.r2_storage (
  id boolean primary key default true check (id),
  bytes bigint not null default 0 check (bytes >= 0)
);
revoke all on app_private.r2_storage from anon, authenticated;
insert into app_private.r2_storage (id) values (true) on conflict (id) do nothing;

-- One R2 operation of class 'a' or 'b', plus the bytes a write stores. Raises storage_budget_exceeded (and counts
-- nothing) when it would go over a cap.
create function svc.r2_reserve(p_class text, p_bytes bigint default 0)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
begin
  perform svc.require_service_role();
  if p_class is null or p_class not in ('a', 'b') or p_bytes is null or p_bytes < 0 or (p_class = 'b' and p_bytes > 0) then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  insert into app_private.r2_usage_monthly (month) values (v_month) on conflict (month) do nothing;
  if p_class = 'a' then
    update app_private.r2_usage_monthly set class_a = class_a + 1
    where month = v_month and class_a + 1 <= app_private.cfg_int('r2_class_a_per_month', 800000);
  else
    update app_private.r2_usage_monthly set class_b = class_b + 1
    where month = v_month and class_b + 1 <= app_private.cfg_int('r2_class_b_per_month', 8000000);
  end if;
  if not found then
    raise exception 'storage_budget_exceeded' using errcode = '54000';
  end if;
  if p_bytes > 0 then
    update app_private.r2_storage set bytes = bytes + p_bytes
    where id and bytes + p_bytes <= app_private.cfg_int('r2_stored_mb_cap', 8000)::bigint * 1048576;
    if not found then
      raise exception 'storage_budget_exceeded' using errcode = '54000';
    end if;
  end if;
end;
$$;
revoke all on function svc.r2_reserve(text, bigint) from public, anon, authenticated;
grant execute on function svc.r2_reserve(text, bigint) to service_role;

-- Room for one more scene (about 20 writes, 1000 reads and 50 MB, with margin)? Checked before a scene starts.
create function svc.r2_has_room()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  u app_private.r2_usage_monthly;
  v_bytes bigint;
begin
  perform svc.require_service_role();
  select * into u from app_private.r2_usage_monthly m where m.month = v_month;
  select s.bytes into v_bytes from app_private.r2_storage s where s.id;
  return coalesce(u.class_a, 0) + 100 <= app_private.cfg_int('r2_class_a_per_month', 800000)
    and coalesce(u.class_b, 0) + 1000 <= app_private.cfg_int('r2_class_b_per_month', 8000000)
    and coalesce(v_bytes, 0) + 50::bigint * 1048576 <= app_private.cfg_int('r2_stored_mb_cap', 8000)::bigint * 1048576;
end;
$$;
revoke all on function svc.r2_has_room() from public, anon, authenticated;
grant execute on function svc.r2_has_room() to service_role;
