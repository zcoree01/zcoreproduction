-- Zcore organization roles and granular platform permissions.
--
--   * 13 platform permissions (module 'platform') replace the single catch-all
--     platform.manage as the way to gate platform features.
--   * The Zcore organization (is_platform) gets two system roles,
--     platform_admin ("Administrator") and platform_technician ("Tehnicar");
--     its seven standard roles are archived and its members move to
--     platform_admin.
--   * private.has_platform_permission / require_platform_permission check one
--     platform permission in the active platform organization.
--     is_platform_admin() / require_platform_admin() now mean platform.read.
--
-- platform.manage is deliberately KEPT during the transition: the linked
-- Supabase project is shared with the production code, which still checks it.
-- It is granted to platform_admin only, and removed in a later migration once
-- the new code is live.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module_key, description, default_roles) values
  ('platform.read', 'platform',
    'Zcore platform: see registered organizations, their modules and packages',
    '{platform_admin,platform_technician}'),
  ('platform.revenue.read', 'platform',
    'Zcore platform: see revenue and payment totals', '{platform_admin}'),
  ('platform.modules.manage', 'platform',
    'Zcore platform: enable modules and set trials for organizations',
    '{platform_admin,platform_technician}'),
  ('platform.packages.assign', 'platform',
    'Zcore platform: assign packages to organizations',
    '{platform_admin,platform_technician}'),
  ('platform.packages.manage', 'platform',
    'Zcore platform: create and change packages and prices', '{platform_admin}'),
  ('platform.support', 'platform',
    'Zcore platform: start support access to an organization',
    '{platform_admin,platform_technician}'),
  ('platform.directory.approve', 'platform',
    'Zcore platform: decide company directory requests and claims',
    '{platform_admin,platform_technician}'),
  ('platform.payments.record', 'platform',
    'Zcore platform: record monthly payments',
    '{platform_admin,platform_technician}'),
  ('platform.payments.cancel', 'platform',
    'Zcore platform: cancel recorded payments', '{platform_admin}'),
  ('platform.lock', 'platform',
    'Zcore platform: lock and unlock organizations',
    '{platform_admin,platform_technician}'),
  ('platform.settings.manage', 'platform',
    'Zcore platform: platform-wide settings', '{platform_admin}'),
  ('platform.organizations.archive', 'platform',
    'Zcore platform: archive organizations', '{platform_admin}'),
  ('platform.organizations.delete', 'platform',
    'Zcore platform: permanently delete organizations', '{platform_admin}');

update public.permissions
set default_roles = array_append(default_roles, 'platform_admin')
where key in ('users.read', 'users.manage', 'roles.manage', 'audit.read')
  and not ('platform_admin' = any (default_roles));

update public.permissions
set default_roles = '{platform_admin}'
where key = 'platform.manage';

-- ---------------------------------------------------------------------------
-- Roles of the Zcore organization
-- ---------------------------------------------------------------------------
insert into public.roles (organization_id, key, name, is_system)
select o.id, v.key, v.name, true
from public.organizations o
cross join (values
  ('platform_admin', 'Administrator'),
  ('platform_technician', 'Tehničar')
) as v (key, name)
where o.is_platform
on conflict (organization_id, key) do nothing;

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.organizations o on o.id = r.organization_id and o.is_platform
join public.permissions p on r.key = any (p.default_roles)
where r.key in ('platform_admin', 'platform_technician')
on conflict do nothing;

-- Members move to Administrator, then the standard roles are archived.
update public.memberships m
set role_id = pa.id
from public.organizations o, public.roles pa
where o.is_platform
  and m.organization_id = o.id
  and pa.organization_id = o.id
  and pa.key = 'platform_admin'
  and m.role_id <> pa.id;

update public.roles r
set archived_at = coalesce(r.archived_at, now())
from public.organizations o
where o.is_platform
  and r.organization_id = o.id
  and r.is_system
  and r.key not in ('platform_admin', 'platform_technician');

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
create function private.has_platform_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations o
    where o.is_platform
      and o.archived_at is null
      and private.has_permission(o.id, p_permission)
  )
$$;

create function private.require_platform_permission(p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_platform_permission(p_permission) then
    raise exception 'missing permission %', p_permission using errcode = '42501';
  end if;
end;
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_platform_permission('platform.read')
$$;

create or replace function private.require_platform_admin()
returns void
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_platform_permission('platform.read')
$$;
