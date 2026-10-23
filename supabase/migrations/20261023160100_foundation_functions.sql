-- Foundation functions and triggers: membership/permission checks, audit,
-- organization bootstrap, auth user provisioning.
-- All SECURITY DEFINER functions pin search_path = '' and fully qualify names.

-- ---------------------------------------------------------------------------
-- Access checks (used by RLS policies and RPC)
-- ---------------------------------------------------------------------------
create function private.user_org_ids()
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
  where m.user_id = (select auth.uid())
    and m.archived_at is null
$$;

create function private.has_permission(p_org_id uuid, p_permission text)
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
    where m.organization_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.archived_at is null
      and rp.permission_key = p_permission
  )
$$;

-- RPC entry point for requirePermission() on the server.
create function public.has_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_permission(p_org_id, p_permission)
$$;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger roles_set_updated_at before update on public.roles
  for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();
create trigger org_modules_set_updated_at before update on public.org_modules
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function private.prevent_audit_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.prevent_audit_mutation();

-- Generic row-change audit for security-relevant tables.
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org_id uuid;
  v_entity_id text;
begin
  -- Skip updates that only touched updated_at.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;

  v_org_id := case
    when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
    else (v_row ->> 'organization_id')::uuid
  end;

  v_entity_id := case tg_table_name
    when 'role_permissions' then (v_row ->> 'role_id') || ':' || (v_row ->> 'permission_key')
    when 'org_modules' then v_row ->> 'module_key'
    else v_row ->> 'id'
  end;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_org_id, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, v_entity_id, v_old, v_new);

  return null;
end;
$$;

create trigger organizations_audit after insert or update on public.organizations
  for each row execute function private.audit_row_change();
create trigger roles_audit after insert or update on public.roles
  for each row execute function private.audit_row_change();
create trigger role_permissions_audit after insert or delete on public.role_permissions
  for each row execute function private.audit_row_change();
create trigger memberships_audit after insert or update on public.memberships
  for each row execute function private.audit_row_change();
create trigger org_modules_audit after insert or update on public.org_modules
  for each row execute function private.audit_row_change();

-- Explicit audit entries from server actions. Actor is always the caller.
create function public.write_audit(
  p_org_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (p_org_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after);
end;
$$;

-- ---------------------------------------------------------------------------
-- Organization bootstrap: system roles, default permissions, core module
-- ---------------------------------------------------------------------------
create function private.bootstrap_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.roles (organization_id, key, name, is_system) values
    (new.id, 'admin', 'Administrator', true),
    (new.id, 'director', 'Direktor', true),
    (new.id, 'head_of_production', 'Šef proizvodnje', true),
    (new.id, 'warehouse', 'Skladištar', true),
    (new.id, 'operator', 'Operater', true);

  insert into public.role_permissions (organization_id, role_id, permission_key)
  select new.id, r.id, p.key
  from public.roles r
  join public.permissions p on r.key = any (p.default_roles)
  where r.organization_id = new.id;

  insert into public.org_modules (organization_id, module_key, enabled, enabled_at)
  values (new.id, 'core', true, now());

  return null;
end;
$$;

create trigger organizations_bootstrap after insert on public.organizations
  for each row execute function private.bootstrap_organization();

-- ---------------------------------------------------------------------------
-- Auth user provisioning
-- ---------------------------------------------------------------------------
-- Users are created with the Admin API, passing app_metadata
-- { organization_id, username, role }. Profile and membership are created in
-- the same transaction, so there is never an auth user without a membership.
-- app_metadata is writable only with the service role, so it can be trusted.
create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := nullif(new.raw_app_meta_data ->> 'organization_id', '')::uuid;
  v_username text := lower(new.raw_app_meta_data ->> 'username');
  v_role_key text := new.raw_app_meta_data ->> 'role';
  v_slug text;
  v_role_id uuid;
begin
  -- Not an organization user (e.g. future platform staff accounts).
  if v_org_id is null then
    return new;
  end if;

  select o.slug into v_slug
  from public.organizations o
  where o.id = v_org_id and o.archived_at is null;

  if v_slug is null then
    raise exception 'organization % does not exist or is archived', v_org_id;
  end if;

  if new.email is distinct from v_username || '@' || v_slug || '.users.zcore.ba' then
    raise exception 'auth e-mail must be <username>@<org-slug>.users.zcore.ba';
  end if;

  select r.id into v_role_id
  from public.roles r
  where r.organization_id = v_org_id and r.key = v_role_key and r.archived_at is null;

  if v_role_id is null then
    raise exception 'role % does not exist in organization %', v_role_key, v_org_id;
  end if;

  insert into public.profiles (id, organization_id, username, full_name)
  values (new.id, v_org_id, v_username, nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''));

  insert into public.memberships (organization_id, user_id, role_id)
  values (v_org_id, new.id, v_role_id);

  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();
