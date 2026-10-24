-- One active session per user (D-013): signing in revokes the user's other
-- sessions (auth signOut scope 'others'). Their access tokens stay
-- cryptographically valid until expiry, so the proxy asks this function on
-- every request whether the caller's session still exists and signs the old
-- device out immediately.

create function public.is_session_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions s
    where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      and s.user_id = (select auth.uid())
      and (s.not_after is null or s.not_after > now())
  )
$$;

comment on function public.is_session_active() is
  'True while the session of the calling JWT exists (not revoked by a newer sign-in or sign-out).';

revoke execute on function public.is_session_active() from public, anon;
grant execute on function public.is_session_active() to authenticated;
