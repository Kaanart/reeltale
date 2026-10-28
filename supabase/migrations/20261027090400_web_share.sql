-- Share-link cards for the Worker's OpenGraph tags. Only series that anyone could see get a card:
-- published, approved, general maturity (no mature titles in link previews), creator not deleted.
create function svc.series_share_card(p_slug text) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  r record;
begin
  perform svc.require_service_role();
  select s.title, s.synopsis, s.cover_key into r
  from public.series s
  left join public.profiles p on p.id = s.creator_id
  where s.slug = p_slug and s.status = 'published' and s.moderation_status = 'approved'
    and s.maturity = 'general' and (p.id is null or p.deleted_at is null);
  if not found then
    return null;
  end if;
  return jsonb_build_object('title', r.title, 'synopsis', r.synopsis, 'cover_key', r.cover_key);
end;
$$;
revoke all on function svc.series_share_card(text) from public, anon, authenticated;
grant execute on function svc.series_share_card(text) to service_role;
