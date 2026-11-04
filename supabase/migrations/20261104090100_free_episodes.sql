-- The first 10 episodes of a series are free by default (docs/DECISIONS.md, 2026-11-04: like WebNovel, visitors watch
-- the start of every series without an account or coins). Creators can still choose 3 to 500.

alter table public.series alter column free_episode_count set default 10;

-- Same function as in 20261027090200_catalog.sql with the new default; replacing keeps its grants.
create or replace function public.studio_create_series(
  p_title text,
  p_synopsis text,
  p_format text,
  p_maturity text default 'general',
  p_language text default 'en',
  p_free_episode_count integer default 10,
  p_default_price_coins integer default null,
  p_tag_slugs text[] default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_adult();
  v_id uuid;
  v_recent integer;
begin
  if not exists (select 1 from public.ai_consents c
                 where c.user_id = v_uid and c.purpose = 'upload_processing' and c.withdrawn_at is null) then
    raise exception 'upload_consent_required' using errcode = '42501';
  end if;
  if p_format not in ('live_action', 'stop_motion', 'ai_generated') then
    raise exception 'invalid_format' using errcode = '22023';
  end if;
  if p_format = 'ai_generated' and p_default_price_coins is not null then
    raise exception 'ai_series_free_until_editors_pick' using errcode = '22023';
  end if;
  -- Serialise this user's creations so parallel calls can't all pass the daily limit.
  perform pg_advisory_xact_lock(hashtext('series_create:' || v_uid::text));
  select count(*) into v_recent from public.series
  where creator_id = v_uid and created_at > now() - interval '1 day';
  if v_recent >= 10 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  insert into public.series (creator_id, slug, title, synopsis, format, maturity, language,
                             free_episode_count, default_price_coins)
  values (v_uid, app_private.slugify(p_title), btrim(p_title), coalesce(p_synopsis, ''), p_format,
          coalesce(p_maturity, 'general'), coalesce(p_language, 'en'),
          coalesce(p_free_episode_count, 6), p_default_price_coins)
  returning id into v_id;

  perform app_private.set_series_tags(v_id, p_tag_slugs);
  return v_id;
end;
$$;
