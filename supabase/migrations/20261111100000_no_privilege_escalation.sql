-- No privilege escalation through users.manage / roles.manage (D-053,
-- follow-up of D-050). A member may assign, manage and edit only roles whose
-- every permission they hold themselves. The system administrator roles
-- (admin, platform_admin) stay the top of the hierarchy and are not limited:
-- the admin role lacks a few permissions of other system roles by design
-- (payroll, quality inspection) and must still assign them.
--
-- Closes: a custom role with users.manage assigning the Administrator role
-- (which holds platform.organizations.delete, never allowed in custom roles),
-- resetting a stronger member's password, and a custom role with roles.manage
-- granting itself more.

-- True when the caller's active role is a system administrator role.
create function private.caller_is_top_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.profiles p on p.id = m.user_id and p.archived_at is null
    join public.roles r on r.id = m.role_id and r.archived_at is null
    where m.organization_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.archived_at is null
      and r.is_system
      and r.key in ('admin', 'platform_admin')
      and (not p.is_support or private.support_active(m.organization_id))
  )
$$;

-- True when the caller holds every given permission through their own role
-- (stored permissions, regardless of enabled modules), or is a top admin.
create function private.caller_holds_all(p_org_id uuid, p_permissions text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.caller_is_top_admin(p_org_id)
    or not exists (
      select 1
      from unnest(coalesce(p_permissions, '{}')) as k (key)
      where k.key not in (
        select rp.permission_key
        from public.memberships m
        join public.profiles p on p.id = m.user_id and p.archived_at is null
        join public.roles r on r.id = m.role_id and r.archived_at is null
        join public.role_permissions rp on rp.role_id = r.id
        where m.organization_id = p_org_id
          and m.user_id = (select auth.uid())
          and m.archived_at is null
          and (not p.is_support or private.support_active(m.organization_id))
      )
    )
$$;

-- True when the caller may assign or manage members of this role.
create function private.role_within_caller(p_org_id uuid, p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.caller_holds_all(
    p_org_id,
    array(
      select rp.permission_key from public.role_permissions rp
      where rp.role_id = p_role_id and rp.organization_id = p_org_id
    )
  )
$$;

revoke execute on function private.caller_is_top_admin(uuid) from public;
revoke execute on function private.caller_holds_all(uuid, text[]) from public;
revoke execute on function private.role_within_caller(uuid, uuid) from public;
grant execute on function private.caller_is_top_admin(uuid) to authenticated;
grant execute on function private.caller_holds_all(uuid, text[]) to authenticated;
grant execute on function private.role_within_caller(uuid, uuid) to authenticated;

-- Managing another member (update, activate, password reset) needs their role
-- to be within the caller's.
create or replace function private.managed_membership(p_org_id uuid, p_user_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
begin
  if not private.has_permission(p_org_id, 'users.manage') then
    raise exception 'missing permission users.manage' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'self' using errcode = '42501';
  end if;
  select m.* into v_membership
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_org_id and m.user_id = p_user_id and not p.is_support
  for update of m;
  if v_membership.id is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if not private.role_within_caller(p_org_id, v_membership.role_id) then
    raise exception 'role_above_caller' using errcode = '42501';
  end if;
  return v_membership;
end;
$$;

-- The new role must be within the caller's as well.
create or replace function public.update_member(
  p_org_id uuid,
  p_user_id uuid,
  p_full_name text,
  p_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships := private.managed_membership(p_org_id, p_user_id);
  v_name text := btrim(coalesce(p_full_name, ''));
  v_before jsonb;
begin
  if length(v_name) not between 1 and 200 then
    raise exception 'invalid_full_name' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.roles r
    where r.id = p_role_id and r.organization_id = p_org_id and r.archived_at is null
  ) then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if not private.role_within_caller(p_org_id, p_role_id) then
    raise exception 'role_above_caller' using errcode = '42501';
  end if;
  -- Losing users.manage needs another active manager.
  if v_membership.archived_at is null
    and exists (
      select 1 from public.role_permissions rp
      where rp.role_id = v_membership.role_id and rp.permission_key = 'users.manage'
    )
    and not exists (
      select 1 from public.role_permissions rp
      where rp.role_id = p_role_id and rp.permission_key = 'users.manage'
    )
    and private.other_user_managers(p_org_id, p_user_id) = 0 then
    raise exception 'last_manager' using errcode = '55000';
  end if;

  select jsonb_build_object('full_name', p.full_name, 'role_id', v_membership.role_id)
  into v_before
  from public.profiles p where p.id = p_user_id;

  update public.profiles set full_name = v_name
  where id = p_user_id and full_name is distinct from v_name;
  update public.memberships set role_id = p_role_id
  where id = v_membership.id and role_id <> p_role_id;

  perform public.write_audit(
    p_org_id, 'users.update', 'profiles', p_user_id::text, v_before,
    jsonb_build_object('full_name', v_name, 'role_id', p_role_id)
  );
end;
$$;

-- Granted permissions, and those of an edited role, must be the caller's.
create or replace function public.save_custom_role(
  p_org_id uuid,
  p_role_id uuid,
  p_name text,
  p_permissions text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_role public.roles;
  v_permissions text[] := array(
    select distinct unnest(coalesce(p_permissions, '{}')) order by 1
  );
  v_before text[];
  v_platform boolean;
begin
  if not private.has_permission(p_org_id, 'roles.manage') then
    raise exception 'missing permission roles.manage' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 100 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  select o.is_platform into v_platform from public.organizations o where o.id = p_org_id;
  -- Same rule as customRolePermissionKeys in src/modules/roles/schemas.ts.
  if exists (
    select 1 from unnest(v_permissions) as k (key)
    left join public.permissions p on p.key = k.key
    where p.key is null
      or k.key in ('platform.manage', 'platform.organizations.delete')
      or (
        coalesce(v_platform, false)
        and p.module_key <> 'platform'
        and k.key not in ('users.read', 'users.manage', 'roles.manage', 'audit.read')
      )
      or (not coalesce(v_platform, false) and p.module_key = 'platform')
  ) then
    raise exception 'invalid_permission' using errcode = '22023';
  end if;
  if not private.caller_holds_all(p_org_id, v_permissions) then
    raise exception 'role_above_caller' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.roles r
    where r.organization_id = p_org_id and r.archived_at is null
      and lower(btrim(r.name)) = lower(v_name)
      and r.id is distinct from p_role_id
  ) then
    raise exception 'name_taken' using errcode = '23505';
  end if;

  if p_role_id is null then
    insert into public.roles (organization_id, key, name, is_system)
    values (
      p_org_id,
      'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
      v_name,
      false
    )
    returning * into v_role;
    v_before := '{}';
  else
    select * into v_role from public.roles r
    where r.id = p_role_id and r.organization_id = p_org_id and r.archived_at is null
    for update;
    if v_role.id is null then
      raise exception 'role not found' using errcode = 'P0002';
    end if;
    if v_role.is_system then
      raise exception 'system_role' using errcode = '42501';
    end if;
    v_before := array(
      select rp.permission_key from public.role_permissions rp
      where rp.role_id = v_role.id order by 1
    );
    if not private.caller_holds_all(p_org_id, v_before) then
      raise exception 'role_above_caller' using errcode = '42501';
    end if;
    update public.roles set name = v_name where id = v_role.id and name <> v_name;
  end if;

  delete from public.role_permissions rp
  where rp.role_id = v_role.id and rp.permission_key <> all (v_permissions);
  insert into public.role_permissions (organization_id, role_id, permission_key)
  select p_org_id, v_role.id, k from unnest(v_permissions) as k
  on conflict do nothing;

  perform public.write_audit(
    p_org_id,
    case when p_role_id is null then 'roles.create' else 'roles.update' end,
    'roles', v_role.id::text,
    case when p_role_id is null then null
      else jsonb_build_object('name', v_role.name, 'permissions', to_jsonb(v_before)) end,
    jsonb_build_object('name', v_name, 'permissions', to_jsonb(v_permissions))
  );
  return v_role.id;
end;
$$;

create or replace function public.archive_custom_role(p_org_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
begin
  if not private.has_permission(p_org_id, 'roles.manage') then
    raise exception 'missing permission roles.manage' using errcode = '42501';
  end if;
  select * into v_role from public.roles r
  where r.id = p_role_id and r.organization_id = p_org_id and r.archived_at is null
  for update;
  if v_role.id is null then
    raise exception 'role not found' using errcode = 'P0002';
  end if;
  if v_role.is_system then
    raise exception 'system_role' using errcode = '42501';
  end if;
  if not private.role_within_caller(p_org_id, p_role_id) then
    raise exception 'role_above_caller' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.memberships m
    where m.role_id = p_role_id and m.archived_at is null
  ) then
    raise exception 'role_in_use' using errcode = '55000';
  end if;
  update public.roles set archived_at = now() where id = p_role_id;
  perform public.write_audit(p_org_id, 'roles.archive', 'roles', p_role_id::text, null, null);
end;
$$;

-- For the server actions that work through the Auth Admin API.
-- Creating a user: may the caller give this role?
create function public.can_assign_role(p_org_id uuid, p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_org_id, 'users.manage')
    and exists (
      select 1 from public.roles r
      where r.id = p_role_id and r.organization_id = p_org_id and r.archived_at is null
    )
    and private.role_within_caller(p_org_id, p_role_id)
$$;

-- Resetting a password: raises like update_member when the caller may not
-- manage this member (missing permission, self, support account, stronger role).
create function public.assert_member_manageable(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.managed_membership(p_org_id, p_user_id);
end;
$$;

revoke execute on function public.can_assign_role(uuid, uuid) from public, anon;
revoke execute on function public.assert_member_manageable(uuid, uuid) from public, anon;
grant execute on function public.can_assign_role(uuid, uuid) to authenticated;
grant execute on function public.assert_member_manageable(uuid, uuid) to authenticated;

-- Direct table writes would bypass the checks above: memberships, roles and
-- role_permissions change only through the security-definer RPCs (and the
-- service role). No app code writes them as the user.
revoke update (role_id, archived_at) on public.memberships from authenticated;
revoke insert (organization_id, role_id, permission_key) on public.role_permissions from authenticated;
revoke delete on public.role_permissions from authenticated;
revoke insert (organization_id, key, name) on public.roles from authenticated;
revoke update (name, archived_at) on public.roles from authenticated;
drop policy memberships_update on public.memberships;
drop policy role_permissions_insert on public.role_permissions;
drop policy role_permissions_delete on public.role_permissions;
drop policy roles_insert on public.roles;
drop policy roles_update on public.roles;
