-- Trust & safety: reports (in-app and logged-out notices), blocks, statements of reasons, editor tools.
--
-- App Store guideline 1.2 (user-generated content) asks for a way to report content, a way to block abusive
-- users and timely action. The EU Digital Services Act asks for a notice form anyone can use, logged out too
-- (Art. 16), and a statement of reasons for every decision that restricts content (Art. 17).
--
-- - Signed-in adults report with public.report_content. Logged-out notices come through the Worker
--   (Origin check, Turnstile, hashed IP) into svc.submit_notice. Reporters read the status of their own
--   reports; who reported what is never visible to the reported user or anyone else but editors.
-- - Blocks are one-way and private: the blocker stops seeing the blocked account's profile and series.
--   Episodes they bought stay theirs (the buyer branch of series_read ignores blocks).
-- - Editors act through svc functions the Worker calls after svc.editor_role says the caller is one. Every
--   editor action writes a row to the append-only app_private.moderation_actions (the statement of reasons).
--   First-review verdicts keep their own log (app_private.moderation_verdicts, svc.record_verdict).

insert into public.pricing_config (key, value) values
  ('reports_per_day', '20'),               -- in-app reports per user
  ('notices_per_ip_per_day', '10')         -- logged-out notices per hashed IP (the hash changes every day)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Reports. Never deleted: they are part of the moderation record. The reason list is repeated in
-- app_private.check_report (keep both in step).
create table public.reports (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('series', 'episode', 'ai_scene', 'profile')),
  target_id uuid not null,
  reason text not null check (reason in ('minor_safety', 'sexual_content', 'violence', 'hate_harassment', 'self_harm',
                                         'spam_scam', 'copyright', 'impersonation', 'ai_not_labelled', 'illegal_other',
                                         'other')),
  details text check (char_length(details) <= 2000),
  source text not null check (source in ('user', 'notice')),
  -- Null for notices, and once the reporter's account is deleted (the report itself stays).
  reporter_id uuid references public.profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_at timestamptz,
  resolved_by uuid,                     -- the editor; no foreign key, the record outlives accounts
  created_at timestamptz not null default now(),
  constraint notices_have_no_reporter check (source = 'user' or reporter_id is null),
  constraint resolved_when_closed check ((status = 'open') = (resolved_at is null))
);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc) where reporter_id is not null;
create unique index reports_one_open_per_reporter on public.reports (reporter_id, target_type, target_id)
  where status = 'open' and reporter_id is not null;
create index reports_open_target_idx on public.reports (target_type, target_id) where status = 'open';

-- Reporters read their own reports (status included). The reporter and the editor columns are never
-- granted, so a report can't be traced back through PostgREST.
revoke all on public.reports from anon, authenticated;
grant select (id, target_type, target_id, reason, details, status, created_at, resolved_at) on public.reports to authenticated;
alter table public.reports enable row level security;
create policy reports_reporter_read on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()));

-- Contact details of logged-out notifiers (for the acknowledgement and the decision, DSA Art. 16(4)-(5)) and
-- the hashed IP the daily cap counts. The Worker hashes the IP with a key that changes every day, so
-- the raw address is never stored and hashes from different days can't be linked.
create table app_private.report_notices (
  report_id bigint primary key references public.reports (id),
  notifier_name text check (char_length(notifier_name) <= 100),
  notifier_email text check (char_length(notifier_email) <= 254),
  ip_hash text check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  contact_purged_at timestamptz
);
create index report_notices_ip_idx on app_private.report_notices (ip_hash, created_at) where ip_hash is not null;
revoke all on app_private.report_notices from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Blocks: owner-only, written through RPCs. Policies on other tables read them, so the caller needs
-- SELECT on the two id columns.
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);
revoke all on public.blocks from anon, authenticated;
grant select (blocker_id, blocked_id, created_at) on public.blocks to authenticated;
alter table public.blocks enable row level security;
create policy blocks_owner_read on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Statements of reasons (DSA Art. 17): one row per editor action. What was decided, on which ground
-- (the law or the Terms) and reference, the facts, whether it was automated, who decided, and which
-- reports led to it. Append-only, even for the owner role.
create table app_private.moderation_actions (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('series', 'episode', 'ai_scene', 'profile')),
  target_id uuid not null,
  action text not null check (action in ('take_down', 'reports_dismissed', 'editors_pick_on', 'editors_pick_off')),
  ground text check (ground in ('legal', 'terms')),
  reference text check (char_length(reference) between 1 and 200),
  facts text not null check (char_length(btrim(facts)) between 1 and 2000),
  automated boolean not null default false,
  editor_id uuid,                       -- no foreign key: the record outlives the editor's account
  report_ids bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint takedowns_state_their_ground check (action <> 'take_down' or (ground is not null and reference is not null)),
  constraint manual_actions_name_the_editor check (automated or editor_id is not null)
);
create index moderation_actions_target_idx on app_private.moderation_actions (target_type, target_id, created_at);
revoke all on app_private.moderation_actions from public, anon, authenticated;
create trigger moderation_actions_append_only before update or delete on app_private.moderation_actions
  for each row execute function app_private.tg_forbid_mutation();
create trigger moderation_actions_no_truncate before truncate on app_private.moderation_actions
  for each statement execute function app_private.tg_forbid_mutation();

-- ---------------------------------------------------------------------------------------------
-- Catalog visibility with blocks. Same conditions as before (catalog migration), plus: a series by
-- someone you blocked is no longer listed. The buyer branch is unchanged on purpose, so a blocker keeps
-- the series of episodes they unlocked, and with it the episodes (episodes_read checks the series).
drop policy series_read on public.series;
create policy series_read on public.series
  for select to authenticated
  using (
    (select public.is_adult()) and (
      creator_id = (select auth.uid())
      or (
        public.creator_is_live(creator_id)
        and (maturity = 'general' or (select public.my_mature_opt_in()))
        and (
          (status = 'published' and moderation_status = 'approved'
           and not exists (select 1 from public.blocks b
                           where b.blocker_id = (select auth.uid()) and b.blocked_id = series.creator_id))
          -- buyers keep a hidden series (approval is never withdrawn; takedowns remove)
          or (status <> 'removed' and moderation_status = 'approved' and public.has_unlock_in_series(id))
        )
      )
    )
  );

-- Profiles: same as before, and someone you blocked isn't listed for you. (Service paths have no
-- auth.uid(), so nothing changes there.)
create or replace function public.profile_is_listed(p_user uuid) returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select app_private.is_live_adult(p_user)
     and not exists (select 1 from public.blocks b where b.blocker_id = (select auth.uid()) and b.blocked_id = p_user)
$$;
revoke all on function public.profile_is_listed(uuid) from public, anon, authenticated;
grant execute on function public.profile_is_listed(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers

-- Raises on a bad target type, reason or details.
create function app_private.check_report(p_target_type text, p_reason text, p_details text) returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_target_type is null or p_target_type not in ('series', 'episode', 'ai_scene', 'profile') then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('minor_safety', 'sexual_content', 'violence', 'hate_harassment', 'self_harm',
                                          'spam_scam', 'copyright', 'impersonation', 'ai_not_labelled', 'illegal_other',
                                          'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if char_length(p_details) > 2000 then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app_private.check_report(text, text, text) from public, anon, authenticated;

-- Can this be reported? It must exist and be something people could have seen: approved, not removed
-- series and episodes, a live adult's profile, an AI scene of the reporter's own story (or of a
-- published one). p_user is null for logged-out notices. One answer for "doesn't exist" and "can't be
-- reported", so ids of unpublished content can't be probed.
create function app_private.reportable(p_target_type text, p_target_id uuid, p_user uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select case p_target_type
    when 'series' then exists (
      select 1 from public.series s
      where s.id = p_target_id and s.status <> 'removed' and s.moderation_status = 'approved')
    when 'episode' then exists (
      select 1 from public.episodes e join public.series s on s.id = e.series_id
      where e.id = p_target_id and e.status <> 'removed' and e.moderation_status = 'approved' and s.status <> 'removed')
    when 'ai_scene' then exists (
      select 1 from public.ai_scenes sc join public.ai_stories st on st.id = sc.story_id
      where sc.id = p_target_id and (st.owner_id = p_user or st.visibility = 'published'))
    when 'profile' then app_private.is_live_adult(p_target_id)
    else false
  end
$$;
revoke all on function app_private.reportable(text, uuid, uuid) from public, anon, authenticated;

-- Raises unless p_editor is an editor or admin with a live adult account.
create function app_private.require_editor(p_editor uuid) returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = p_editor and p.role in ('editor', 'admin'))
     or not app_private.is_live_adult(p_editor) then
    raise exception 'not_an_editor' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.require_editor(uuid) from public, anon, authenticated;

-- Whose is it? The creator of a series or episode, the owner of an AI scene's story, the profile itself.
create function app_private.target_owner(p_target_type text, p_target_id uuid) returns uuid
language sql stable
set search_path = ''
as $$
  select case p_target_type
    when 'series' then (select s.creator_id from public.series s where s.id = p_target_id)
    when 'episode' then (select s.creator_id from public.episodes e join public.series s on s.id = e.series_id
                         where e.id = p_target_id)
    when 'ai_scene' then (select st.owner_id from public.ai_scenes sc join public.ai_stories st on st.id = sc.story_id
                          where sc.id = p_target_id)
    when 'profile' then p_target_id
  end
$$;
revoke all on function app_private.target_owner(text, uuid) from public, anon, authenticated;

-- Close the open reports about these targets; returns their ids.
create function app_private.resolve_reports(p_target_type text, p_target_ids uuid[], p_status text, p_editor uuid)
returns bigint[]
language sql
set search_path = ''
as $$
  with closed as (
    update public.reports r set status = p_status, resolved_at = now(), resolved_by = p_editor
    where r.target_type = p_target_type and r.target_id = any (p_target_ids) and r.status = 'open'
    returning r.id
  )
  select coalesce(array_agg(c.id order by c.id), '{}') from closed c
$$;
revoke all on function app_private.resolve_reports(text, uuid[], text, uuid) from public, anon, authenticated;

-- Which of these episodes still have coin buyers waiting to be re-credited (svc.recredit_episode's
-- idempotency key marks the ones already done).
create function app_private.episodes_awaiting_recredit(p_episodes uuid[]) returns uuid[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct u.episode_id order by u.episode_id), '{}')
  from public.episode_unlocks u
  where u.episode_id = any (p_episodes) and u.source = 'coins' and u.txn_id is not null
    and not exists (select 1 from ledger.transactions t where t.idempotency_key = 'recredit:' || u.txn_id)
$$;
revoke all on function app_private.episodes_awaiting_recredit(uuid[]) from public, anon, authenticated;

-- What an editor needs to recognise a reported target.
create function app_private.report_target_summary(p_target_type text, p_target_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select case p_target_type
    when 'series' then (
      select jsonb_build_object('title', s.title, 'status', s.status, 'moderation_status', s.moderation_status,
                                'creator_id', s.creator_id, 'editors_pick', s.editors_pick)
      from public.series s where s.id = p_target_id)
    when 'episode' then (
      select jsonb_build_object('title', e.title, 'number', e.number, 'status', e.status, 'series_id', e.series_id,
                                'series_title', s.title, 'creator_id', s.creator_id)
      from public.episodes e join public.series s on s.id = e.series_id where e.id = p_target_id)
    when 'ai_scene' then (
      select jsonb_build_object('title', sc.title, 'status', sc.status, 'story_id', sc.story_id, 'owner_id', st.owner_id)
      from public.ai_scenes sc join public.ai_stories st on st.id = sc.story_id where sc.id = p_target_id)
    when 'profile' then (
      select jsonb_build_object('handle', p.handle::text, 'display_name', p.display_name, 'deleted', p.deleted_at is not null)
      from public.profiles p where p.id = p_target_id)
  end
$$;
revoke all on function app_private.report_target_summary(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- User RPCs

-- Report something. Returns the report id; reporting the same target again while the first report
-- is open returns that report instead of opening another.
create function public.report_content(p_target_type text, p_target_id uuid, p_reason text, p_details text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_adult();
  v_id bigint;
  v_recent integer;
begin
  perform app_private.check_report(p_target_type, p_reason, p_details);
  -- One reporter at a time: parallel calls can't pass the daily limit or open two reports on one target.
  perform pg_advisory_xact_lock(hashtext('report:' || v_uid::text));
  select r.id into v_id from public.reports r
  where r.reporter_id = v_uid and r.target_type = p_target_type and r.target_id = p_target_id and r.status = 'open';
  if v_id is not null then
    return v_id;
  end if;
  if not app_private.reportable(p_target_type, p_target_id, v_uid) then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;
  select count(*) into v_recent from public.reports r
  where r.reporter_id = v_uid and r.created_at > now() - interval '1 day';
  if v_recent >= app_private.cfg_int('reports_per_day', 20) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into public.reports (target_type, target_id, reason, details, source, reporter_id)
  values (p_target_type, p_target_id, p_reason, nullif(btrim(p_details), ''), 'user', v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.report_content(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;

-- Block an account: you stop seeing their profile and their series (episodes you unlocked stay yours),
-- and you stop following their series.
create function public.block_user(p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_adult();
begin
  if p_user = v_uid then
    raise exception 'cannot_block_self' using errcode = '22023';
  end if;
  -- Hidden accounts (unknown age, blocked) answer exactly like ids that don't exist, so blocking can't be
  -- used to find out that a hidden account exists.
  if not app_private.is_live_adult(p_user) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_uid, p_user)
  on conflict (blocker_id, blocked_id) do nothing;
  delete from public.follows f
  using public.series s
  where f.user_id = v_uid and s.id = f.series_id and s.creator_id = p_user;
end;
$$;
revoke all on function public.block_user(uuid) from public, anon, authenticated;
grant execute on function public.block_user(uuid) to authenticated;

create function public.unblock_user(p_user uuid) returns void
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
  delete from public.blocks where blocker_id = v_uid and blocked_id = p_user;
end;
$$;
revoke all on function public.unblock_user(uuid) from public, anon, authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- Statements of reasons for takedowns of the caller's own series and episodes (DSA Art. 17), newest
-- first. Says whether a report led to it, never which report or who made it, and not which editor.
create function public.get_my_moderation_actions(p_limit integer default 50) returns jsonb
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'target_type', a.target_type, 'target_id', a.target_id, 'action', a.action,
             'ground', a.ground, 'reference', a.reference, 'facts', a.facts, 'automated', a.automated,
             'after_report', cardinality(a.report_ids) > 0, 'created_at', a.created_at)
           order by a.created_at desc, a.id desc)
    from (
      select m.* from app_private.moderation_actions m
      -- Takedowns, and withdrawn Editor's Picks (they end the series' earnings: a restriction the creator
      -- is owed a statement of reasons for).
      where m.action in ('take_down', 'editors_pick_off')
        and ((m.target_type = 'series'
              and exists (select 1 from public.series s where s.id = m.target_id and s.creator_id = v_uid))
             or (m.target_type = 'episode'
                 and exists (select 1 from public.episodes e join public.series s on s.id = e.series_id
                             where e.id = m.target_id and s.creator_id = v_uid)))
      order by m.created_at desc, m.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) a), '[]'::jsonb);
end;
$$;
revoke all on function public.get_my_moderation_actions(integer) from public, anon, authenticated;
grant execute on function public.get_my_moderation_actions(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Service RPCs (Worker)

-- A logged-out notice (the Worker checked Origin and Turnstile and hashed the IP). Name and email are
-- required, except for child sexual abuse reports, which may be anonymous (DSA Art. 16(2)(c)). Returns
-- 'received', or 'not_reportable' (nothing stored; the Worker answers the same either way).
create function svc.submit_notice(
  p_target_type text, p_target_id uuid, p_reason text, p_details text,
  p_notifier_name text, p_notifier_email text, p_ip_hash text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(p_notifier_name), '');
  v_email text := nullif(lower(btrim(p_notifier_email)), '');
  v_recent integer;
  v_id bigint;
begin
  perform svc.require_service_role();
  perform app_private.check_report(p_target_type, p_reason, p_details);
  if p_details is null or btrim(p_details) = '' then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_ip_hash' using errcode = '22023';
  end if;
  if char_length(v_name) > 100 or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or (p_reason <> 'minor_safety' and (v_name is null or v_email is null)) then
    raise exception 'invalid_notifier' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('notice:' || p_ip_hash));
  select count(*) into v_recent from app_private.report_notices n
  where n.ip_hash = p_ip_hash and n.created_at > now() - interval '1 day';
  if v_recent >= app_private.cfg_int('notices_per_ip_per_day', 10) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if not app_private.reportable(p_target_type, p_target_id, null) then
    return 'not_reportable';
  end if;
  insert into public.reports (target_type, target_id, reason, details, source)
  values (p_target_type, p_target_id, p_reason, btrim(p_details), 'notice')
  returning id into v_id;
  insert into app_private.report_notices (report_id, notifier_name, notifier_email, ip_hash)
  values (v_id, v_name, v_email, p_ip_hash);
  return 'received';
end;
$$;
revoke all on function svc.submit_notice(text, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function svc.submit_notice(text, uuid, text, text, text, text, text) to service_role;

-- Cron: forget what notices no longer need. IP hashes are only for the daily cap (kept two days);
-- notifier contacts are kept until p_days after the decision. Returns how many contacts were purged.
create function svc.purge_notice_contacts(p_days integer default 180) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform svc.require_service_role();
  update app_private.report_notices set ip_hash = null
  where ip_hash is not null and created_at < now() - interval '2 days';
  update app_private.report_notices n
  set notifier_name = null, notifier_email = null, contact_purged_at = now()
  from public.reports r
  where r.id = n.report_id and n.contact_purged_at is null and r.status <> 'open'
    and r.resolved_at < now() - make_interval(days => greatest(coalesce(p_days, 180), 30));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function svc.purge_notice_contacts(integer) from public, anon, authenticated;
grant execute on function svc.purge_notice_contacts(integer) to service_role;

-- The user's editor role ('editor' or 'admin') if they have one and a live adult account, else null.
-- The Worker asks this on every /api/editor request (the JWT doesn't carry roles).
create function svc.editor_role(p_user uuid) returns text
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform svc.require_service_role();
  select p.role into v_role from public.profiles p where p.id = p_user and p.role in ('editor', 'admin');
  if v_role is null or not app_private.is_live_adult(p_user) then
    return null;
  end if;
  return v_role;
end;
$$;
revoke all on function svc.editor_role(uuid) from public, anon, authenticated;
grant execute on function svc.editor_role(uuid) to service_role;

-- A verdict by an editor (POST /api/editor/verdict): svc.record_verdict with source 'editor', except
-- about the editor's own series, episodes and their pending edits (another editor decides those, so
-- nobody approves their own content past the review). Returns svc.record_verdict's result.
create function svc.editor_verdict(
  p_target text, p_id uuid, p_version integer, p_decision text, p_categories text[], p_reason text, p_editor uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  perform app_private.require_editor(p_editor);
  if p_target is null or p_target not in ('series', 'episode', 'series_edit', 'episode_edit') then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if app_private.target_owner(case p_target when 'series_edit' then 'series' when 'episode_edit' then 'episode'
                                            else p_target end, p_id) = p_editor then
    raise exception 'conflict_of_interest' using errcode = '42501';
  end if;
  return svc.record_verdict(p_target, p_id, p_version, 'editor', null, p_decision, p_categories, p_reason, p_editor);
end;
$$;
revoke all on function svc.editor_verdict(text, uuid, integer, text, text[], text, uuid) from public, anon, authenticated;
grant execute on function svc.editor_verdict(text, uuid, integer, text, text[], text, uuid) to service_role;

-- Take a series or an episode down for good (illegal content or a breach of the Terms). Removes it the
-- way svc.remove_series does, closes the open reports about it (a series' episodes included) as
-- actioned, and records the statement of reasons with the cited and the closed reports. Returns
-- { outcome: removed | already_removed, recredit: [episodes whose buyers still need re-crediting],
--   reports_resolved }. The Worker then calls svc.recredit_episode for each until it returns 0; calling
-- this again (same target) only reports what is still left and closes reports filed since.
create function svc.take_down(
  p_target text, p_id uuid, p_editor uuid, p_ground text, p_reference text, p_facts text,
  p_report_ids bigint[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_removed boolean;
  v_episodes uuid[];
  v_resolved bigint[];
begin
  perform svc.require_service_role();
  perform app_private.require_editor(p_editor);
  if p_ground is null or p_ground not in ('legal', 'terms') then
    raise exception 'invalid_ground' using errcode = '22023';
  end if;
  if coalesce(char_length(btrim(p_reference)), 0) not between 1 and 200
     or coalesce(char_length(btrim(p_facts)), 0) not between 1 and 2000 then
    raise exception 'invalid_statement' using errcode = '22023';
  end if;

  if p_target = 'series' then
    select s.status = 'removed' into v_was_removed from public.series s where s.id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    v_episodes := array(select e.id from public.episodes e where e.series_id = p_id order by e.id);
  elsif p_target = 'episode' then
    select e.status = 'removed' into v_was_removed from public.episodes e where e.id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    v_episodes := array[p_id];
  else
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  -- Cited reports must be about this target (for a series, the series or one of its episodes).
  if exists (select 1 from unnest(coalesce(p_report_ids, '{}')) x (id)
             where not exists (select 1 from public.reports r
                               where r.id = x.id
                                 and ((r.target_type = p_target and r.target_id = p_id)
                                      or (p_target = 'series' and r.target_type = 'episode'
                                          and r.target_id = any (v_episodes))))) then
    raise exception 'report_mismatch' using errcode = '22023';
  end if;

  if not v_was_removed then
    if p_target = 'series' then
      perform svc.remove_series(p_id);
    else
      -- Marked removed first, so concurrent unlocks (which share-lock the episode) see it.
      update public.episodes set status = 'removed', publish_requested = false where id = p_id;
      delete from public.pending_edits where target = 'episode' and target_id = p_id;
    end if;
  end if;

  v_resolved := app_private.resolve_reports(p_target, array[p_id], 'actioned', p_editor);
  if p_target = 'series' then
    v_resolved := v_resolved || app_private.resolve_reports('episode', v_episodes, 'actioned', p_editor);
  end if;

  -- Every removal and every closed report gets a statement; a pure repeat writes nothing.
  if not v_was_removed or cardinality(v_resolved) > 0 then
    insert into app_private.moderation_actions (target_type, target_id, action, ground, reference, facts, automated,
                                                editor_id, report_ids)
    values (p_target, p_id, 'take_down', p_ground, btrim(p_reference), btrim(p_facts), false, p_editor,
            array(select distinct x from unnest(coalesce(p_report_ids, '{}') || v_resolved) x order by x));
  end if;

  return jsonb_build_object(
    'outcome', case when v_was_removed then 'already_removed' else 'removed' end,
    'recredit', to_jsonb(app_private.episodes_awaiting_recredit(v_episodes)),
    'reports_resolved', cardinality(v_resolved));
end;
$$;
revoke all on function svc.take_down(text, uuid, uuid, text, text, text, bigint[]) from public, anon, authenticated;
grant execute on function svc.take_down(text, uuid, uuid, text, text, text, bigint[]) to service_role;

-- No breach found: close one open report and record the decision. Returns 'dismissed' or 'not_open'.
-- Never about the editor's own content or profile (another editor decides those).
create function svc.dismiss_report(p_report bigint, p_editor uuid, p_note text default null) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_target uuid;
  v_status text;
begin
  perform svc.require_service_role();
  perform app_private.require_editor(p_editor);
  if char_length(p_note) > 2000 then
    raise exception 'invalid_statement' using errcode = '22023';
  end if;
  select r.target_type, r.target_id, r.status into v_type, v_target, v_status
  from public.reports r where r.id = p_report for update;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    return 'not_open';
  end if;
  if app_private.target_owner(v_type, v_target) = p_editor then
    raise exception 'conflict_of_interest' using errcode = '42501';
  end if;
  update public.reports set status = 'dismissed', resolved_at = now(), resolved_by = p_editor where id = p_report;
  insert into app_private.moderation_actions (target_type, target_id, action, facts, automated, editor_id, report_ids)
  values (v_type, v_target, 'reports_dismissed',
          coalesce(nullif(btrim(p_note), ''), 'No breach of the law or of the Terms was found.'), false, p_editor,
          array[p_report]);
  return 'dismissed';
end;
$$;
revoke all on function svc.dismiss_report(bigint, uuid, text) from public, anon, authenticated;
grant execute on function svc.dismiss_report(bigint, uuid, text) to service_role;

-- Editor's Pick on or off. Only for approved series that aren't removed, never for the editor's own
-- (it makes an AI series monetisable). Returns 'applied' or 'unchanged' (nothing recorded).
create function svc.set_editors_pick(p_series uuid, p_on boolean, p_editor uuid, p_note text default null) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
  v_status text;
  v_moderation text;
  v_pick boolean;
begin
  perform svc.require_service_role();
  perform app_private.require_editor(p_editor);
  if p_on is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if char_length(p_note) > 2000 then
    raise exception 'invalid_statement' using errcode = '22023';
  end if;
  select s.creator_id, s.status, s.moderation_status, s.editors_pick into v_creator, v_status, v_moderation, v_pick
  from public.series s where s.id = p_series for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status = 'removed' or v_moderation <> 'approved' then
    raise exception 'not_eligible' using errcode = '22023';
  end if;
  if v_creator = p_editor then
    raise exception 'conflict_of_interest' using errcode = '42501';
  end if;
  if v_pick = p_on then
    return 'unchanged';
  end if;
  update public.series set editors_pick = p_on where id = p_series;
  insert into app_private.moderation_actions (target_type, target_id, action, facts, automated, editor_id)
  values ('series', p_series, case when p_on then 'editors_pick_on' else 'editors_pick_off' end,
          coalesce(nullif(btrim(p_note), ''), case when p_on then 'Selected as Editor''s Pick.' else 'Editor''s Pick withdrawn.' end),
          false, p_editor);
  return 'applied';
end;
$$;
revoke all on function svc.set_editors_pick(uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function svc.set_editors_pick(uuid, boolean, uuid, text) to service_role;

-- Everything waiting for an editor: { items: the editor moderation queue (first reviews and edits handed
-- to a person), reports: open reports grouped by target }. Groups with a child-safety report come first,
-- then the most reported, then the oldest. Each group lists its newest 20 reports (never who made them).
create function svc.editor_queue(p_limit integer default 50) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform svc.require_service_role();
  return jsonb_build_object(
    'items', svc.moderation_queue(v_limit, null, true),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'target_type', g.target_type, 'target_id', g.target_id, 'open_count', g.n, 'urgent', g.urgent,
               'first_at', g.first_at, 'last_at', g.last_at,
               'target', app_private.report_target_summary(g.target_type, g.target_id),
               'reasons', (select jsonb_object_agg(x.reason, x.n)
                           from (select r2.reason, count(*) as n from public.reports r2
                                 where r2.status = 'open' and r2.target_type = g.target_type and r2.target_id = g.target_id
                                 group by r2.reason) x),
               'reports', (select jsonb_agg(jsonb_build_object('id', y.id, 'reason', y.reason, 'details', y.details,
                                                               'source', y.source, 'created_at', y.created_at)
                                            order by y.created_at desc, y.id desc)
                           from (select r3.id, r3.reason, r3.details, r3.source, r3.created_at from public.reports r3
                                 where r3.status = 'open' and r3.target_type = g.target_type and r3.target_id = g.target_id
                                 order by r3.created_at desc, r3.id desc limit 20) y))
             order by g.urgent desc, g.n desc, g.first_at)
      from (
        select r.target_type, r.target_id, count(*) as n, bool_or(r.reason = 'minor_safety') as urgent,
               min(r.created_at) as first_at, max(r.created_at) as last_at
        from public.reports r
        where r.status = 'open'
        group by r.target_type, r.target_id
        order by bool_or(r.reason = 'minor_safety') desc, count(*) desc, min(r.created_at)
        limit v_limit
      ) g), '[]'::jsonb));
end;
$$;
revoke all on function svc.editor_queue(integer) from public, anon, authenticated;
grant execute on function svc.editor_queue(integer) to service_role;
