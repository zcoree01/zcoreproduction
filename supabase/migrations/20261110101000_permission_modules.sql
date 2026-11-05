-- A permission works only while its module is enabled for the organization
-- (D-049): a firm whose package has no tools module cannot read tools through
-- the API, even though its admin role holds tools.read. Same conditions as
-- before plus permissions.module_key, in both permission checks (D-042: the
-- set variant is evaluated once per statement).

create or replace function private.has_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id and o.archived_at is null
    join public.profiles p on p.id = m.user_id and p.archived_at is null
    join public.roles r on r.id = m.role_id and r.archived_at is null
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions pe on pe.key = rp.permission_key
    where m.organization_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.archived_at is null
      and rp.permission_key = p_permission
      and (not p.is_support or private.support_active(m.organization_id))
      and private.module_enabled(m.organization_id, pe.module_key)
  )
$$;

create or replace function private.permitted_org_ids(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  join public.organizations o on o.id = m.organization_id and o.archived_at is null
  join public.profiles p on p.id = m.user_id and p.archived_at is null
  join public.roles r on r.id = m.role_id and r.archived_at is null
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions pe on pe.key = rp.permission_key
  where m.user_id = (select auth.uid())
    and m.archived_at is null
    and rp.permission_key = p_permission
    and (not p.is_support or private.support_active(m.organization_id))
    and private.module_enabled(m.organization_id, pe.module_key)
$$;
