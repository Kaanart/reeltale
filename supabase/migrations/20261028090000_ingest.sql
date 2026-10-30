-- EpisodeIngest: what happens after a creator's upload finishes processing on Cloudflare Stream.
--
-- The Worker's Stream webhook attaches the media (svc.attach_episode_media) and starts the EpisodeIngest
-- Workflow (apps/server/src/workflows/ingest-runner.ts), which calls:
--   svc.ingest_context        is this upload still the episode's media, and is the episode still waiting for review?
--   svc.ingest_claim_review   one paid media review per episode version, within a platform-wide daily cap
--   svc.record_verdict('episode', …)  (moderation migration): approved, rejected or needs_editor
--   svc.ingest_set_media      poster and preview keys, only for approved media that is still current
--   svc.stream_cleanup_due / svc.stream_cleanup_done   delete Stream videos no episode uses any more
--
-- Also here: a per-creator cap on upload starts per day (svc.check_episode_upload), and the replaced or
-- superseded Stream video of an episode is queued for deletion (svc.attach_episode_media,
-- svc.check_episode_upload). Both functions keep every check they had; only the additions are new.

insert into public.pricing_config (key, value) values
  ('uploads_per_day', '30'),              -- upload starts per creator in any 24 hours
  ('ingest_reviews_per_day', '500'),      -- automated media reviews per UTC day, whole platform (cost bound)
  ('replaced_media_hold_hours', '0')      -- keep a replaced Stream video this long before deleting it
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Upload starts, counted for the daily cap. Every row older than a day is pruned on the next start by
-- anyone, so this holds about a day of history in all (a creator who stops uploading or deletes their
-- account doesn't stay here). No foreign keys: rows are only counted.
create table app_private.upload_starts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  episode_id uuid not null,
  created_at timestamptz not null default now()
);
create index upload_starts_user_idx on app_private.upload_starts (user_id, created_at);
revoke all on app_private.upload_starts from public, anon, authenticated;

-- Paid media reviews: one claim per episode version (a retried step re-uses its claim), and a counter
-- per UTC day for the platform-wide cap.
create table app_private.ingest_reviews (
  episode_id uuid not null,
  version integer not null,
  asset_id text not null,
  created_at timestamptz not null default now(),
  primary key (episode_id, version)
);
revoke all on app_private.ingest_reviews from public, anon, authenticated;

create table app_private.ingest_review_daily (
  day date primary key,
  reviews integer not null default 0 check (reviews >= 0)
);
revoke all on app_private.ingest_review_daily from public, anon, authenticated;

-- Stream videos that no episode uses any more: replaced by a newer upload after a rejection, or an
-- upload grant that expired and was superseded. The ingest workflow deletes them through the Stream API.
create table app_private.stream_cleanup (
  asset_id text primary key check (char_length(asset_id) between 1 and 64),
  episode_id uuid not null,
  reason text not null check (reason in ('replaced', 'superseded')),
  queued_at timestamptz not null default now(),
  due_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index stream_cleanup_due_idx on app_private.stream_cleanup (due_at) where deleted_at is null;
revoke all on app_private.stream_cleanup from public, anon, authenticated;

create function app_private.queue_stream_cleanup(p_episode uuid, p_asset_id text, p_reason text) returns void
language sql
set search_path = ''
as $$
  insert into app_private.stream_cleanup (asset_id, episode_id, reason, due_at)
  values (p_asset_id, p_episode, p_reason,
          now() + make_interval(hours => app_private.cfg_int('replaced_media_hold_hours', 0)))
  on conflict (asset_id) do nothing
$$;
revoke all on function app_private.queue_stream_cleanup(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Replaced service RPCs (same signatures; grants are restated)

-- May this user upload media for this episode? Returns the series format for the upload metadata.
-- New: at most uploads_per_day upload starts per creator in any 24 hours ('rate_limited'), and an
-- expired upload grant that is superseded queues its Stream video for deletion.
create or replace function svc.check_episode_upload(p_user uuid, p_episode uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_format text;
  v_superseded text;
  v_starts integer;
begin
  perform svc.require_service_role();
  if not app_private.is_live_adult(p_user) then
    raise exception 'upload_not_allowed' using errcode = '42501';
  end if;
  -- One live upload per episode: a draft, a processing episode whose upload URL has long expired
  -- (upload URLs live 30 minutes), or an episode whose media was rejected (it was never public).
  select s.format, m.pending_asset_id into v_format, v_superseded
  from public.episodes e join public.series s on s.id = e.series_id
  left join app_private.episode_media m on m.episode_id = e.id
  where e.id = p_episode and s.creator_id = p_user and s.status <> 'removed'
    and (e.status = 'draft'
         or (e.status = 'processing' and (m.pending_upload_at is null or m.pending_upload_at < now() - interval '2 hours'))
         or (e.status = 'ready' and e.moderation_status = 'rejected'))
  for update of e;
  if v_format is null then
    raise exception 'upload_not_allowed' using errcode = '42501';
  end if;
  if not app_private.has_ai_consent(p_user, 'upload_processing', 'meta') then
    raise exception 'upload_consent_required' using errcode = '42501';
  end if;
  -- The daily cap. The advisory lock serialises one creator's concurrent starts, so two can't both
  -- pass the count. Only starts that pass every check are counted.
  perform pg_advisory_xact_lock(hashtextextended('reeltale.upload_starts:' || p_user::text, 0));
  -- Pruning is housekeeping (rows another start is pruning are skipped, never waited for); the count
  -- itself only looks at the last day.
  delete from app_private.upload_starts where id in (
    select u.id from app_private.upload_starts u where u.created_at < now() - interval '1 day'
    for update skip locked);
  select count(*) into v_starts from app_private.upload_starts
  where user_id = p_user and created_at >= now() - interval '1 day';
  if v_starts >= app_private.cfg_int('uploads_per_day', 30) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into app_private.upload_starts (user_id, episode_id) values (p_user, p_episode);
  -- The old grant's video (if the creator used it at all) can never attach now: delete it.
  if v_superseded is not null then
    perform app_private.queue_stream_cleanup(p_episode, v_superseded, 'superseded');
  end if;
  update public.episodes set status = 'processing' where id = p_episode;
  insert into app_private.episode_media (episode_id, pending_asset_id, pending_upload_at)
  values (p_episode, null, now())
  on conflict (episode_id) do update set pending_asset_id = null, pending_upload_at = now();
  return v_format;
end;
$$;
revoke all on function svc.check_episode_upload(uuid, uuid) from public, anon, authenticated;
grant execute on function svc.check_episode_upload(uuid, uuid) to service_role;

-- Stream says the video is ready (webhook verified by the Worker). Only the bound upload of a
-- draft/processing episode is accepted; anything else (a second or late upload, an approved or
-- published episode) is refused, so reviewed media can never be swapped.
-- New: the video it replaces (a rejected upload) is queued for deletion.
create or replace function svc.attach_episode_media(
  p_episode uuid,
  p_provider text,
  p_asset_id text,
  p_duration_s integer,
  p_poster_key text,
  p_preview_key text,
  p_manifest_key text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_asset text;
  v_old_provider text;
begin
  perform svc.require_service_role();
  if p_duration_s is null or p_duration_s < 1 or p_duration_s > 120 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  select m.asset_id, m.provider into v_old_asset, v_old_provider
  from public.episodes e
  join app_private.episode_media m on m.episode_id = e.id
  where e.id = p_episode and e.status in ('draft', 'processing')
    and m.pending_asset_id is not null and m.pending_asset_id = p_asset_id
  for update of e, m;
  if not found then
    raise exception 'episode_not_accepting_media' using errcode = '22023';
  end if;
  if v_old_asset is not null and v_old_asset <> p_asset_id and v_old_provider = 'cf_stream' then
    perform app_private.queue_stream_cleanup(p_episode, v_old_asset, 'replaced');
  end if;
  update app_private.episode_media
  set provider = p_provider, asset_id = p_asset_id, manifest_key = p_manifest_key, ready_at = now(),
      pending_asset_id = null, pending_upload_at = null
  where episode_id = p_episode;
  update public.episodes
  set duration_s = p_duration_s, poster_key = p_poster_key, preview_key = p_preview_key,
      status = 'ready', moderation_status = 'pending', content_version = content_version + 1
  where id = p_episode;
end;
$$;
revoke all on function svc.attach_episode_media(uuid, text, text, integer, text, text, text) from public, anon, authenticated;
grant execute on function svc.attach_episode_media(uuid, text, text, integer, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Ingest service RPCs (Worker)

-- What the ingest workflow needs about an episode and the media it is processing. Null if the episode
-- doesn't exist. The workflow stops when asset_id is no longer its upload (re-uploaded) or the episode
-- is no longer ready and pending. awaiting_editor: the current version was handed to an editor.
create function svc.ingest_context(p_episode uuid) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  return (
    select jsonb_build_object(
      'episode_id', e.id, 'content_version', e.content_version, 'title', e.title, 'duration_s', e.duration_s,
      'status', e.status, 'moderation_status', e.moderation_status, 'provider', m.provider, 'asset_id', m.asset_id,
      'awaiting_editor', app_private.awaiting_editor('episode', e.id, e.content_version),
      'series', jsonb_build_object('title', s.title, 'synopsis', s.synopsis, 'maturity', s.maturity,
                                   'format', s.format, 'language', s.language))
    from public.episodes e
    join public.series s on s.id = e.series_id
    left join app_private.episode_media m on m.episode_id = e.id
    where e.id = p_episode);
end;
$$;
revoke all on function svc.ingest_context(uuid) from public, anon, authenticated;
grant execute on function svc.ingest_context(uuid) to service_role;

-- Claim the one paid review of this version of the episode's media, before calling the model.
--   'ok'        go ahead (also for a retry of the same claim)
--   'stale'     the episode moved on: another upload, another version, or no longer waiting for review
--   'reviewed'  this version already has a verdict
--   'over_cap'  the platform's daily review cap is reached: hand the episode to an editor, no model call
create function svc.ingest_claim_review(p_episode uuid, p_asset_id text, p_version integer) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  perform svc.require_service_role();
  perform 1 from public.episodes e
  join app_private.episode_media m on m.episode_id = e.id
  where e.id = p_episode and e.status = 'ready' and e.moderation_status = 'pending'
    and e.content_version = p_version and m.asset_id = p_asset_id
  for update of e;
  if not found then
    return 'stale';
  end if;
  if exists (select 1 from app_private.moderation_verdicts v
             where v.target = 'episode' and v.target_id = p_episode and v.version = p_version) then
    return 'reviewed';
  end if;
  if exists (select 1 from app_private.ingest_reviews r where r.episode_id = p_episode and r.version = p_version) then
    return 'ok';
  end if;
  insert into app_private.ingest_review_daily (day) values (v_day) on conflict (day) do nothing;
  update app_private.ingest_review_daily set reviews = reviews + 1
  where day = v_day and reviews < app_private.cfg_int('ingest_reviews_per_day', 500);
  if not found then
    return 'over_cap';
  end if;
  insert into app_private.ingest_reviews (episode_id, version, asset_id) values (p_episode, p_version, p_asset_id);
  return 'ok';
end;
$$;
revoke all on function svc.ingest_claim_review(uuid, text, integer) from public, anon, authenticated;
grant execute on function svc.ingest_claim_review(uuid, text, integer) to service_role;

-- Point the episode at its poster and preview in the public media bucket. Only for approved media that
-- is still the episode's current upload, so nothing unreviewed is ever referenced from the public
-- bucket. Keys must name this episode and upload. Returns false if the episode moved on (the Worker then
-- deletes the objects it wrote).
create function svc.ingest_set_media(p_episode uuid, p_asset_id text, p_poster_key text, p_preview_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  if p_asset_id is null or p_poster_key is null
     or p_poster_key not like ('public/posters/' || p_episode::text || '/' || p_asset_id || '.%')
     or (p_preview_key is not null
         and p_preview_key not like ('public/previews/' || p_episode::text || '/' || p_asset_id || '.%')) then
    raise exception 'invalid_media_key' using errcode = '22023';
  end if;
  update public.episodes e set poster_key = p_poster_key, preview_key = p_preview_key
  from app_private.episode_media m
  where e.id = p_episode and m.episode_id = e.id and m.asset_id = p_asset_id
    and e.moderation_status = 'approved' and e.status <> 'removed';
  return found;
end;
$$;
revoke all on function svc.ingest_set_media(uuid, text, text, text) from public, anon, authenticated;
grant execute on function svc.ingest_set_media(uuid, text, text, text) to service_role;

-- Stream videos due for deletion, oldest first: one episode's, or everyone's (p_episode null, for a
-- sweep). Never a video an episode still uses or waits for.
create function svc.stream_cleanup_due(p_episode uuid default null, p_limit integer default 20) returns text[]
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  return array(
    select c.asset_id from app_private.stream_cleanup c
    where c.deleted_at is null and c.due_at <= now()
      and (p_episode is null or c.episode_id = p_episode)
      and not exists (select 1 from app_private.episode_media m
                      where m.asset_id = c.asset_id or m.pending_asset_id = c.asset_id)
    order by c.queued_at, c.asset_id
    limit least(greatest(coalesce(p_limit, 20), 1), 100));
end;
$$;
revoke all on function svc.stream_cleanup_due(uuid, integer) from public, anon, authenticated;
grant execute on function svc.stream_cleanup_due(uuid, integer) to service_role;

-- Mark videos deleted (Stream confirmed, or they were already gone). Returns how many were marked.
create function svc.stream_cleanup_done(p_asset_ids text[]) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform svc.require_service_role();
  update app_private.stream_cleanup set deleted_at = now()
  where asset_id = any (p_asset_ids) and deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function svc.stream_cleanup_done(text[]) from public, anon, authenticated;
grant execute on function svc.stream_cleanup_done(text[]) to service_role;
