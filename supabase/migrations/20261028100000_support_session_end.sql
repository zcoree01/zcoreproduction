-- Support session end (D-028).
--   * session_status() also reports `support_ended`: the caller is a support
--     account whose approved session has ended or expired. The proxy then
--     sends the browser to /support/exit, which signs the support account out
--     and returns the platform admin to their own Zcore session, instead of
--     the generic "signed in on another device" sign-out.
--   * pending_support_requests(): open requests for the organization's
--     approvers (support.approve), polled by the approval prompt.

drop function public.session_status();

create function public.session_status()
returns table (active boolean, must_change_password boolean, support_ended boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from auth.sessions s
      where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
        and s.user_id = (select auth.uid())
        and (s.not_after is null or s.not_after > now())
    ),
    coalesce(
      (select p.must_change_password from public.profiles p where p.id = (select auth.uid())),
      false
    ),
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_support
        and not private.support_active(p.organization_id)
    )
$$;

comment on function public.session_status() is
  'Session still active, temporary password to replace, and support access ended (support accounts).';

revoke execute on function public.session_status() from public, anon;
grant execute on function public.session_status() to authenticated;

create function public.pending_support_requests(p_org_id uuid)
returns table (id uuid, requester_name text, reason text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.requester_name, r.reason, r.created_at
  from public.support_access_requests r
  where r.organization_id = p_org_id
    and r.status = 'pending'
    and private.has_permission(p_org_id, 'support.approve')
  order by r.created_at
$$;

revoke execute on function public.pending_support_requests(uuid) from public, anon;
grant execute on function public.pending_support_requests(uuid) to authenticated;
