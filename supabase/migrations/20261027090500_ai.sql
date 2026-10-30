-- AI interactive stories: stories, scenes (a flat branch tree), jobs, budgets, and the audit log of
-- every model call (EU AI Act record keeping; also feeds "How this scene was made").
--
-- Flow (the Worker drives it; see apps/server/src/workflows/story-scene.ts):
--   svc.ai_start_story / svc.ai_choose  → story/scene + job + coin hold, in one transaction
--   svc.ai_reserve (before each paid call, idempotent per step) → job and daily budget
--   svc.ai_log_generation (after each call)
--   svc.ai_scene_ready → capture the hold   |   svc.ai_job_failed → release it (refund)
--   svc.ai_sweep_stale (cron) → fail and refund jobs whose Workflow stopped reporting

insert into public.pricing_config (key, value) values
  ('ai_daily_cap_micros', '20000000'),       -- $20 of model spend per day, whole platform (circuit breaker)
  ('ai_job_budget_micros', '250000'),        -- per scene job
  ('ai_stories_per_day', '10'),              -- per user
  ('ai_scenes_per_day', '80')                -- per user
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
create table public.ai_stories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  premise text not null check (char_length(premise) between 20 and 1000),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  mode text not null default 'comic' check (mode in ('comic', 'video')),
  title text,
  bible jsonb,
  arc jsonb,
  sheets jsonb not null default '{}'::jsonb,
  status text not null default 'planning' check (status in ('planning', 'active', 'completed', 'failed', 'blocked')),
  visibility text not null default 'private' check (visibility in ('private', 'published')),
  published_series_id uuid references public.series (id) on delete set null,
  -- The app's id for the tap that started the story: a retried request finds the same story.
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint one_story_per_request unique (owner_id, request_id)
);
create index ai_stories_owner_idx on public.ai_stories (owner_id, created_at desc);
create trigger ai_stories_touch before update on public.ai_stories
  for each row execute function app_private.tg_touch_updated_at();
revoke all on public.ai_stories from anon, authenticated;
grant select (id, owner_id, premise, tags, mode, title, status, visibility, published_series_id, created_at, updated_at)
  on public.ai_stories to authenticated;
alter table public.ai_stories enable row level security;
create policy ai_stories_owner_read on public.ai_stories
  for select to authenticated using (owner_id = (select auth.uid()));

create table public.ai_scenes (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.ai_stories (id) on delete cascade,
  parent_scene_id uuid references public.ai_scenes (id) on delete cascade,
  chosen_choice text check (chosen_choice in ('a', 'b', 'c')),
  depth smallint not null default 1 check (depth between 1 and 30),
  status text not null default 'queued' check (status in ('queued', 'generating', 'ready', 'failed', 'blocked')),
  title text,
  is_ending boolean not null default false,
  manifest_key text,
  created_at timestamptz not null default now(),
  constraint root_or_child check ((parent_scene_id is null) = (chosen_choice is null)),
  constraint one_scene_per_choice unique nulls not distinct (story_id, parent_scene_id, chosen_choice)
);
revoke all on public.ai_scenes from anon, authenticated;
grant select (id, story_id, parent_scene_id, chosen_choice, depth, status, title, is_ending, created_at)
  on public.ai_scenes to authenticated;
alter table public.ai_scenes enable row level security;
create policy ai_scenes_owner_read on public.ai_scenes
  for select to authenticated
  using (exists (select 1 from public.ai_stories s where s.id = story_id and s.owner_id = (select auth.uid())));

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  story_id uuid not null references public.ai_stories (id) on delete cascade,
  scene_id uuid not null references public.ai_scenes (id) on delete cascade,
  kind text not null check (kind in ('story_start', 'scene')),
  lane text not null default 'scene' check (lane in ('scene', 'prefetch', 'video')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  progress text,
  hold_txn bigint,
  budget_micros integer not null check (budget_micros > 0),
  spent_micros integer not null default 0 check (spent_micros >= 0),
  error_code text,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint within_budget check (spent_micros <= budget_micros)
);
-- One foreground scene job per story, one video job per user at a time.
create unique index ai_jobs_one_scene_per_story on public.ai_jobs (story_id) where lane = 'scene' and status in ('queued', 'running');
create unique index ai_jobs_one_video_per_user on public.ai_jobs (user_id) where lane = 'video' and status in ('queued', 'running');
-- A failed scene can be retried with a new job; otherwise one job per scene.
create unique index ai_jobs_one_per_scene on public.ai_jobs (scene_id) where status <> 'failed';
create index ai_jobs_stale_idx on public.ai_jobs (heartbeat_at) where status in ('queued', 'running');
revoke all on public.ai_jobs from anon, authenticated;
grant select (id, story_id, scene_id, kind, lane, status, progress, error_code, created_at, finished_at)
  on public.ai_jobs to authenticated;
alter table public.ai_jobs enable row level security;
create policy ai_jobs_owner_read on public.ai_jobs
  for select to authenticated using (user_id = (select auth.uid()));

-- Every model call, success or failure. Append-only; kept for the audit trail.
create table app_private.ai_generations (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  user_id uuid not null,
  task text not null,
  provider text not null,
  model text not null,
  cost_micros integer not null check (cost_micros >= 0),
  latency_ms integer not null check (latency_ms >= 0),
  ok boolean not null,
  error_code text,
  output_key text,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
create index ai_generations_job_idx on app_private.ai_generations (job_id);
create trigger ai_generations_append_only before update or delete on app_private.ai_generations
  for each row execute function app_private.tg_forbid_mutation();

create table app_private.ai_reservations (
  job_id uuid not null,
  step text not null check (char_length(step) <= 60),
  micros integer not null check (micros > 0),
  created_at timestamptz not null default now(),
  primary key (job_id, step)
);

create table app_private.ai_budget_daily (
  day date primary key,
  spent_micros bigint not null default 0 check (spent_micros >= 0)
);

-- ---------------------------------------------------------------------------------------------
-- Helpers

-- Per-user daily caps on story starts and scenes (counted from the jobs table, under the wallet lock).
create function app_private.ai_check_daily_caps(p_user uuid, p_kind text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.ai_jobs j
  where j.user_id = p_user and j.kind = p_kind and j.created_at > now() - interval '1 day';
  if (p_kind = 'story_start' and v_n >= app_private.cfg_int('ai_stories_per_day', 10))
     or (p_kind = 'scene' and v_n >= app_private.cfg_int('ai_scenes_per_day', 80)) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
end;
$$;
revoke all on function app_private.ai_check_daily_caps(uuid, text) from public, anon, authenticated;

create function app_private.require_story_consent(p_user uuid) returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not app_private.has_ai_consent(p_user, 'story', 'meta') then
    raise exception 'ai_consent_required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.require_story_consent(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Service RPCs

-- Start a story: story + root scene + job + coin hold, atomically. The premise is moderated by the
-- Workflow's first step (a blocked premise fails the job, which refunds the hold).
-- p_request_id (from the app, one per tap) makes retries safe: the same id returns the same story, job
-- and hold instead of charging again.
create function svc.ai_start_story(p_user uuid, p_premise text, p_tags text[], p_mode text,
                                   p_request_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story uuid;
  v_scene uuid;
  v_job uuid;
  v_hold jsonb;
begin
  perform svc.require_service_role();
  if not app_private.is_live_adult(p_user) then
    raise exception 'not_adult' using errcode = '42501';
  end if;
  perform app_private.require_story_consent(p_user);
  if p_mode is distinct from 'comic' then
    raise exception 'mode_unavailable' using errcode = '22023';   -- video mode ships after QA
  end if;
  perform app_private.lock_wallet(p_user);
  if p_request_id is not null then
    -- The wallet lock serialises this user's starts, so a concurrent retry waits and then finds the story.
    select s.id into v_story from public.ai_stories s where s.owner_id = p_user and s.request_id = p_request_id;
    if v_story is not null then
      select sc.id into v_scene from public.ai_scenes sc where sc.story_id = v_story and sc.parent_scene_id is null;
      select j.id into v_job from public.ai_jobs j where j.scene_id = v_scene order by j.created_at desc limit 1;
      return jsonb_build_object('story_id', v_story, 'scene_id', v_scene, 'job_id', v_job, 'existing', true);
    end if;
  end if;
  perform app_private.ai_check_daily_caps(p_user, 'story_start');

  insert into public.ai_stories (owner_id, premise, tags, mode, request_id)
  values (p_user, btrim(p_premise), coalesce(p_tags, '{}'), p_mode, p_request_id)
  returning id into v_story;
  insert into public.ai_scenes (story_id, depth) values (v_story, 1) returning id into v_scene;
  insert into public.ai_jobs (user_id, story_id, scene_id, kind, lane, budget_micros)
  values (p_user, v_story, v_scene, 'story_start', 'scene', app_private.cfg_int('ai_job_budget_micros', 250000) * 2)
  returning id into v_job;

  v_hold := svc.ai_hold(p_user, 'story:' || v_story, app_private.cfg_int('ai_story_start_coins', 50),
                        jsonb_build_object('story_id', v_story, 'job_id', v_job));
  update public.ai_jobs set hold_txn = (v_hold ->> 'hold_txn')::bigint where id = v_job;
  return jsonb_build_object('story_id', v_story, 'scene_id', v_scene, 'job_id', v_job, 'existing', false);
end;
$$;
revoke all on function svc.ai_start_story(uuid, text, text[], text, uuid) from public, anon, authenticated;
grant execute on function svc.ai_start_story(uuid, text, text[], text, uuid) to service_role;

-- The reader picked a choice: child scene + job + hold. Choosing the same option again returns the
-- existing scene and job (double taps and retries are free). A scene whose job failed (and was
-- refunded) is retried with a new job and hold; a blocked scene stays blocked.
create function svc.ai_choose(p_user uuid, p_parent_scene uuid, p_choice text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.ai_scenes;
  st public.ai_stories;
  v_scene uuid;
  v_status text;
  v_job uuid;
  v_hold jsonb;
begin
  perform svc.require_service_role();
  if p_choice not in ('a', 'b', 'c') then
    raise exception 'invalid_choice' using errcode = '22023';
  end if;
  if not app_private.is_live_adult(p_user) then
    raise exception 'not_adult' using errcode = '42501';
  end if;
  perform app_private.require_story_consent(p_user);
  select * into p from public.ai_scenes where id = p_parent_scene;
  select * into st from public.ai_stories where id = p.story_id for update;
  if not found or st.owner_id <> p_user then
    raise exception 'scene_not_found' using errcode = 'P0002';
  end if;
  if p.status <> 'ready' or p.is_ending or st.status <> 'active' then
    raise exception 'scene_not_continuable' using errcode = '22023';
  end if;

  select s.id, s.status into v_scene, v_status from public.ai_scenes s
  where s.story_id = st.id and s.parent_scene_id = p_parent_scene and s.chosen_choice = p_choice;
  if v_scene is not null and v_status <> 'failed' then
    select j.id into v_job from public.ai_jobs j where j.scene_id = v_scene order by j.created_at desc limit 1;
    return jsonb_build_object('story_id', st.id, 'scene_id', v_scene, 'job_id', v_job, 'existing', true,
                              'status', v_status);
  end if;
  if exists (select 1 from public.ai_jobs j
             where j.story_id = st.id and j.lane = 'scene' and j.status in ('queued', 'running')) then
    raise exception 'scene_in_progress' using errcode = '55P03';
  end if;

  perform app_private.lock_wallet(p_user);
  perform app_private.ai_check_daily_caps(p_user, 'scene');
  if v_scene is null then
    insert into public.ai_scenes (story_id, parent_scene_id, chosen_choice, depth)
    values (st.id, p_parent_scene, p_choice, p.depth + 1)
    returning id into v_scene;
  else
    update public.ai_scenes set status = 'queued' where id = v_scene;
  end if;
  insert into public.ai_jobs (user_id, story_id, scene_id, kind, lane, budget_micros)
  values (p_user, st.id, v_scene, 'scene', 'scene', app_private.cfg_int('ai_job_budget_micros', 250000))
  returning id into v_job;
  -- The first attempt's key is per scene; a retry's is per job, because the first hold was released.
  v_hold := svc.ai_hold(p_user, 'scene:' || v_scene || case when v_status = 'failed' then ':' || v_job else '' end,
                        app_private.cfg_int('ai_comic_scene_coins', 30),
                        jsonb_build_object('story_id', st.id, 'scene_id', v_scene, 'job_id', v_job));
  update public.ai_jobs set hold_txn = (v_hold ->> 'hold_txn')::bigint where id = v_job;
  return jsonb_build_object('story_id', st.id, 'scene_id', v_scene, 'job_id', v_job, 'existing', false,
                            'status', 'queued');
end;
$$;
revoke all on function svc.ai_choose(uuid, uuid, text) from public, anon, authenticated;
grant execute on function svc.ai_choose(uuid, uuid, text) to service_role;

-- Reserve budget for one paid step before calling the model. Idempotent per (job, step): a Workflow
-- retry of the same step doesn't reserve twice. Fails closed when the job or the day is out of budget.
create function svc.ai_reserve(p_job uuid, p_step text, p_micros integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.ai_jobs;
  v_day date := (now() at time zone 'utc')::date;
  v_cap bigint := app_private.cfg_int('ai_daily_cap_micros', 20000000);
begin
  perform svc.require_service_role();
  if p_micros is null or p_micros <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  select * into j from public.ai_jobs where id = p_job for update;
  if not found or j.status not in ('queued', 'running') then
    raise exception 'job_not_running' using errcode = '22023';
  end if;
  if exists (select 1 from app_private.ai_reservations r where r.job_id = p_job and r.step = p_step) then
    return;
  end if;
  if j.spent_micros + p_micros > j.budget_micros then
    raise exception 'job_budget_exceeded' using errcode = '54000';
  end if;
  insert into app_private.ai_budget_daily (day) values (v_day) on conflict (day) do nothing;
  update app_private.ai_budget_daily set spent_micros = spent_micros + p_micros
  where day = v_day and spent_micros + p_micros <= v_cap;
  if not found then
    raise exception 'daily_budget_exceeded' using errcode = '54000';
  end if;
  insert into app_private.ai_reservations (job_id, step, micros) values (p_job, p_step, p_micros);
  update public.ai_jobs set spent_micros = spent_micros + p_micros, status = 'running', heartbeat_at = now()
  where id = p_job;
end;
$$;
revoke all on function svc.ai_reserve(uuid, text, integer) from public, anon, authenticated;
grant execute on function svc.ai_reserve(uuid, text, integer) to service_role;

create function svc.ai_log_generation(
  p_job uuid, p_task text, p_provider text, p_model text, p_cost_micros integer, p_latency_ms integer,
  p_ok boolean, p_error_code text, p_output_key text, p_prompt_version text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform svc.require_service_role();
  select j.user_id into v_user from public.ai_jobs j where j.id = p_job;
  if v_user is null then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  insert into app_private.ai_generations (job_id, user_id, task, provider, model, cost_micros, latency_ms, ok, error_code,
                                          output_key, prompt_version)
  values (p_job, v_user, left(p_task, 60), left(p_provider, 30), left(p_model, 60), greatest(p_cost_micros, 0),
          greatest(p_latency_ms, 0), p_ok, left(p_error_code, 60), left(p_output_key, 300), left(p_prompt_version, 40));
  update public.ai_jobs set heartbeat_at = now() where id = p_job;
end;
$$;
revoke all on function svc.ai_log_generation(uuid, text, text, text, integer, integer, boolean, text, text, text) from public, anon, authenticated;
grant execute on function svc.ai_log_generation(uuid, text, text, text, integer, integer, boolean, text, text, text) to service_role;

create function svc.ai_progress(p_job uuid, p_progress text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  update public.ai_jobs set progress = left(p_progress, 80), heartbeat_at = now(), status = 'running'
  where id = p_job and status in ('queued', 'running');
end;
$$;
revoke all on function svc.ai_progress(uuid, text) from public, anon, authenticated;
grant execute on function svc.ai_progress(uuid, text) to service_role;

-- The scene is drawn, checked and its manifest stored: deliver it and capture the coins.
create function svc.ai_scene_ready(
  p_job uuid, p_title text, p_is_ending boolean, p_manifest_key text, p_bible jsonb, p_arc jsonb, p_sheets jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.ai_jobs;
begin
  perform svc.require_service_role();
  select * into j from public.ai_jobs where id = p_job for update;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  if j.status = 'succeeded' then
    return jsonb_build_object('status', 'already_ready');
  end if;
  if j.status = 'failed' then
    raise exception 'job_already_failed' using errcode = '22023';
  end if;
  update public.ai_scenes set status = 'ready', title = left(p_title, 60), is_ending = coalesce(p_is_ending, false),
         manifest_key = p_manifest_key
  where id = j.scene_id;
  update public.ai_stories
  set status = case when coalesce(p_is_ending, false) then 'completed' else 'active' end,
      bible = coalesce(p_bible, bible), arc = coalesce(p_arc, arc), sheets = coalesce(p_sheets, sheets),
      title = coalesce(title, p_bible ->> 'title')
  where id = j.story_id;
  update public.ai_jobs set status = 'succeeded', finished_at = now(), progress = 'ready' where id = p_job;
  if j.hold_txn is not null then
    perform svc.ai_settle(j.user_id, j.hold_txn, true);
  end if;
  return jsonb_build_object('status', 'ready');
end;
$$;
revoke all on function svc.ai_scene_ready(uuid, text, boolean, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function svc.ai_scene_ready(uuid, text, boolean, text, jsonb, jsonb, jsonb) to service_role;

-- The job failed or was blocked: refund the coins. A failed first scene fails the story.
create function svc.ai_job_failed(p_job uuid, p_error_code text, p_blocked boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.ai_jobs;
begin
  perform svc.require_service_role();
  select * into j from public.ai_jobs where id = p_job for update;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  if j.status in ('succeeded', 'failed') then
    return jsonb_build_object('status', 'already_finished');
  end if;
  update public.ai_jobs set status = 'failed', finished_at = now(), error_code = left(p_error_code, 60) where id = p_job;
  update public.ai_scenes set status = case when p_blocked then 'blocked' else 'failed' end where id = j.scene_id;
  if j.kind = 'story_start' then
    update public.ai_stories set status = case when p_blocked then 'blocked' else 'failed' end where id = j.story_id;
  end if;
  if j.hold_txn is not null then
    perform svc.ai_settle(j.user_id, j.hold_txn, false);
  end if;
  return jsonb_build_object('status', 'refunded');
end;
$$;
revoke all on function svc.ai_job_failed(uuid, text, boolean) from public, anon, authenticated;
grant execute on function svc.ai_job_failed(uuid, text, boolean) to service_role;

-- Cron: jobs whose Workflow stopped reporting are failed and refunded.
create function svc.ai_sweep_stale(p_minutes integer default 15) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j record;
  v_count integer := 0;
begin
  perform svc.require_service_role();
  for j in
    select id from public.ai_jobs
    where status in ('queued', 'running') and heartbeat_at < now() - make_interval(mins => greatest(p_minutes, 5))
    order by heartbeat_at
    limit 200
  loop
    perform svc.ai_job_failed(j.id, 'stale', false);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function svc.ai_sweep_stale(integer) from public, anon, authenticated;
grant execute on function svc.ai_sweep_stale(integer) to service_role;

-- What the Workflow needs to write a scene: the story, the path so far, and the choice taken.
create function svc.ai_job_context(p_job uuid) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  j public.ai_jobs;
  st public.ai_stories;
  sc public.ai_scenes;
  v_choice_label text;
begin
  perform svc.require_service_role();
  select * into j from public.ai_jobs where id = p_job;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  select * into st from public.ai_stories where id = j.story_id;
  select * into sc from public.ai_scenes where id = j.scene_id;
  return jsonb_build_object(
    'job', jsonb_build_object('id', j.id, 'kind', j.kind, 'status', j.status, 'user_id', j.user_id),
    'story', jsonb_build_object('id', st.id, 'premise', st.premise, 'tags', st.tags, 'mode', st.mode, 'bible', st.bible,
                                'arc', st.arc, 'sheets', st.sheets),
    'scene', jsonb_build_object('id', sc.id, 'depth', sc.depth, 'chosen_choice', sc.chosen_choice),
    'path', coalesce((
      with recursive chain as (
        select s.id, s.parent_scene_id, s.title, s.manifest_key, s.chosen_choice, s.depth
        from public.ai_scenes s where s.id = sc.parent_scene_id
        union all
        select p.id, p.parent_scene_id, p.title, p.manifest_key, p.chosen_choice, p.depth
        from public.ai_scenes p join chain c on p.id = c.parent_scene_id
      )
      select jsonb_agg(jsonb_build_object('scene_id', id, 'title', title, 'manifest_key', manifest_key,
                                          'chosen_choice', chosen_choice) order by depth)
      from chain), '[]'::jsonb)
  );
end;
$$;
revoke all on function svc.ai_job_context(uuid) from public, anon, authenticated;
grant execute on function svc.ai_job_context(uuid) to service_role;

-- May this user read this scene's manifest? (Owner only until stories can be published.)
create function svc.ai_scene_access(p_user uuid, p_scene uuid) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  perform svc.require_service_role();
  if not app_private.is_live_adult(p_user) then
    return jsonb_build_object('allowed', false, 'reason', 'not_adult');
  end if;
  select sc.manifest_key into v_key
  from public.ai_scenes sc join public.ai_stories st on st.id = sc.story_id
  where sc.id = p_scene and st.owner_id = p_user and sc.status = 'ready';
  if v_key is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_available');
  end if;
  return jsonb_build_object('allowed', true, 'manifest_key', v_key);
end;
$$;
revoke all on function svc.ai_scene_access(uuid, uuid) from public, anon, authenticated;
grant execute on function svc.ai_scene_access(uuid, uuid) to service_role;
