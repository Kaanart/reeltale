-- ReelTale foundation: schemas, privilege defaults, shared helpers.
--
-- Supabase gives anon and authenticated ALL on every new table in public, and EXECUTE on every new
-- function, so a forgotten grant lets any client write anything. This migration switches the defaults
-- off, so every later migration grants exactly what it means to and nothing else.
--
-- Schemas:
--   public       tables the app reads through PostgREST (column grants + RLS) and user RPCs
--   svc          service RPCs for the Worker (service_role only; exposed to PostgREST)
--   ledger       coins, lots, transactions: no direct access for anyone but the owner role
--   app_private  internal tables (media ids, tokens, queues, settings): same

create schema if not exists svc;
create schema if not exists ledger;
create schema if not exists app_private;

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

revoke all on schema svc, ledger, app_private from public, anon, authenticated;
revoke all on schema ledger, app_private from service_role;
grant usage on schema svc to service_role;

-- No implicit EXECUTE on functions. PUBLIC's EXECUTE is a global default, so it is revoked
-- globally; Supabase's own grants to anon/authenticated are per schema.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema svc revoke execute on functions from anon, authenticated;

-- No implicit table or sequence access for client roles in public.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- service_role keeps Supabase's default access to public tables (the Worker reads them), but never
-- gets the private schemas: it changes them only through svc functions.
alter default privileges in schema ledger revoke all on tables from service_role;
alter default privileges in schema app_private revoke all on tables from service_role;

-- Guard at the top of every svc function. EXECUTE grants are the real barrier; this is the second
-- one. Inside a security definer function current_user is the owner, but the "role" setting still
-- shows the caller's SET ROLE (service_role through PostgREST). Migrations and pg_cron run as
-- postgres with no role set.
create function svc.require_service_role() returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if current_setting('role', true) = 'service_role' then
    return;
  end if;
  if coalesce(current_setting('role', true), 'none') in ('none', '') and session_user = 'postgres' then
    return;
  end if;
  raise exception 'service role required' using errcode = '42501';
end;
$$;
revoke all on function svc.require_service_role() from public, anon, authenticated;
grant execute on function svc.require_service_role() to service_role;

create function app_private.tg_touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app_private.tg_touch_updated_at() from public, anon, authenticated;

-- Attached to append-only tables (ledger entries, audit logs). Triggers also fire for the owner role,
-- so this holds even where grants don't apply.
create function app_private.tg_forbid_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only (% not allowed)', tg_table_schema || '.' || tg_table_name, tg_op
    using errcode = '42501';
end;
$$;
revoke all on function app_private.tg_forbid_mutation() from public, anon, authenticated;

-- Internal settings (e.g. the pepper for identity hashes). Never readable by clients.
create table app_private.settings (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

-- A random pepper so age-block hashes can't be reversed by hashing a list of emails.
-- gen_random_uuid() uses the server's strong random source.
insert into app_private.settings (key, value)
values (
  'identity_pepper',
  encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex')
);
