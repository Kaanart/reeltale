-- Voice choice ("Say your choice" in the AI story player, web first). The app records a few seconds of audio,
-- the Worker (POST /api/ai/transcribe) sends it to Meta's Muse Voice Transcribe and answers the text. Before
-- any audio leaves the Worker it asks this function: is the account a live adult who has allowed voice input
-- for Meta (public.set_ai_consent('voice', array['meta'], <version>, true))? Nothing about the recording is
-- stored, so there is no table here.

create function svc.voice_allowed(p_user uuid) returns boolean
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  perform svc.require_service_role();
  if p_user is null then
    return false;
  end if;
  return app_private.is_live_adult(p_user)
    and app_private.has_ai_consent(p_user, 'voice', 'meta');
end;
$$;
revoke all on function svc.voice_allowed(uuid) from public, anon, authenticated;
grant execute on function svc.voice_allowed(uuid) to service_role;
