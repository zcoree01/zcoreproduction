-- Custom roles and the platform permissions (Zcore organization, part 1):
-- save_custom_role now checks the permission list the same way as
-- customRolePermissionKeys in the app. The Zcore organization may only give
-- platform permissions (except platform.manage and platform.organizations.delete)
-- plus users.read, users.manage, roles.manage and audit.read; every other
-- organization nothing from the platform module. Otherwise unchanged
-- (signature, grants, audit, name checks).

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

revoke execute on function public.save_custom_role(uuid, uuid, text, text[]) from public, anon;
grant execute on function public.save_custom_role(uuid, uuid, text, text[]) to authenticated;
