-- Profile settings and temporary passwords (D-022).
--   * profiles.must_change_password: set when an administrator creates a user
--     or resets a password (the server generates a temporary password). The
--     proxy sends such users to /change-password until they choose their own.
--     Only the server (service role) changes the flag; users cannot clear it.
--   * profiles.preferences: per-user display settings (text size), editable by
--     the user.
--   * public.session_status(): one round trip for the proxy (session still
--     active + must change password); replaces the proxy's is_session_active()
--     call (kept for compatibility).
--   * public.revoke_user_sessions(): signs a user out on every device after an
--     administrator reset their password (service role only).

alter table public.profiles
  add column must_change_password boolean not null default false,
  add column preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object');

comment on column public.profiles.must_change_password is
  'True while the user still has a temporary password set by an administrator.';
comment on column public.profiles.preferences is
  'Per-user display settings, e.g. {"text_size": "large"}.';

grant update (preferences) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Provisioning: app_metadata.must_change_password = true marks a user created
-- with a temporary password (set atomically with the profile).
-- ---------------------------------------------------------------------------
create or replace function private.provision_auth_user(
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
  v_must_change boolean := coalesce((p_app_meta ->> 'must_change_password')::boolean, false);
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

  insert into public.profiles (id, organization_id, username, full_name, must_change_password)
  values (
    p_user_id, v_org_id, v_username, nullif(btrim(p_user_meta ->> 'full_name'), ''), v_must_change
  );

  insert into public.memberships (organization_id, user_id, role_id)
  values (v_org_id, p_user_id, v_role_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Session status for the proxy
-- ---------------------------------------------------------------------------
create function public.session_status()
returns table (active boolean, must_change_password boolean)
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
    )
$$;

comment on function public.session_status() is
  'Whether the calling JWT''s session still exists and whether the user must replace a temporary password.';

revoke execute on function public.session_status() from public, anon;
grant execute on function public.session_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Sign a user out everywhere (after an administrator password reset)
-- ---------------------------------------------------------------------------
create function public.revoke_user_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user_id
$$;

comment on function public.revoke_user_sessions(uuid) is
  'Deletes every session of a user (service role only; used after a password reset).';

revoke execute on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Users list shows who still has a temporary password
-- ---------------------------------------------------------------------------
create or replace view public.member_directory
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
  m.archived_at,
  p.must_change_password
from public.memberships m
join public.profiles p on p.id = m.user_id and p.organization_id = m.organization_id
join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id;
