-- Flat, filterable list of organization members for server-side paginated
-- tables (search by username/name, filter by role/status, sort, range).
-- security_invoker = true: the caller's RLS on memberships/profiles/roles
-- applies, so the view can never expose another tenant's rows.
create view public.member_directory
with (security_invoker = true)
as
select
  m.organization_id,
  m.user_id,
  p.username,
  p.full_name,
  m.role_id,
  r.key as role_key,
  r.name as role_name,
  (m.archived_at is null) as is_active,
  m.created_at,
  m.archived_at
from public.memberships m
join public.profiles p on p.id = m.user_id and p.organization_id = m.organization_id
join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id;

comment on view public.member_directory is
  'Members with profile and role for list screens. RLS of the underlying tables applies (security_invoker).';

revoke all on public.member_directory from anon, authenticated;
grant select on public.member_directory to authenticated;
