-- Accounts: profiles, private profile data, the 18+ gate, consents, deletion requests.
--
-- ReelTale is 18+ only (Meta Model API terms §10.1). The date of birth is declared once and can't be
-- changed. An under-18 answer doesn't raise an error: it is stored, the account is blocked and queued
-- for deletion, and a peppered hash of the email is kept for 90 days so the same person can't just
-- sign up again with another date. (Raising would roll the record back and let them retry.)

-- ---------------------------------------------------------------------------------------------
-- profiles: public face of an account. Clients read safe columns; all writes go through RPCs,
-- because handle, name and bio are moderated by the Worker before they are saved.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext unique
    check (handle is null or handle::text ~ '^[A-Za-z0-9_]{3,24}$'),
  display_name text check (char_length(display_name) <= 50),
  bio text check (char_length(bio) <= 300),
  avatar_key text,
  role text not null default 'user' check (role in ('user', 'editor', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint avatar_key_is_own check (avatar_key is null or avatar_key like 'public/avatars/' || id::text || '/%')
);
create trigger profiles_touch before update on public.profiles
  for each row execute function app_private.tg_touch_updated_at();

revoke all on public.profiles from anon, authenticated;
grant select (id, handle, display_name, bio, avatar_key) on public.profiles to authenticated;
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------------------------
-- profile_private: only the owner can read it. Clients may change locale and the mature opt-in;
-- everything else is set by RPCs.
create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  date_of_birth date,
  age_status text not null default 'unknown' check (age_status in ('unknown', 'adult', 'blocked')),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  locale text check (locale is null or locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  mature_opt_in boolean not null default false,
  tos_version text,
  tos_accepted_at timestamptz,
  ai_safety_ack_at timestamptz,         -- Apple 5.1.2(i): comments, bios, handles, uploads are checked by Meta AI
  ai_access_until timestamptz,          -- set only by svc (judge/event codes)
  updated_at timestamptz not null default now()
);
create trigger profile_private_touch before update on public.profile_private
  for each row execute function app_private.tg_touch_updated_at();

-- Date of birth can be set once and never changed, whoever runs the update.
create function app_private.tg_dob_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.date_of_birth is not null and new.date_of_birth is distinct from old.date_of_birth then
    raise exception 'date_of_birth_already_set' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app_private.tg_dob_immutable() from public, anon, authenticated;
create trigger profile_private_dob_immutable before update on public.profile_private
  for each row execute function app_private.tg_dob_immutable();

revoke all on public.profile_private from anon, authenticated;
grant select (user_id, date_of_birth, age_status, country, locale, mature_opt_in, tos_version,
              tos_accepted_at, ai_safety_ack_at, ai_access_until)
  on public.profile_private to authenticated;
grant update (locale, mature_opt_in) on public.profile_private to authenticated;
alter table public.profile_private enable row level security;

create policy profile_private_owner_read on public.profile_private
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Per-purpose AI consent (Apple 5.1.2(i), GDPR). One row per purpose; re-consenting updates it.
create table public.ai_consents (
  user_id uuid not null references public.profiles (id) on delete cascade,
  purpose text not null check (purpose in ('story', 'upload_processing', 'voice')),
  providers text[] not null check (cardinality(providers) > 0),
  version text not null,
  accepted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (user_id, purpose)
);
revoke all on public.ai_consents from anon, authenticated;
grant select (user_id, purpose, providers, version, accepted_at, withdrawn_at) on public.ai_consents to authenticated;
alter table public.ai_consents enable row level security;
create policy ai_consents_owner_read on public.ai_consents
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Internal: deletion queue (worked by the Worker's AccountDelete workflow) and age blocks.
create table app_private.account_deletion_queue (
  user_id uuid primary key,
  reason text not null check (reason in ('user_request', 'under_18', 'moderation')),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,               -- lease: a claim older than an hour can be taken again
  processed_at timestamptz
);

create table app_private.age_blocks (
  identity_hash text primary key,
  blocked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Normalises before hashing so trivial variants map to the same identity: case and spaces, '+tag'
-- suffixes, and Gmail's ignored dots. A phone number (no '@') is reduced to its digits.
create function app_private.normalize_identity(p_identity text) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_identity, '')));
  v_local text;
  v_domain text;
begin
  if v = '' then
    return null;
  end if;
  if position('@' in v) = 0 then
    v := regexp_replace(v, '[^0-9]', '', 'g');
    return nullif(v, '');
  end if;
  v_local := split_part(v, '@', 1);
  v_domain := split_part(v, '@', 2);
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return v_local || '@' || v_domain;
end;
$$;
revoke all on function app_private.normalize_identity(text) from public, anon, authenticated;

create function app_private.identity_hash(p_identity text) returns text
language sql stable
set search_path = ''
as $$
  select encode(
    sha256(convert_to(
      (select s.value from app_private.settings s where s.key = 'identity_pepper') || '|' || app_private.normalize_identity(p_identity),
      'UTF8')),
    'hex')
  where app_private.normalize_identity(p_identity) is not null
$$;
revoke all on function app_private.identity_hash(text) from public, anon, authenticated;

-- Stops serving a creator's content and earning: series hidden from new viewers (buyers keep what they
-- unlocked until the deletion job removes it and re-credits them), creator programme suspended.
-- creator_accounts is created by a later migration; plpgsql resolves names at run time.
create function app_private.hide_creator_content(p_user uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.series set status = 'hidden' where creator_id = p_user and status = 'published';
  update public.creator_accounts set status = 'suspended', payouts_enabled = false
  where user_id = p_user and status in ('applied', 'active');
end;
$$;
revoke all on function app_private.hide_creator_content(uuid) from public, anon, authenticated;

-- Blocks an account: marks it, queues deletion, remembers the identity for 90 days.
create function app_private.block_underage(p_user uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_hash text;
begin
  update public.profile_private set age_status = 'blocked' where user_id = p_user;
  update public.ai_consents set withdrawn_at = now() where user_id = p_user and withdrawn_at is null;
  -- Content made by a minor must stop being served right away, not when the deletion job runs.
  perform app_private.hide_creator_content(p_user);

  insert into app_private.account_deletion_queue (user_id, reason)
  values (p_user, 'under_18')
  on conflict (user_id) do nothing;

  -- Remember every identifier of the account (email and phone), so neither can sign up again.
  for v_hash in
    select h from auth.users u
    cross join lateral (values (app_private.identity_hash(u.email)), (app_private.identity_hash(u.phone))) x (h)
    where u.id = p_user and h is not null
  loop
    insert into app_private.age_blocks (identity_hash, expires_at)
    values (v_hash, now() + interval '90 days')
    on conflict (identity_hash) do update set expires_at = excluded.expires_at, blocked_at = now();
  end loop;
end;
$$;
revoke all on function app_private.block_underage(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- New auth user → profile rows. If the email was blocked as under-18 in the last 90 days, the new
-- account starts blocked (the signup itself must not fail: GoTrue would show a generic error).
create function app_private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.profile_private (user_id) values (new.id);

  if exists (
    select 1 from app_private.age_blocks b
    where b.identity_hash in (app_private.identity_hash(new.email), app_private.identity_hash(new.phone))
      and b.expires_at > now()
  ) then
    perform app_private.block_underage(new.id);
  end if;

  return new;
end;
$$;
revoke all on function app_private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- Changing the email (or phone) to a blocked identity blocks the account too.
create function app_private.handle_identity_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from app_private.age_blocks b
    where b.identity_hash in (app_private.identity_hash(new.email), app_private.identity_hash(new.phone))
      and b.expires_at > now()
  ) then
    perform app_private.block_underage(new.id);
  end if;
  return new;
end;
$$;
revoke all on function app_private.handle_identity_change() from public, anon, authenticated;
create trigger on_auth_user_identity_changed after update of email, phone on auth.users
  for each row when (new.email is distinct from old.email or new.phone is distinct from old.phone)
  execute function app_private.handle_identity_change();

-- ---------------------------------------------------------------------------------------------
-- Is the caller a signed-in adult with a live account? Used by policies and every user RPC.
create function public.is_adult() returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profile_private pp
    join public.profiles p on p.id = pp.user_id
    where pp.user_id = (select auth.uid())
      and pp.age_status = 'adult'
      and p.deleted_at is null
  ) and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;
revoke all on function public.is_adult() from public, anon, authenticated;
grant execute on function public.is_adult() to authenticated;

-- Same test for any user id (service paths, where the JWT may be up to an hour stale).
create function app_private.is_live_adult(p_user uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profile_private pp join public.profiles p on p.id = pp.user_id
    where pp.user_id = p_user and pp.age_status = 'adult' and p.deleted_at is null
  )
$$;
revoke all on function app_private.is_live_adult(uuid) from public, anon, authenticated;

-- May other users see this profile? Only live adults are listed (no directory of unknown-age or
-- blocked accounts).
create function public.profile_is_listed(p_user uuid) returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select app_private.is_live_adult(p_user)
$$;
revoke all on function public.profile_is_listed(uuid) from public, anon, authenticated;
grant execute on function public.profile_is_listed(uuid) to authenticated;

-- The caller's own role (editor screens). Other users' roles are never exposed.
create function public.get_my_role() returns text
language sql stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;
revoke all on function public.get_my_role() from public, anon, authenticated;
grant execute on function public.get_my_role() to authenticated;

-- Raises unless the caller is a signed-in adult. Call it first in every user RPC.
create function app_private.require_adult() returns uuid
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_adult() then
    raise exception 'not_adult' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function app_private.require_adult() from public, anon, authenticated;

-- Profiles of adults are visible to other adults; you can always see your own.
create policy profiles_read on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or ((select public.is_adult()) and public.profile_is_listed(id))
  );

-- Mature opt-in and locale: owner only, adults only for the opt-in.
create policy profile_private_owner_update on public.profile_private
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (mature_opt_in = false or age_status = 'adult'));

-- ---------------------------------------------------------------------------------------------
-- User RPCs

-- Declare date of birth once. Returns 'adult' or 'blocked'. The client must then refresh its session
-- so the access token carries the new age_ok claim.
create function public.set_my_date_of_birth(p_dob date) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current date;
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_dob is null or p_dob < date '1900-01-01' or p_dob > current_date then
    raise exception 'invalid_date_of_birth' using errcode = '22023';
  end if;

  select pp.date_of_birth, pp.age_status into v_current, v_status
  from public.profile_private pp where pp.user_id = v_uid
  for update;

  if not found then
    raise exception 'profile_missing' using errcode = 'P0002';
  end if;
  if v_status = 'blocked' then
    return 'blocked';
  end if;
  if v_current is not null then
    raise exception 'date_of_birth_already_set' using errcode = '22023';
  end if;

  if p_dob <= (current_date - interval '18 years')::date then
    update public.profile_private set date_of_birth = p_dob, age_status = 'adult' where user_id = v_uid;
    return 'adult';
  end if;

  update public.profile_private set date_of_birth = p_dob where user_id = v_uid;
  perform app_private.block_underage(v_uid);
  return 'blocked';
end;
$$;
revoke all on function public.set_my_date_of_birth(date) from public, anon, authenticated;
grant execute on function public.set_my_date_of_birth(date) to authenticated;

-- The OS says the user is under 18 (iOS Declared Age Range, Android Play Age Signals). This only
-- ever blocks; a client that never calls it gains nothing.
create function public.report_underage_signal() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform app_private.block_underage(v_uid);
end;
$$;
revoke all on function public.report_underage_signal() from public, anon, authenticated;
grant execute on function public.report_underage_signal() to authenticated;

-- Accept the Terms, including the disclosure that comments, bios, handles and uploads are checked
-- by AI from Meta.
create function public.accept_terms(p_tos_version text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_tos_version is null or p_tos_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid_tos_version' using errcode = '22023';
  end if;
  update public.profile_private
  set tos_version = p_tos_version, tos_accepted_at = now(), ai_safety_ack_at = now()
  where user_id = v_uid;
end;
$$;
revoke all on function public.accept_terms(text) from public, anon, authenticated;
grant execute on function public.accept_terms(text) to authenticated;

-- Give or withdraw consent for one AI purpose. Withdrawing is as easy as giving (GDPR Art. 7(3)).
create function public.set_ai_consent(p_purpose text, p_providers text[], p_version text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_purpose not in ('story', 'upload_processing', 'voice') then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;
  if p_granted then
    perform app_private.require_adult();
    if p_providers is null or cardinality(p_providers) = 0 or p_version is null then
      raise exception 'invalid_consent' using errcode = '22023';
    end if;
    insert into public.ai_consents (user_id, purpose, providers, version, accepted_at, withdrawn_at)
    values (v_uid, p_purpose, p_providers, p_version, now(), null)
    on conflict (user_id, purpose) do update
      set providers = excluded.providers, version = excluded.version,
          accepted_at = excluded.accepted_at, withdrawn_at = null;
  else
    update public.ai_consents set withdrawn_at = now()
    where user_id = v_uid and purpose = p_purpose and withdrawn_at is null;
  end if;
end;
$$;
revoke all on function public.set_ai_consent(text, text[], text, boolean) from public, anon, authenticated;
grant execute on function public.set_ai_consent(text, text[], text, boolean) to authenticated;

-- Does this user currently consent to a purpose, including a specific provider?
create function app_private.has_ai_consent(p_user uuid, p_purpose text, p_provider text) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.ai_consents c
    where c.user_id = p_user and c.purpose = p_purpose and c.withdrawn_at is null
      and p_provider = any (c.providers)
  )
$$;
revoke all on function app_private.has_ai_consent(uuid, text, text) from public, anon, authenticated;

-- Start account deletion. Scrubs the public profile at once (the tombstone), then the Worker's
-- AccountDelete workflow does the rest (sign-out and ban, media, Apple revoke, RevenueCat, auth user).
create function public.request_account_deletion() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.profiles
  set deleted_at = coalesce(deleted_at, now()), handle = null, display_name = null, bio = null, avatar_key = null
  where id = v_uid;
  update public.ai_consents set withdrawn_at = now() where user_id = v_uid and withdrawn_at is null;
  perform app_private.hide_creator_content(v_uid);
  insert into app_private.account_deletion_queue (user_id, reason)
  values (v_uid, 'user_request')
  on conflict (user_id) do nothing;
end;
$$;
revoke all on function public.request_account_deletion() from public, anon, authenticated;
grant execute on function public.request_account_deletion() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Service RPCs

-- Profile text after the Worker's moderation check passed.
create function svc.update_profile(p_user uuid, p_handle text, p_display_name text, p_bio text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  if not app_private.is_live_adult(p_user) then
    raise exception 'not_adult' using errcode = '42501';
  end if;
  update public.profiles
  set handle = coalesce(p_handle, handle),
      display_name = coalesce(p_display_name, display_name),
      bio = coalesce(p_bio, bio)
  where id = p_user and deleted_at is null;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function svc.update_profile(uuid, text, text, text) from public, anon, authenticated;
grant execute on function svc.update_profile(uuid, text, text, text) to service_role;

-- Avatar uploaded by the Worker to R2 under public/avatars/<user>/... (the check constraint enforces it).
create function svc.set_avatar(p_user uuid, p_avatar_key text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  if not app_private.is_live_adult(p_user) then
    raise exception 'not_adult' using errcode = '42501';
  end if;
  update public.profiles set avatar_key = p_avatar_key where id = p_user;
end;
$$;
revoke all on function svc.set_avatar(uuid, text) from public, anon, authenticated;
grant execute on function svc.set_avatar(uuid, text) to service_role;

create function svc.set_country(p_user uuid, p_country text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  update public.profile_private set country = p_country where user_id = p_user;
end;
$$;
revoke all on function svc.set_country(uuid, text) from public, anon, authenticated;
grant execute on function svc.set_country(uuid, text) to service_role;

-- Next deletion jobs for the Worker.
create function svc.claim_account_deletions(p_limit integer default 20)
returns table (user_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  -- Lease: claimed jobs are invisible to other workers for an hour, so overlapping cron ticks don't
  -- start duplicate deletion workflows.
  return query
    update app_private.account_deletion_queue q set claimed_at = now()
    where q.user_id in (
      select x.user_id from app_private.account_deletion_queue x
      where x.processed_at is null and (x.claimed_at is null or x.claimed_at < now() - interval '1 hour')
      order by x.requested_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked
    )
    returning q.user_id, q.reason;
end;
$$;
revoke all on function svc.claim_account_deletions(integer) from public, anon, authenticated;
grant execute on function svc.claim_account_deletions(integer) to service_role;

create function svc.mark_account_deleted(p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  update public.creator_accounts set status = 'ended', payouts_enabled = false where user_id = p_user;
  update app_private.account_deletion_queue set processed_at = now() where user_id = p_user;
end;
$$;
revoke all on function svc.mark_account_deleted(uuid) from public, anon, authenticated;
grant execute on function svc.mark_account_deleted(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Auth hook: adds age_ok to every access token, so the Worker can reject non-adults without a
-- database round trip. Enable it in Dashboard → Authentication → Hooks (Custom Access Token).
create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_ok boolean;
begin
  select (pp.age_status = 'adult' and p.deleted_at is null) into v_ok
  from public.profile_private pp
  join public.profiles p on p.id = pp.user_id
  where pp.user_id = (event ->> 'user_id')::uuid;

  v_claims := jsonb_set(v_claims, '{age_ok}', to_jsonb(coalesce(v_ok, false)));
  return jsonb_set(event, '{claims}', v_claims);
end;
$$;
revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
