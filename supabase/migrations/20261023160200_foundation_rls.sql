-- Foundation RLS and grants.
-- Model: a user sees rows of organizations they are an active member of;
-- writes additionally require a permission. anon has no access at all.
-- No DELETE policies except role_permissions (join rows; changes are audited).

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
grant usage on schema private to authenticated, service_role;

revoke execute on function private.is_valid_timezone(text) from public;
grant execute on function private.is_valid_timezone(text) to authenticated, service_role;

grant execute on function private.user_org_ids() to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;

revoke execute on function public.has_permission(uuid, text) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated;

revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges (explicit; RLS below further restricts rows)
-- ---------------------------------------------------------------------------
revoke all on
  public.organizations, public.modules, public.permissions, public.roles,
  public.role_permissions, public.profiles, public.memberships,
  public.audit_log, public.org_modules
from anon, authenticated;

grant select on
  public.organizations, public.modules, public.permissions, public.roles,
  public.role_permissions, public.profiles, public.memberships,
  public.audit_log, public.org_modules
to authenticated;

grant update (name, timezone, settings) on public.organizations to authenticated;
grant insert (organization_id, key, name), update (name, archived_at) on public.roles to authenticated;
grant insert (organization_id, role_id, permission_key), delete on public.role_permissions to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (role_id, archived_at) on public.memberships to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.modules enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;
alter table public.org_modules enable row level security;

-- organizations
create policy organizations_select on public.organizations
  for select to authenticated
  using (id in (select private.user_org_ids()));

create policy organizations_update on public.organizations
  for update to authenticated
  using (private.has_permission(id, 'org.settings.manage'))
  with check (private.has_permission(id, 'org.settings.manage'));

-- catalogs
create policy modules_select on public.modules
  for select to authenticated using (true);

create policy permissions_select on public.permissions
  for select to authenticated using (true);

-- roles: system roles are fixed; only custom roles can be created/changed.
create policy roles_select on public.roles
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy roles_insert on public.roles
  for insert to authenticated
  with check (private.has_permission(organization_id, 'roles.manage') and not is_system);

create policy roles_update on public.roles
  for update to authenticated
  using (private.has_permission(organization_id, 'roles.manage') and not is_system)
  with check (private.has_permission(organization_id, 'roles.manage') and not is_system);

-- role_permissions: only for custom roles (prevents locking out the admin role).
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check (
    private.has_permission(organization_id, 'roles.manage')
    and exists (
      select 1 from public.roles r
      where r.id = role_id and r.organization_id = role_permissions.organization_id and not r.is_system
    )
  );

create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using (
    private.has_permission(organization_id, 'roles.manage')
    and exists (
      select 1 from public.roles r
      where r.id = role_id and r.organization_id = role_permissions.organization_id and not r.is_system
    )
  );

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    organization_id in (select private.user_org_ids())
    and (id = (select auth.uid()) or private.has_permission(organization_id, 'users.manage'))
  )
  with check (
    organization_id in (select private.user_org_ids())
    and (id = (select auth.uid()) or private.has_permission(organization_id, 'users.manage'))
  );

-- memberships: managers cannot change their own membership (no self-lockout or self-promotion).
create policy memberships_select on public.memberships
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy memberships_update on public.memberships
  for update to authenticated
  using (private.has_permission(organization_id, 'users.manage') and user_id <> (select auth.uid()))
  with check (private.has_permission(organization_id, 'users.manage') and user_id <> (select auth.uid()));

-- audit_log: read with permission; writes only via trigger / write_audit().
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (private.has_permission(organization_id, 'audit.read'));

-- org_modules: read-only for tenants; activation is done by Zcore (service role).
create policy org_modules_select on public.org_modules
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));
