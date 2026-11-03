-- User management (D-044): edit a member's full name and role, deactivate
-- and reactivate. users.manage; never oneself (that stays the profile
-- page), never the Zcore support account; the organization always keeps at
-- least one active member who can manage users. The membership audit
-- trigger records the change; a semantic entry names the action.

-- Active members other than p_user_id whose role has users.manage.
create function private.other_user_managers(p_org_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.memberships m
  join public.profiles p on p.id = m.user_id and p.archived_at is null and not p.is_support
  join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'users.manage'
  where m.organization_id = p_org_id and m.archived_at is null and m.user_id <> p_user_id
$$;

revoke execute on function private.other_user_managers(uuid, uuid) from public;
grant execute on function private.other_user_managers(uuid, uuid) to authenticated;

-- The target's membership, locked; raises for oneself, support or unknown.
create function private.managed_membership(p_org_id uuid, p_user_id uuid)
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
  return v_membership;
end;
$$;

revoke execute on function private.managed_membership(uuid, uuid) from public;
grant execute on function private.managed_membership(uuid, uuid) to authenticated;

create function public.update_member(
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

create function public.set_member_active(p_org_id uuid, p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships := private.managed_membership(p_org_id, p_user_id);
begin
  if p_active is null then
    raise exception 'invalid' using errcode = '22023';
  end if;
  if (v_membership.archived_at is null) = p_active then
    return;
  end if;
  if not p_active
    and exists (
      select 1 from public.role_permissions rp
      where rp.role_id = v_membership.role_id and rp.permission_key = 'users.manage'
    )
    and private.other_user_managers(p_org_id, p_user_id) = 0 then
    raise exception 'last_manager' using errcode = '55000';
  end if;
  update public.memberships
  set archived_at = case when p_active then null else now() end
  where id = v_membership.id;
  perform public.write_audit(
    p_org_id, case when p_active then 'users.reactivate' else 'users.deactivate' end,
    'profiles', p_user_id::text, null, null
  );
end;
$$;

revoke execute on function public.update_member(uuid, uuid, text, uuid) from public, anon;
revoke execute on function public.set_member_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.update_member(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.set_member_active(uuid, uuid, boolean) to authenticated;
