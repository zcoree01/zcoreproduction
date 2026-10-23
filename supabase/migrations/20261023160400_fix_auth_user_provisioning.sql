-- Fix: Supabase Auth's admin createUser inserts the auth.users row first and
-- writes app_metadata in a follow-up UPDATE within the same transaction. The
-- INSERT-only trigger from 20261023160100 therefore never saw organization_id
-- and created no profile/membership. Provision on INSERT or UPDATE of
-- raw_app_meta_data instead, and backfill users created before this fix.

drop trigger on_auth_user_created on auth.users;
drop function private.handle_new_auth_user();

create function private.provision_auth_user(
  p_user_id uuid,
  p_email text,
  p_app_meta jsonb,
  p_user_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := nullif(p_app_meta ->> 'organization_id', '')::uuid;
  v_username text := lower(p_app_meta ->> 'username');
  v_role_key text := p_app_meta ->> 'role';
  v_slug text;
  v_role_id uuid;
begin
  -- Not an organization user (e.g. future platform staff accounts).
  if v_org_id is null then
    return;
  end if;

  -- Already provisioned: profile and membership are the source of truth;
  -- later app_metadata edits never move a user between organizations.
  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    return;
  end if;

  select o.slug into v_slug
  from public.organizations o
  where o.id = v_org_id and o.archived_at is null;

  if v_slug is null then
    raise exception 'organization % does not exist or is archived', v_org_id;
  end if;

  if p_email is distinct from v_username || '@' || v_slug || '.users.zcore.ba' then
    raise exception 'auth e-mail must be <username>@<org-slug>.users.zcore.ba';
  end if;

  select r.id into v_role_id
  from public.roles r
  where r.organization_id = v_org_id and r.key = v_role_key and r.archived_at is null;

  if v_role_id is null then
    raise exception 'role % does not exist in organization %', v_role_key, v_org_id;
  end if;

  insert into public.profiles (id, organization_id, username, full_name)
  values (p_user_id, v_org_id, v_username, nullif(btrim(p_user_meta ->> 'full_name'), ''));

  insert into public.memberships (organization_id, user_id, role_id)
  values (v_org_id, p_user_id, v_role_id);
end;
$$;

create function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_auth_user(new.id, new.email, new.raw_app_meta_data, new.raw_user_meta_data);
  return new;
end;
$$;

create trigger on_auth_user_provision
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function private.handle_auth_user_change();

-- Backfill users created while the INSERT-only trigger was active.
select private.provision_auth_user(u.id, u.email, u.raw_app_meta_data, u.raw_user_meta_data)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
