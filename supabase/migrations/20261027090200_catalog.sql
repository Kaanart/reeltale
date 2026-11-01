-- Catalog: tags, series, episodes, unlock records, follows, watch progress, creator studio RPCs.
--
-- Rules carried from the blueprint and the legal drafts:
-- - Every series has exactly one format (live_action, stop_motion, ai_generated). AI stories published
--   from the AI mode are always ai_generated, and stay free unless an editor gives Editor's Pick.
-- - At least the first 3 episodes of a series are free. Episode prices are 10–100 coins in steps of 5.
-- - Moderation starts as pending and nothing is shown to others before approval. Once a series or
--   episode is approved, its reviewed fields (title, synopsis, cover, tags, a mature → general change,
--   an episode title) never change in place: edits wait, owner-only, in public.pending_edits until a
--   review applies them or rejects them (the approved version stays). Viewers and buyers only ever
--   see reviewed text, and a rejected edit takes nothing away from buyers.
-- - Before approval, an edit bumps content_version. An approval only applies to the version it
--   reviewed; a rejection applies to that version or anything newer (rejecting is the safe
--   direction). Rejected media stays rejected; the creator can only replace it with a new upload.
-- - Approval is never withdrawn in place. Approved content is taken down by removal
--   (svc.recredit_episode, svc.remove_series), which re-credits buyers. Hidden series and closed
--   episodes keep working for buyers; so does everything except removal or a creator who is no
--   longer a live adult.
-- - Media is bound to the one upload the Worker issued and can only attach to a draft/processing
--   episode, so approved media can never be swapped.
-- - An episode someone unlocked is never taken away by its creator: a creator can only close it to
--   new unlocks. Removal (moderation, copyright) and account deletion re-credit buyers (ledger).
-- - Series and episodes are never deleted, only marked removed, so unlock and earnings records hold.
-- - All writes go through studio RPCs (owner checks, validation) or service RPCs.

-- ---------------------------------------------------------------------------------------------
create table public.tags (
  id smallint generated always as identity primary key,
  kind text not null check (kind in ('genre', 'trope', 'warning')),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name_i18n jsonb not null check (jsonb_typeof(name_i18n) = 'object' and name_i18n ? 'en'),
  sort smallint not null default 0
);
revoke all on public.tags from anon, authenticated;
grant select (id, kind, slug, name_i18n, sort) on public.tags to authenticated;
alter table public.tags enable row level security;
create policy tags_read on public.tags for select to authenticated using ((select public.is_adult()));

-- ---------------------------------------------------------------------------------------------
create table public.series (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.profiles (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,90}$'),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  synopsis text not null default '' check (char_length(synopsis) <= 1000),
  cover_key text check (cover_key is null or cover_key like 'public/covers/%'),
  language text not null default 'en' check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  format text not null check (format in ('live_action', 'stop_motion', 'ai_generated')),
  origin text not null default 'creator' check (origin in ('creator', 'ai_story')),
  editors_pick boolean not null default false,
  maturity text not null default 'general' check (maturity in ('general', 'mature')),
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden', 'removed')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  free_episode_count smallint not null default 6 check (free_episode_count between 3 and 500),
  default_price_coins smallint check (default_price_coins is null or (default_price_coins between 10 and 100 and default_price_coins % 5 = 0)),
  completed boolean not null default false,
  tag_ids smallint[] not null default '{}',
  fts tsvector,
  is_demo boolean not null default false,
  content_version integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_story_is_ai_format check (origin <> 'ai_story' or format = 'ai_generated')
);
create index series_discover_idx on public.series (status, moderation_status, published_at desc);
create index series_creator_idx on public.series (creator_id);
create index series_tags_gin on public.series using gin (tag_ids);
create index series_fts_gin on public.series using gin (fts);
create index series_title_trgm on public.series using gin (title extensions.gin_trgm_ops);

create table public.series_tags (
  series_id uuid not null references public.series (id) on delete cascade,
  tag_id smallint not null references public.tags (id) on delete cascade,
  primary key (series_id, tag_id)
);
revoke all on public.series_tags from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete restrict,
  number smallint not null check (number between 1 and 500),
  title text not null default '' check (char_length(title) <= 80),
  duration_s smallint check (duration_s between 1 and 120),
  kind text not null default 'video' check (kind in ('video', 'ai_comic', 'ai_video', 'frame_sequence')),
  price_coins smallint check (price_coins is null or (price_coins between 10 and 100 and price_coins % 5 = 0)),
  is_free boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'processing', 'ready', 'published', 'closed_to_new', 'removed')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  publish_requested boolean not null default false,
  content_version integer not null default 0,
  poster_key text check (poster_key is null or poster_key like 'public/posters/%'),
  preview_key text check (preview_key is null or preview_key like 'public/previews/%'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, number)
);
create index episodes_series_idx on public.episodes (series_id, number);

-- Media identifiers never leave the server: playback goes through the Worker's entitlement check.
create table app_private.episode_media (
  episode_id uuid primary key references public.episodes (id) on delete restrict,
  provider text not null default 'cf_stream' check (provider in ('cf_stream', 'r2_manifest')),
  asset_id text unique,
  manifest_key text,
  captions jsonb not null default '{}'::jsonb,
  pending_asset_id text,                -- the one Stream upload the Worker issued for this episode
  pending_upload_at timestamptz,
  ready_at timestamptz
);

-- Unlock records. Written only by ledger functions; buyers read their own.
create table public.episode_unlocks (
  user_id uuid not null,
  episode_id uuid not null references public.episodes (id) on delete restrict,
  source text not null check (source in ('coins', 'free_pass', 'ad', 'creator', 'admin')),
  coins_spent integer not null default 0 check (coins_spent >= 0),
  txn_id bigint,
  created_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);
create index episode_unlocks_episode_idx on public.episode_unlocks (episode_id);
revoke all on public.episode_unlocks from anon, authenticated;
grant select (user_id, episode_id, source, coins_spent, created_at) on public.episode_unlocks to authenticated;
alter table public.episode_unlocks enable row level security;
create policy episode_unlocks_owner_read on public.episode_unlocks
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Helpers used by policies. They must be in public and executable by authenticated, because
-- policies run as the caller.
create function public.my_mature_opt_in() returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select coalesce((select pp.mature_opt_in from public.profile_private pp where pp.user_id = (select auth.uid())), false)
$$;
revoke all on function public.my_mature_opt_in() from public, anon, authenticated;
grant execute on function public.my_mature_opt_in() to authenticated;

-- Has the caller unlocked any episode of this series? (Lets buyers keep watching a hidden series.)
create function public.has_unlock_in_series(p_series uuid) returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.episode_unlocks u
    join public.episodes e on e.id = u.episode_id
    where u.user_id = (select auth.uid()) and e.series_id = p_series
  )
$$;
revoke all on function public.has_unlock_in_series(uuid) from public, anon, authenticated;
grant execute on function public.has_unlock_in_series(uuid) to authenticated;

-- Is the series' creator still a live adult account? Content of a blocked (under-18) or deleting
-- creator is never served.
create function public.creator_is_live(p_creator uuid) returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select p_creator is not null and app_private.is_live_adult(p_creator)
$$;
revoke all on function public.creator_is_live(uuid) from public, anon, authenticated;
grant execute on function public.creator_is_live(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
revoke all on public.series from anon, authenticated;
-- fts is the search vector (title, tag names, synopsis: nothing that isn't readable already), granted so the app's
-- full-text search can filter on it.
grant select (id, creator_id, slug, title, synopsis, cover_key, language, format, origin, editors_pick, maturity,
              status, moderation_status, free_episode_count, default_price_coins, completed, tag_ids,
              published_at, created_at, updated_at, fts)
  on public.series to authenticated;
alter table public.series enable row level security;

create policy series_read on public.series
  for select to authenticated
  using (
    (select public.is_adult()) and (
      creator_id = (select auth.uid())
      or (
        public.creator_is_live(creator_id)
        and (maturity = 'general' or (select public.my_mature_opt_in()))
        and (
          (status = 'published' and moderation_status = 'approved')
          -- buyers keep a hidden series (approval is never withdrawn; takedowns remove)
          or (status <> 'removed' and moderation_status = 'approved' and public.has_unlock_in_series(id))
        )
      )
    )
  );

revoke all on public.episodes from anon, authenticated;
grant select (id, series_id, number, title, duration_s, kind, price_coins, is_free, status, moderation_status,
              poster_key, preview_key, published_at)
  on public.episodes to authenticated;
alter table public.episodes enable row level security;

-- An episode is visible if its series is visible to you (series RLS applies inside the subquery) and
-- it is out and approved, or it's your own, or you unlocked it.
create policy episodes_read on public.episodes
  for select to authenticated
  using (
    (select public.is_adult()) and exists (
      select 1 from public.series s
      where s.id = episodes.series_id
        and (
          s.creator_id = (select auth.uid())
          or (episodes.status in ('published', 'closed_to_new') and episodes.moderation_status = 'approved')
          or exists (select 1 from public.episode_unlocks u
                     where u.user_id = (select auth.uid()) and u.episode_id = episodes.id)
        )
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Edits to approved series and episodes, waiting for review. One per target: a newer edit replaces
-- the fields it names and bumps the version. Only the owner can read them; everyone else keeps
-- seeing the approved version.
create table public.pending_edits (
  id bigint generated always as identity primary key,
  target text not null check (target in ('series', 'episode')),
  target_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null default 1,
  fields jsonb not null check (jsonb_typeof(fields) = 'object' and fields <> '{}'::jsonb),
  status text not null default 'pending' check (status in ('pending', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target, target_id)
);
create index pending_edits_queue_idx on public.pending_edits (updated_at) where status = 'pending';
revoke all on public.pending_edits from anon, authenticated;
grant select (target, target_id, version, fields, status, created_at, updated_at) on public.pending_edits to authenticated;
alter table public.pending_edits enable row level security;
create policy pending_edits_owner_read on public.pending_edits
  for select to authenticated using (owner_id = (select auth.uid()) and (select public.is_adult()));

-- ---------------------------------------------------------------------------------------------
-- Follows and watch progress: owner-only, written directly by the client.
create table public.follows (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  series_id uuid not null references public.series (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, series_id)
);
revoke all on public.follows from anon, authenticated;
grant select (user_id, series_id, created_at) on public.follows to authenticated;
grant insert (series_id) on public.follows to authenticated;
grant delete on public.follows to authenticated;
alter table public.follows enable row level security;
create policy follows_owner_read on public.follows for select to authenticated using (user_id = (select auth.uid()));
create policy follows_owner_insert on public.follows for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_adult())
              and exists (select 1 from public.series s where s.id = series_id));
create policy follows_owner_delete on public.follows for delete to authenticated using (user_id = (select auth.uid()));

create table public.watch_progress (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  episode_id uuid not null references public.episodes (id) on delete cascade,
  position_s smallint not null default 0 check (position_s between 0 and 120),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);
create trigger watch_progress_touch before update on public.watch_progress
  for each row execute function app_private.tg_touch_updated_at();
revoke all on public.watch_progress from anon, authenticated;
grant select (user_id, episode_id, position_s, completed, updated_at) on public.watch_progress to authenticated;
grant insert (episode_id, position_s, completed) on public.watch_progress to authenticated;
grant update (position_s, completed) on public.watch_progress to authenticated;
alter table public.watch_progress enable row level security;
create policy watch_progress_owner_read on public.watch_progress for select to authenticated using (user_id = (select auth.uid()));
create policy watch_progress_owner_insert on public.watch_progress for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_adult())
              and exists (select 1 from public.episodes e where e.id = episode_id));
create policy watch_progress_owner_update on public.watch_progress for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Triggers: search vector + tag array, and the moderation reset on content edits.
create function app_private.refresh_series_search(p_series uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.series s
  set tag_ids = coalesce((select array_agg(st.tag_id order by st.tag_id) from public.series_tags st where st.series_id = s.id), '{}'),
      fts = setweight(to_tsvector('simple', coalesce(s.title, '')), 'A')
         || setweight(to_tsvector('simple', coalesce((
              select string_agg(t.name_i18n ->> 'en', ' ')
              from public.series_tags st join public.tags t on t.id = st.tag_id
              where st.series_id = s.id), '')), 'B')
         || setweight(to_tsvector('simple', coalesce(s.synopsis, '')), 'C')
  where s.id = p_series;
end;
$$;
revoke all on function app_private.refresh_series_search(uuid) from public, anon, authenticated;

-- Set by app_private.apply_edit for the one update that applies a reviewed edit.
create function app_private.applying_edit() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(current_setting('reeltale.applying_edit', true), '') = 'on'
$$;
revoke all on function app_private.applying_edit() from public, anon, authenticated;

-- Reviewed fields of an approved series only change when a reviewed edit is applied. Before
-- approval, an edit sends the new version (back) to review.
create function app_private.tg_series_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.title, new.synopsis, new.cover_key, new.tag_ids) is distinct from (old.title, old.synopsis, old.cover_key, old.tag_ids)
       or (old.maturity = 'mature' and new.maturity = 'general') then
      if old.moderation_status = 'approved' then
        if not app_private.applying_edit() then
          raise exception 'edit_requires_review' using errcode = '42501';
        end if;
      elsif new.moderation_status is not distinct from old.moderation_status then
        new.moderation_status := 'pending';
      end if;
      new.content_version := old.content_version + 1;
    end if;
    if old.status = 'removed' and new.status <> 'removed' then
      raise exception 'series_removed' using errcode = '22023';
    end if;
    new.updated_at := now();
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app_private.tg_series_before_write() from public, anon, authenticated;
create trigger series_before_write before insert or update on public.series
  for each row execute function app_private.tg_series_before_write();

create function app_private.tg_series_after_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (new.title, new.synopsis) is distinct from (old.title, old.synopsis) then
    perform app_private.refresh_series_search(new.id);
  end if;
  return null;
end;
$$;
revoke all on function app_private.tg_series_after_write() from public, anon, authenticated;
create trigger series_after_write after insert or update of title, synopsis on public.series
  for each row execute function app_private.tg_series_after_write();

create function app_private.tg_series_tags_changed() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app_private.refresh_series_search(coalesce(new.series_id, old.series_id));
  return null;
end;
$$;
revoke all on function app_private.tg_series_tags_changed() from public, anon, authenticated;
create trigger series_tags_changed after insert or delete on public.series_tags
  for each row execute function app_private.tg_series_tags_changed();

create function app_private.tg_episode_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- An approved title only changes through a reviewed edit. Before approval the new title is part
    -- of the version under review (a rejection stays: rejected media needs a new upload).
    if new.title is distinct from old.title then
      if old.moderation_status = 'approved' and not app_private.applying_edit() then
        raise exception 'edit_requires_review' using errcode = '42501';
      end if;
      new.content_version := old.content_version + 1;
    end if;
    -- Removal is final: buyers were re-credited, so the episode must never come back.
    if old.status = 'removed' and new.status <> 'removed' then
      raise exception 'episode_removed' using errcode = '22023';
    end if;
    -- Once someone could have unlocked it, an episode can be closed or removed but never reset.
    if old.status in ('published', 'closed_to_new') and new.status not in ('published', 'closed_to_new', 'removed') then
      raise exception 'episode_cannot_be_unpublished' using errcode = '22023';
    end if;
    new.updated_at := now();
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app_private.tg_episode_before_write() from public, anon, authenticated;
create trigger episode_before_write before insert or update on public.episodes
  for each row execute function app_private.tg_episode_before_write();

-- ---------------------------------------------------------------------------------------------
-- Studio RPCs (creators). Creating content needs the upload-processing consent, because uploads go
-- through AI captioning and safety checks.

create function app_private.require_series_owner(p_series uuid) returns public.series
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_adult();
  v_row public.series;
begin
  select * into v_row from public.series where id = p_series for update;
  if not found or v_row.creator_id is distinct from v_uid then
    raise exception 'series_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'removed' then
    raise exception 'series_removed' using errcode = '22023';
  end if;
  return v_row;
end;
$$;
revoke all on function app_private.require_series_owner(uuid) from public, anon, authenticated;

create function app_private.check_tag_slugs(p_tag_slugs text[]) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if cardinality(p_tag_slugs) > 10 then
    raise exception 'too_many_tags' using errcode = '22023';
  end if;
  select count(*) into v_count from public.tags where slug = any (p_tag_slugs);
  if v_count <> (select count(distinct x) from unnest(p_tag_slugs) x) then
    raise exception 'unknown_tag' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app_private.check_tag_slugs(text[]) from public, anon, authenticated;

-- A series' tag slugs as a sorted JSON array (the form pending edits store them in).
create function app_private.series_tag_slugs(p_series uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(t.slug order by t.slug), '[]'::jsonb)
  from public.series_tags st join public.tags t on t.id = st.tag_id
  where st.series_id = p_series
$$;
revoke all on function app_private.series_tag_slugs(uuid) from public, anon, authenticated;

create function app_private.set_series_tags(p_series uuid, p_tag_slugs text[]) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_tag_slugs is null then
    return;
  end if;
  perform app_private.check_tag_slugs(p_tag_slugs);
  delete from public.series_tags where series_id = p_series;
  insert into public.series_tags (series_id, tag_id)
  select p_series, t.id from public.tags t where t.slug = any (p_tag_slugs);
end;
$$;
revoke all on function app_private.set_series_tags(uuid, text[]) from public, anon, authenticated;

create function app_private.slugify(p_title text) returns text
language sql volatile
set search_path = ''
as $$
  select left(nullif(trim(both '-' from regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g')), ''), 70)
         || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
$$;
revoke all on function app_private.slugify(text) from public, anon, authenticated;

create function public.studio_create_series(
  p_title text,
  p_synopsis text,
  p_format text,
  p_maturity text default 'general',
  p_language text default 'en',
  p_free_episode_count integer default 6,
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
revoke all on function public.studio_create_series(text, text, text, text, text, integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.studio_create_series(text, text, text, text, text, integer, integer, text[]) to authenticated;

-- Null arguments leave a field unchanged. Clearing the default price uses p_clear_default_price.
create function public.studio_update_series(
  p_series uuid,
  p_title text default null,
  p_synopsis text default null,
  p_maturity text default null,
  p_free_episode_count integer default null,
  p_default_price_coins integer default null,
  p_clear_default_price boolean default false,
  p_completed boolean default null,
  p_tag_slugs text[] default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.series := app_private.require_series_owner(p_series);
  v_set jsonb;
  v_edit public.pending_edits;
  v_fields jsonb;
begin
  if v_row.format = 'ai_generated' and not v_row.editors_pick and p_default_price_coins is not null then
    raise exception 'ai_series_free_until_editors_pick' using errcode = '22023';
  end if;
  if p_title is not null and char_length(btrim(p_title)) not between 1 and 80 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if p_synopsis is not null and char_length(p_synopsis) > 1000 then
    raise exception 'invalid_synopsis' using errcode = '22023';
  end if;
  if p_maturity is not null and p_maturity not in ('general', 'mature') then
    raise exception 'invalid_maturity' using errcode = '22023';
  end if;
  if p_tag_slugs is not null then
    perform app_private.check_tag_slugs(p_tag_slugs);
  end if;

  -- Not reviewed: pricing, free episodes, completion, and a general → mature change.
  update public.series
  set maturity = case when p_maturity = 'mature' then 'mature' else maturity end,
      free_episode_count = coalesce(p_free_episode_count, free_episode_count),
      default_price_coins = case when p_clear_default_price then null
                                 else coalesce(p_default_price_coins, default_price_coins) end,
      completed = coalesce(p_completed, completed)
  where id = p_series;

  if v_row.moderation_status <> 'approved' then
    -- Not public yet: edit in place; the new version goes (back) to review.
    update public.series
    set title = coalesce(btrim(p_title), title),
        synopsis = coalesce(p_synopsis, synopsis),
        maturity = coalesce(p_maturity, maturity)
    where id = p_series;
    perform app_private.set_series_tags(p_series, p_tag_slugs);
    return 'saved';
  end if;

  -- Approved: reviewed fields wait for review as a pending edit.
  v_set := jsonb_strip_nulls(jsonb_build_object(
    'title', btrim(p_title),
    'synopsis', p_synopsis,
    'maturity', case when p_maturity = 'general' then 'general' end,
    'tag_slugs', case when p_tag_slugs is not null then
                   coalesce((select jsonb_agg(distinct x order by x) from unnest(p_tag_slugs) x), '[]'::jsonb) end));
  select * into v_edit from public.pending_edits where target = 'series' and target_id = p_series for update;
  if v_set = '{}'::jsonb and p_maturity is distinct from 'mature' then
    return 'saved';
  end if;
  v_fields := case when v_edit.status = 'pending' then v_edit.fields else '{}'::jsonb end || v_set;
  -- Drop what equals the approved version (or no longer applies).
  if v_fields ->> 'title' = v_row.title then v_fields := v_fields - 'title'; end if;
  if v_fields ->> 'synopsis' = v_row.synopsis then v_fields := v_fields - 'synopsis'; end if;
  if v_fields ? 'maturity' and (p_maturity = 'mature' or v_row.maturity = 'general') then
    v_fields := v_fields - 'maturity';
  end if;
  if v_fields -> 'tag_slugs' = app_private.series_tag_slugs(p_series) then v_fields := v_fields - 'tag_slugs'; end if;

  if v_fields = '{}'::jsonb then
    delete from public.pending_edits where target = 'series' and target_id = p_series and status = 'pending';
    return 'saved';
  end if;
  if v_edit.id is null then
    insert into public.pending_edits (target, target_id, owner_id, fields) values ('series', p_series, v_row.creator_id, v_fields);
  elsif v_edit.status <> 'pending' or v_edit.fields is distinct from v_fields then
    update public.pending_edits set fields = v_fields, version = version + 1, status = 'pending', updated_at = now()
    where id = v_edit.id;
  end if;
  return 'awaiting_review';
end;
$$;
revoke all on function public.studio_update_series(uuid, text, text, text, integer, integer, boolean, boolean, text[]) from public, anon, authenticated;
grant execute on function public.studio_update_series(uuid, text, text, text, integer, integer, boolean, boolean, text[]) to authenticated;

-- Publish (visible once approved) or hide (no new viewers; buyers keep their episodes).
create function public.studio_set_series_status(p_series uuid, p_status text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.series := app_private.require_series_owner(p_series);
begin
  if p_status not in ('published', 'hidden') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.series set status = p_status where id = v_row.id;
end;
$$;
revoke all on function public.studio_set_series_status(uuid, text) from public, anon, authenticated;
grant execute on function public.studio_set_series_status(uuid, text) to authenticated;

create function public.studio_create_episode(
  p_series uuid,
  p_title text default '',
  p_price_coins integer default null,
  p_is_free boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.series := app_private.require_series_owner(p_series);
  v_next smallint;
  v_id uuid;
begin
  if v_row.format = 'ai_generated' and not v_row.editors_pick and p_price_coins is not null then
    raise exception 'ai_series_free_until_editors_pick' using errcode = '22023';
  end if;
  select coalesce(max(number), 0) + 1 into v_next from public.episodes where series_id = v_row.id;
  insert into public.episodes (series_id, number, title, price_coins, is_free)
  values (v_row.id, v_next, coalesce(p_title, ''), p_price_coins, coalesce(p_is_free, false))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.studio_create_episode(uuid, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.studio_create_episode(uuid, text, integer, boolean) to authenticated;

create function app_private.require_episode_owner(p_episode uuid) returns public.episodes
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_adult();
  v_ep public.episodes;
begin
  -- One error for "doesn't exist" and "not yours", so ids of other people's episodes can't be probed.
  select e.* into v_ep from public.episodes e join public.series s on s.id = e.series_id
  where e.id = p_episode and s.creator_id = v_uid and s.status <> 'removed'
  for update of e;
  if not found then
    raise exception 'episode_not_found' using errcode = 'P0002';
  end if;
  if v_ep.status = 'removed' then
    raise exception 'episode_removed' using errcode = '22023';
  end if;
  return v_ep;
end;
$$;
revoke all on function app_private.require_episode_owner(uuid) from public, anon, authenticated;

-- Price changes apply to future unlocks only; existing unlocks are untouched.
create function public.studio_update_episode(
  p_episode uuid,
  p_title text default null,
  p_price_coins integer default null,
  p_clear_price boolean default false,
  p_is_free boolean default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ep public.episodes := app_private.require_episode_owner(p_episode);
  v_series public.series;
  v_edit public.pending_edits;
begin
  select * into v_series from public.series where id = v_ep.series_id;
  if v_series.format = 'ai_generated' and not v_series.editors_pick and p_price_coins is not null then
    raise exception 'ai_series_free_until_editors_pick' using errcode = '22023';
  end if;
  if p_title is not null and char_length(p_title) > 80 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  update public.episodes
  set price_coins = case when p_clear_price then null else coalesce(p_price_coins, price_coins) end,
      is_free = coalesce(p_is_free, is_free)
  where id = v_ep.id;
  if p_title is null then
    return 'saved';
  end if;
  if v_ep.moderation_status <> 'approved' then
    update public.episodes set title = p_title where id = v_ep.id;
    return 'saved';
  end if;
  -- Approved: a new title waits for review.
  select * into v_edit from public.pending_edits where target = 'episode' and target_id = v_ep.id for update;
  if p_title = v_ep.title then
    delete from public.pending_edits where target = 'episode' and target_id = v_ep.id and status = 'pending';
    return 'saved';
  end if;
  if v_edit.id is null then
    insert into public.pending_edits (target, target_id, owner_id, fields)
    values ('episode', v_ep.id, v_series.creator_id, jsonb_build_object('title', p_title));
  elsif v_edit.status <> 'pending' or v_edit.fields ->> 'title' is distinct from p_title then
    update public.pending_edits
    set fields = jsonb_build_object('title', p_title), version = version + 1, status = 'pending', updated_at = now()
    where id = v_edit.id;
  end if;
  return 'awaiting_review';
end;
$$;
revoke all on function public.studio_update_episode(uuid, text, integer, boolean, boolean) from public, anon, authenticated;
grant execute on function public.studio_update_episode(uuid, text, integer, boolean, boolean) to authenticated;

-- Ask to publish a processed episode. It goes live as soon as moderation approves it.
create function public.studio_publish_episode(p_episode uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ep public.episodes := app_private.require_episode_owner(p_episode);
begin
  if v_ep.status in ('published', 'closed_to_new') then
    return v_ep.status;
  end if;
  if v_ep.status <> 'ready' then
    raise exception 'episode_not_ready' using errcode = '22023';
  end if;
  if v_ep.moderation_status = 'approved' then
    update public.episodes set status = 'published', publish_requested = false where id = v_ep.id;
    return 'published';
  end if;
  if v_ep.moderation_status = 'rejected' then
    raise exception 'episode_rejected' using errcode = '22023';
  end if;
  update public.episodes set publish_requested = true where id = v_ep.id;
  return 'awaiting_review';
end;
$$;
revoke all on function public.studio_publish_episode(uuid) from public, anon, authenticated;
grant execute on function public.studio_publish_episode(uuid) to authenticated;

-- Stop new unlocks. People who already unlocked the episode keep watching it.
create function public.studio_close_episode(p_episode uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ep public.episodes := app_private.require_episode_owner(p_episode);
begin
  if v_ep.status <> 'published' then
    raise exception 'episode_not_published' using errcode = '22023';
  end if;
  update public.episodes set status = 'closed_to_new' where id = v_ep.id;
end;
$$;
revoke all on function public.studio_close_episode(uuid) from public, anon, authenticated;
grant execute on function public.studio_close_episode(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Service RPCs (Worker)

-- May this user upload media for this episode? Returns the series format for the upload metadata.
create function svc.check_episode_upload(p_user uuid, p_episode uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_format text;
begin
  perform svc.require_service_role();
  if not app_private.is_live_adult(p_user) then
    raise exception 'upload_not_allowed' using errcode = '42501';
  end if;
  -- One live upload per episode: a draft, a processing episode whose upload URL has long expired
  -- (upload URLs live 30 minutes), or an episode whose media was rejected (it was never public).
  select s.format into v_format
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
  update public.episodes set status = 'processing' where id = p_episode;
  insert into app_private.episode_media (episode_id, pending_asset_id, pending_upload_at)
  values (p_episode, null, now())
  on conflict (episode_id) do update set pending_asset_id = null, pending_upload_at = now();
  return v_format;
end;
$$;
revoke all on function svc.check_episode_upload(uuid, uuid) from public, anon, authenticated;
grant execute on function svc.check_episode_upload(uuid, uuid) to service_role;

-- Remember which Stream upload belongs to the episode (right after the Worker created it).
create function svc.bind_episode_upload(p_episode uuid, p_asset_id text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  update app_private.episode_media m set pending_asset_id = p_asset_id
  from public.episodes e
  where m.episode_id = p_episode and e.id = m.episode_id and e.status = 'processing'
    and m.pending_upload_at > now() - interval '2 hours' and m.pending_asset_id is null;
  if not found then
    raise exception 'upload_not_pending' using errcode = '22023';
  end if;
end;
$$;
revoke all on function svc.bind_episode_upload(uuid, text) from public, anon, authenticated;
grant execute on function svc.bind_episode_upload(uuid, text) to service_role;

-- Stream says the video is ready (webhook verified by the Worker). Only the bound upload of a
-- draft/processing episode is accepted; anything else (a second or late upload, an approved or
-- published episode) is refused, so reviewed media can never be swapped.
create function svc.attach_episode_media(
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
begin
  perform svc.require_service_role();
  if p_duration_s is null or p_duration_s < 1 or p_duration_s > 120 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  perform 1 from public.episodes e
  join app_private.episode_media m on m.episode_id = e.id
  where e.id = p_episode and e.status in ('draft', 'processing')
    and m.pending_asset_id is not null and m.pending_asset_id = p_asset_id
  for update of e, m;
  if not found then
    raise exception 'episode_not_accepting_media' using errcode = '22023';
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

-- Apply a reviewed edit to its approved target (the only path that changes approved fields).
create function app_private.apply_edit(p_edit public.pending_edits) returns void
language plpgsql
set search_path = ''
as $$
declare
  f jsonb := p_edit.fields;
begin
  perform set_config('reeltale.applying_edit', 'on', true);
  if p_edit.target = 'series' then
    update public.series
    set title = coalesce(f ->> 'title', title),
        synopsis = coalesce(f ->> 'synopsis', synopsis),
        maturity = coalesce(f ->> 'maturity', maturity)
    where id = p_edit.target_id;
    if f ? 'tag_slugs' then
      perform app_private.set_series_tags(p_edit.target_id, array(select jsonb_array_elements_text(f -> 'tag_slugs')));
    end if;
  else
    update public.episodes set title = coalesce(f ->> 'title', title) where id = p_edit.target_id;
  end if;
  perform set_config('reeltale.applying_edit', 'off', true);
end;
$$;
revoke all on function app_private.apply_edit(public.pending_edits) from public, anon, authenticated;

-- Moderation verdict (automated check or editor). p_version is the version the reviewer saw.
--   'series', 'episode': the first review. An approval must be for the current content_version (and
--     an episode must have its media); a rejection applies to that version or anything newer. An
--     approved episode with a publish request goes live. Approved content is never rejected here:
--     takedowns are removals (svc.recredit_episode, svc.remove_series), which re-credit buyers.
--   'series_edit', 'episode_edit': an edit to approved content. An approval of the current edit
--     version applies it; a rejection marks the edit rejected and the approved version stays.
-- Returns 'applied', 'stale_verdict' (review the newer version) or 'not_applicable'.
create function svc.set_moderation(p_target text, p_id uuid, p_status text, p_version integer) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.series;
  e public.episodes;
  pe public.pending_edits;
begin
  perform svc.require_service_role();
  if p_status is null or p_status not in ('approved', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_version is null then
    raise exception 'invalid_version' using errcode = '22023';
  end if;

  if p_target = 'series' then
    select * into s from public.series where id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if s.status = 'removed' or s.moderation_status = 'approved' then
      return 'not_applicable';
    end if;
    if (p_status = 'approved' and s.content_version <> p_version) or s.content_version < p_version then
      return 'stale_verdict';
    end if;
    update public.series set moderation_status = p_status where id = p_id;
    return 'applied';

  elsif p_target = 'episode' then
    select * into e from public.episodes where id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if e.status = 'removed' or e.moderation_status = 'approved' then
      return 'not_applicable';
    end if;
    if (p_status = 'approved' and (e.content_version <> p_version or e.status <> 'ready')) or e.content_version < p_version then
      return 'stale_verdict';
    end if;
    update public.episodes
    set moderation_status = p_status,
        status = case when p_status = 'approved' and publish_requested then 'published' else status end,
        publish_requested = case when p_status = 'approved' then false else publish_requested end
    where id = p_id;
    return 'applied';

  elsif p_target in ('series_edit', 'episode_edit') then
    select * into pe from public.pending_edits
    where target = case p_target when 'series_edit' then 'series' else 'episode' end and target_id = p_id
    for update;
    if not found or pe.status <> 'pending' or pe.version < p_version
       or (p_status = 'approved' and pe.version <> p_version) then
      return 'stale_verdict';
    end if;
    if p_status = 'rejected' then
      update public.pending_edits set status = 'rejected', updated_at = now() where id = pe.id;
      return 'applied';
    end if;
    if pe.target = 'series' then
      perform 1 from public.series where id = p_id and status <> 'removed' and moderation_status = 'approved' for update;
    else
      perform 1 from public.episodes where id = p_id and status <> 'removed' and moderation_status = 'approved' for update;
    end if;
    if not found then
      delete from public.pending_edits where id = pe.id;
      return 'not_applicable';
    end if;
    perform app_private.apply_edit(pe);
    delete from public.pending_edits where id = pe.id;
    return 'applied';
  end if;
  raise exception 'invalid_target' using errcode = '22023';
end;
$$;
revoke all on function svc.set_moderation(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function svc.set_moderation(text, uuid, text, integer) to service_role;

-- Take a whole series down (moderation, copyright, account deletion): the series and its episodes
-- are removed for good. Returns the episodes with coin buyers; call svc.recredit_episode for each
-- until it returns 0.
create function svc.remove_series(p_series uuid) returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  perform 1 from public.series where id = p_series for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.series set status = 'removed' where id = p_series and status <> 'removed';
  update public.episodes set status = 'removed', publish_requested = false where series_id = p_series and status <> 'removed';
  delete from public.pending_edits pe
  where (pe.target = 'series' and pe.target_id = p_series)
     or (pe.target = 'episode' and pe.target_id in (select id from public.episodes where series_id = p_series));
  return array(select distinct u.episode_id
               from public.episode_unlocks u join public.episodes e on e.id = u.episode_id
               where e.series_id = p_series and u.source = 'coins' and u.txn_id is not null
               order by u.episode_id);
end;
$$;
revoke all on function svc.remove_series(uuid) from public, anon, authenticated;
grant execute on function svc.remove_series(uuid) to service_role;
