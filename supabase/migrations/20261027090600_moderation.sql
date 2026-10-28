-- Moderation queue and verdict log.
--
-- The Worker's cron reviews text (series, series edits, episode title edits) with Muse Spark and
-- records each decision here; the ingest workflow does the first review of an episode (media + title).
-- "needs_editor" hands an item to a human: it leaves the automated queue until an editor decides.
-- Every decision is kept (append-only) for statements of reasons (DSA) and AI transparency.

create table app_private.moderation_verdicts (
  id bigint generated always as identity primary key,
  target text not null check (target in ('series', 'episode', 'series_edit', 'episode_edit')),
  target_id uuid not null,
  version integer not null,
  source text not null check (source in ('auto', 'editor')),
  model text check (char_length(model) <= 60),
  decision text not null check (decision in ('approved', 'rejected', 'needs_editor')),
  categories text[] not null default '{}' check (cardinality(categories) <= 10),
  reason text check (char_length(reason) <= 300),
  outcome text not null,
  editor_id uuid,
  created_at timestamptz not null default now(),
  constraint editor_verdicts_name_the_editor check ((source = 'editor') = (editor_id is not null))
);
create index moderation_verdicts_target_idx on app_private.moderation_verdicts (target, target_id, version);
revoke all on app_private.moderation_verdicts from public, anon, authenticated;
create trigger moderation_verdicts_append_only before update or delete on app_private.moderation_verdicts
  for each row execute function app_private.tg_forbid_mutation();

-- Is this version of the item waiting for an editor?
create function app_private.awaiting_editor(p_target text, p_id uuid, p_version integer) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from app_private.moderation_verdicts v
                 where v.target = p_target and v.target_id = p_id and v.version = p_version
                   and v.decision = 'needs_editor')
$$;
revoke all on function app_private.awaiting_editor(text, uuid, integer) from public, anon, authenticated;

-- What to review next, oldest first: first reviews of series and of episodes with media, and pending
-- edits. Each item has the version its verdict must quote. The automated queue (p_for_editor false)
-- skips items an editor must decide and edits changed in the last minute (the creator may still be
-- typing); the editor queue lists only the items handed to an editor.
create function svc.moderation_queue(p_limit integer default 50, p_targets text[] default null,
                                     p_for_editor boolean default false) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
begin
  perform svc.require_service_role();
  return coalesce((
    select jsonb_agg(to_jsonb(q) order by q.since)
    from (
      select * from (
        (select 'series' as target, s.id, s.content_version as version, s.updated_at as since,
                jsonb_build_object('title', s.title, 'synopsis', s.synopsis, 'maturity', s.maturity,
                                   'tag_slugs', app_private.series_tag_slugs(s.id)) as content
         from public.series s
         where s.moderation_status = 'pending' and s.status <> 'removed'
           and app_private.awaiting_editor('series', s.id, s.content_version) = p_for_editor
         order by s.updated_at limit v_limit)
        union all
        (select 'episode', e.id, e.content_version, e.updated_at,
                jsonb_build_object('title', e.title, 'series_id', e.series_id, 'provider', m.provider,
                                   'asset_id', m.asset_id, 'manifest_key', m.manifest_key)
         from public.episodes e left join app_private.episode_media m on m.episode_id = e.id
         where e.moderation_status = 'pending' and e.status = 'ready'
           and app_private.awaiting_editor('episode', e.id, e.content_version) = p_for_editor
         order by e.updated_at limit v_limit)
        union all
        (select pe.target || '_edit', pe.target_id, pe.version, pe.updated_at, pe.fields
         from public.pending_edits pe
         where pe.status = 'pending'
           and app_private.awaiting_editor(pe.target || '_edit', pe.target_id, pe.version) = p_for_editor
           and (p_for_editor or pe.updated_at < now() - interval '1 minute')
         order by pe.updated_at limit v_limit)
      ) u
      where p_targets is null or u.target = any (p_targets)
      order by since
      limit v_limit
    ) q), '[]'::jsonb);
end;
$$;
revoke all on function svc.moderation_queue(integer, text[], boolean) from public, anon, authenticated;
grant execute on function svc.moderation_queue(integer, text[], boolean) to service_role;

-- Record a decision and apply it. Returns svc.set_moderation's result ('applied', 'stale_verdict',
-- 'not_applicable'), or 'held' for needs_editor. Editors' verdicts name the editor (an editor or
-- admin account; checked here, the Worker authenticates them).
create function svc.record_verdict(
  p_target text, p_id uuid, p_version integer, p_source text, p_model text, p_decision text,
  p_categories text[], p_reason text, p_editor uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text;
begin
  perform svc.require_service_role();
  if p_decision is null or p_decision not in ('approved', 'rejected', 'needs_editor') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if p_source = 'editor' and not exists (select 1 from public.profiles pr
                                         where pr.id = p_editor and pr.role in ('editor', 'admin')
                                           and pr.deleted_at is null) then
    raise exception 'not_an_editor' using errcode = '42501';
  end if;
  if p_decision = 'needs_editor' then
    if p_source = 'editor' then
      raise exception 'invalid_decision' using errcode = '22023';
    end if;
    v_outcome := 'held';
  else
    v_outcome := svc.set_moderation(p_target, p_id, p_decision, p_version);
  end if;
  insert into app_private.moderation_verdicts (target, target_id, version, source, model, decision, categories,
                                               reason, outcome, editor_id)
  values (p_target, p_id, p_version, p_source, left(p_model, 60), p_decision,
          coalesce(p_categories[1:10], '{}'), left(p_reason, 300), v_outcome, p_editor);
  return v_outcome;
end;
$$;
revoke all on function svc.record_verdict(text, uuid, integer, text, text, text, text[], text, uuid) from public, anon, authenticated;
grant execute on function svc.record_verdict(text, uuid, integer, text, text, text, text[], text, uuid) to service_role;
