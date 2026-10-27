-- Zcore support access and RPC defaults (D-023).
--
--   * A platform admin asks an organization for access with a reason; an
--     admin or director of that organization (support.approve) approves it
--     for a limited time (or rejects it). Only then may the platform admin
--     enter: the server signs them in as the organization's own support user
--     (`zcore-podrska`, role admin, profiles.is_support) through a one-time
--     magic-link token. Ending the session (either side) or the end of the
--     approved time removes all access at once:
--       - private.user_org_ids() / has_permission() ignore a support user
--         without an active, unexpired grant (RLS, every query);
--       - session_status() reports such a session as inactive, so the proxy
--         signs the browser out on the next request.
--     Platform admins never have tenant access otherwise.
--   * Parameter defaults for save_customer, request_company_change and
--     platform_set_module (PostgREST needs them to omit arguments).

-- ---------------------------------------------------------------------------
-- RPC defaults (functions recreated with the same bodies)
-- ---------------------------------------------------------------------------
drop function public.save_customer(uuid, uuid, jsonb, uuid);
drop function public.request_company_change(uuid, uuid, jsonb, jsonb, text);
drop function public.platform_set_module(uuid, text, boolean, timestamptz);

create function public.save_customer(
  p_org_id uuid,
  p_customer jsonb,
  p_customer_id uuid default null,
  p_company_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text := nullif(upper(btrim(coalesce(p_customer ->> 'country', ''))), '');
  v_tax text := private.normalize_tax_id(p_customer ->> 'tax_id');
  v_company public.companies;
  v_company_id uuid := p_company_id;
  v_directory text := 'none';
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_new text;
  v_old text;
  v_id uuid;
  v_number integer := nullif(p_customer ->> 'customer_number', '')::integer;
  v_current_company uuid;
begin
  if not private.has_permission(p_org_id, 'customers.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  -- Bosnian VAT number (12 digits) = ID number without the leading 4.
  if v_country = 'BA' and v_tax ~ '^[0-9]{12}$' then
    v_tax := '4' || v_tax;
  end if;

  if p_customer_id is not null then
    select cu.company_id into v_current_company
    from public.customers cu
    where cu.id = p_customer_id and cu.organization_id = p_org_id and cu.archived_at is null;
    if not found then
      raise exception 'customer not found' using errcode = 'P0002';
    end if;
    v_company_id := coalesce(v_company_id, v_current_company);
  end if;

  if v_company_id is not null then
    select * into v_company from public.companies c where c.id = v_company_id;
    if not found then
      raise exception 'company not found' using errcode = 'P0002';
    end if;
    v_directory := 'linked';
  elsif v_tax is not null and v_country is not null then
    select * into v_company from public.companies c where c.country = v_country and c.tax_id = v_tax;
    if found then
      v_directory := 'linked';
      -- Typed data that differ from the directory: proposal, not overwrite.
      foreach v_key in array array['name', 'address', 'postal_code', 'city', 'phone', 'email'] loop
        v_new := nullif(btrim(p_customer ->> v_key), '');
        execute format('select ($1).%I::text', v_key) into v_old using v_company;
        if v_new is not null and v_new is distinct from v_old then
          v_changes := v_changes || jsonb_build_object(v_key, v_new);
        end if;
      end loop;
    else
      insert into public.companies
        (country, tax_id, name, address, postal_code, city, phone, email, created_by_organization_id)
      values (
        v_country, v_tax, btrim(p_customer ->> 'name'),
        nullif(btrim(p_customer ->> 'address'), ''),
        nullif(btrim(p_customer ->> 'postal_code'), ''),
        nullif(btrim(p_customer ->> 'city'), ''),
        nullif(btrim(p_customer ->> 'phone'), ''),
        nullif(btrim(p_customer ->> 'email'), ''),
        p_org_id
      )
      returning * into v_company;
      v_directory := 'created';
    end if;
    v_company_id := v_company.id;
  end if;

  if v_company_id is not null then
    -- Public data from the directory; contact person, notes and number stay private.
    p_customer := p_customer || jsonb_build_object(
      'name', v_company.name, 'tax_id', v_company.tax_id, 'address', v_company.address,
      'postal_code', v_company.postal_code, 'city', v_company.city, 'country', v_company.country,
      'phone', coalesce(v_company.phone, nullif(btrim(p_customer ->> 'phone'), '')),
      'email', coalesce(v_company.email, nullif(btrim(p_customer ->> 'email'), ''))
    );
  end if;

  if p_customer_id is null then
    insert into public.customers (
      organization_id, customer_number, name, tax_id, address, postal_code, city, country,
      contact_person, phone, email, notes, company_id
    )
    values (
      p_org_id,
      coalesce(v_number, 0),
      btrim(p_customer ->> 'name'),
      nullif(btrim(p_customer ->> 'tax_id'), ''),
      nullif(btrim(p_customer ->> 'address'), ''),
      nullif(btrim(p_customer ->> 'postal_code'), ''),
      nullif(btrim(p_customer ->> 'city'), ''),
      nullif(btrim(p_customer ->> 'country'), ''),
      nullif(btrim(p_customer ->> 'contact_person'), ''),
      nullif(btrim(p_customer ->> 'phone'), ''),
      nullif(btrim(p_customer ->> 'email'), ''),
      nullif(btrim(p_customer ->> 'notes'), ''),
      v_company_id
    )
    returning id into v_id;
  else
    update public.customers set
      customer_number = coalesce(v_number, customer_number),
      name = btrim(p_customer ->> 'name'),
      tax_id = nullif(btrim(p_customer ->> 'tax_id'), ''),
      address = nullif(btrim(p_customer ->> 'address'), ''),
      postal_code = nullif(btrim(p_customer ->> 'postal_code'), ''),
      city = nullif(btrim(p_customer ->> 'city'), ''),
      country = nullif(btrim(p_customer ->> 'country'), ''),
      contact_person = nullif(btrim(p_customer ->> 'contact_person'), ''),
      phone = nullif(btrim(p_customer ->> 'phone'), ''),
      email = nullif(btrim(p_customer ->> 'email'), ''),
      notes = nullif(btrim(p_customer ->> 'notes'), ''),
      company_id = v_company_id
    where id = p_customer_id and organization_id = p_org_id
    returning id into v_id;
  end if;

  if v_changes <> '{}'::jsonb and v_company.owner_organization_id is distinct from p_org_id then
    insert into public.company_change_requests
      (company_id, requested_by_organization_id, requested_by_user_id, changes, reason)
    values (v_company_id, p_org_id, auth.uid(), v_changes, 'Podaci uneseni pri spremanju kupca.');
  end if;

  return jsonb_build_object(
    'id', v_id,
    'company_id', v_company_id,
    'directory', v_directory,
    'change_requested', v_changes <> '{}'::jsonb
  );
end;
$$;

create function public.request_company_change(
  p_org_id uuid,
  p_company_id uuid,
  p_changes jsonb,
  p_reason text default null,
  p_bank_accounts jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
begin
  if not private.has_permission(p_org_id, 'customers.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.customers cu
    where cu.organization_id = p_org_id and cu.company_id = p_company_id and cu.archived_at is null
  ) then
    raise exception 'company is not a customer of this organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.companies c where c.id = p_company_id and c.owner_organization_id = p_org_id) then
    raise exception 'own company: edit it in the settings' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if not v_key = any (private.company_fields()) then
      raise exception 'unknown company field %', v_key using errcode = '22023';
    end if;
  end loop;
  if coalesce(p_changes, '{}'::jsonb) = '{}'::jsonb and p_bank_accounts is null then
    raise exception 'nothing to change' using errcode = '22023';
  end if;

  insert into public.company_change_requests
    (company_id, requested_by_organization_id, requested_by_user_id, changes, bank_accounts, reason)
  values (p_company_id, p_org_id, auth.uid(), coalesce(p_changes, '{}'::jsonb), p_bank_accounts,
    nullif(btrim(p_reason), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.platform_set_module(
  p_org_id uuid, p_module text, p_enabled boolean, p_active_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_module in ('core', 'platform') then
    raise exception 'module % cannot be changed', p_module using errcode = '22023';
  end if;
  if exists (select 1 from public.organizations o where o.id = p_org_id and o.is_platform) then
    raise exception 'platform organization' using errcode = '22023';
  end if;
  insert into public.org_modules (organization_id, module_key, enabled, enabled_at, active_until)
  values (p_org_id, p_module, p_enabled, case when p_enabled then now() end, p_active_until)
  on conflict (organization_id, module_key) do update
  set enabled = excluded.enabled,
      enabled_at = case when excluded.enabled and not public.org_modules.enabled then now()
                        else public.org_modules.enabled_at end,
      active_until = excluded.active_until;
end;
$$;

revoke execute on function
  public.save_customer(uuid, jsonb, uuid, uuid),
  public.request_company_change(uuid, uuid, jsonb, text, jsonb),
  public.platform_set_module(uuid, text, boolean, timestamptz)
from public, anon;
grant execute on function
  public.save_customer(uuid, jsonb, uuid, uuid),
  public.request_company_change(uuid, uuid, jsonb, text, jsonb),
  public.platform_set_module(uuid, text, boolean, timestamptz)
to authenticated;

-- ---------------------------------------------------------------------------
-- Support users and permission
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column is_support boolean not null default false;

comment on column public.profiles.is_support is
  'The organization''s Zcore support account: usable only during an approved support session.';

insert into public.permissions (key, module_key, description, default_roles) values
  ('support.approve', 'core', 'Approve or end Zcore support access to the organization',
    '{admin,director}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'support.approve'
from public.roles r
where r.is_system and r.key in ('admin', 'director')
on conflict do nothing;

create table public.support_access_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  requested_by uuid not null,
  requester_name text not null check (length(btrim(requester_name)) between 1 and 200),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'active', 'ended', 'cancelled')),
  -- Approved access lasts this long from the approval.
  duration_minutes integer check (duration_minutes between 15 and 480),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 1 and 1000),
  approved_until timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

comment on table public.support_access_requests is
  'Zcore support access to an organization: requested by a platform admin, approved by the organization.';

-- At most one open request per organization.
create unique index support_access_requests_open_key
  on public.support_access_requests (organization_id)
  where status in ('pending', 'approved', 'active');

revoke all on public.support_access_requests from anon, authenticated;
grant select on public.support_access_requests to authenticated;
alter table public.support_access_requests enable row level security;

create policy support_access_requests_select on public.support_access_requests
  for select to authenticated
  using (private.has_permission(organization_id, 'support.approve'));

/** True while the organization has an approved support session that has not ended or expired. */
create function private.support_active(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.support_access_requests r
    where r.organization_id = p_org_id
      and r.status in ('approved', 'active')
      and r.approved_until > now()
  )
$$;

-- Membership checks ignore a support user without an active grant.
create or replace function private.user_org_ids()
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
    and (not p.is_support or private.support_active(m.organization_id))
$$;

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
    where m.organization_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.archived_at is null
      and rp.permission_key = p_permission
      and (not p.is_support or private.support_active(m.organization_id))
  )
$$;

-- The proxy signs a support session out as soon as its grant is gone.
create or replace function public.session_status()
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
    )
    and not exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_support
        and not private.support_active(p.organization_id)
    ),
    coalesce(
      (select p.must_change_password from public.profiles p where p.id = (select auth.uid())),
      false
    )
$$;

-- Provisioning: app_metadata.is_support marks the support account.
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
  v_support boolean := coalesce((p_app_meta ->> 'is_support')::boolean, false);
  v_slug text;
  v_role_id uuid;
begin
  if v_org_id is null then
    return;
  end if;

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

  insert into public.profiles (id, organization_id, username, full_name, must_change_password, is_support)
  values (
    p_user_id, v_org_id, v_username, nullif(btrim(p_user_meta ->> 'full_name'), ''), v_must_change,
    v_support
  );

  insert into public.memberships (organization_id, user_id, role_id)
  values (v_org_id, p_user_id, v_role_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Support RPCs
-- ---------------------------------------------------------------------------
create function public.platform_request_support(p_org_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
begin
  perform private.require_platform_admin();
  if exists (select 1 from public.organizations o where o.id = p_org_id and (o.is_platform or o.archived_at is not null)) then
    raise exception 'organization not available' using errcode = '22023';
  end if;
  select coalesce(p.full_name, p.username) into v_name from public.profiles p where p.id = auth.uid();
  insert into public.support_access_requests (organization_id, requested_by, requester_name, reason)
  values (p_org_id, auth.uid(), coalesce(v_name, 'Zcore'), btrim(p_reason))
  returning id into v_id;
  perform private.write_audit_as(p_org_id, 'support.requested', 'support_access_requests', v_id::text,
    null, jsonb_build_object('reason', btrim(p_reason), 'requester', v_name));
  return v_id;
end;
$$;

/** Latest requests of all organizations for the platform admin (status only). */
create function public.platform_support_requests()
returns table (
  id uuid,
  organization_id uuid,
  status text,
  reason text,
  requester_name text,
  duration_minutes integer,
  approved_until timestamptz,
  decision_note text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
  select distinct on (r.organization_id)
    r.id, r.organization_id,
    case when r.status in ('approved', 'active') and r.approved_until <= now() then 'ended' else r.status end,
    r.reason, r.requester_name, r.duration_minutes, r.approved_until, r.decision_note, r.created_at
  from public.support_access_requests r
  order by r.organization_id, r.created_at desc;
end;
$$;

create function public.decide_support_request(
  p_org_id uuid, p_request_id uuid, p_approve boolean, p_minutes integer default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.support_access_requests;
begin
  if not private.has_permission(p_org_id, 'support.approve') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_request from public.support_access_requests
  where id = p_request_id and organization_id = p_org_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'request not found or already decided' using errcode = 'P0002';
  end if;
  if p_approve and (p_minutes is null or p_minutes not between 15 and 480) then
    raise exception 'duration must be 15..480 minutes' using errcode = '22023';
  end if;

  update public.support_access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      duration_minutes = case when p_approve then p_minutes end,
      approved_until = case when p_approve then now() + make_interval(mins => p_minutes) end,
      decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(btrim(p_note), '')
  where id = p_request_id;

  perform private.write_audit_as(p_org_id,
    case when p_approve then 'support.approved' else 'support.rejected' end,
    'support_access_requests', p_request_id::text, null,
    jsonb_build_object('minutes', p_minutes, 'note', nullif(btrim(p_note), '')));
end;
$$;

/**
 * Platform admin starts an approved session: the request becomes active.
 * Returns the organization's id and slug for the sign-in of the support user.
 */
create function public.platform_begin_support(p_request_id uuid)
returns table (organization_id uuid, slug text, approved_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.support_access_requests;
begin
  perform private.require_platform_admin();
  select * into v_request from public.support_access_requests where id = p_request_id for update;
  if not found or v_request.status not in ('approved', 'active') or v_request.approved_until <= now() then
    raise exception 'support access is not approved' using errcode = '42501';
  end if;
  update public.support_access_requests
  set status = 'active', started_at = coalesce(started_at, now())
  where id = p_request_id;
  perform private.write_audit_as(v_request.organization_id, 'support.started',
    'support_access_requests', p_request_id::text, null, null);
  return query
  select o.id, o.slug, v_request.approved_until
  from public.organizations o where o.id = v_request.organization_id;
end;
$$;

/**
 * Ends support access: by the organization (support.approve), the platform
 * admin, or the support user inside the organization. Returns the
 * organization id so the server can sign the support user out everywhere.
 */
create function public.end_support(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.support_access_requests;
  v_is_support boolean;
begin
  select * into v_request from public.support_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  select p.is_support into v_is_support
  from public.profiles p where p.id = auth.uid() and p.organization_id = v_request.organization_id;
  if not (private.has_permission(v_request.organization_id, 'support.approve')
          or private.is_platform_admin()
          or coalesce(v_is_support, false)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_request.status in ('pending', 'approved', 'active') then
    update public.support_access_requests
    set status = case when v_request.status = 'pending' then 'cancelled' else 'ended' end,
        ended_at = now(), ended_by = auth.uid()
    where id = p_request_id;
    perform private.write_audit_as(v_request.organization_id, 'support.ended',
      'support_access_requests', p_request_id::text, null, null);
  end if;
  return v_request.organization_id;
end;
$$;

/** The current support session of the caller's organization (for the support banner). */
create function public.current_support_session(p_org_id uuid)
returns table (id uuid, approved_until timestamptz, requester_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.approved_until, r.requester_name
  from public.support_access_requests r
  where r.organization_id = p_org_id
    and p_org_id in (select private.user_org_ids())
    and r.status in ('approved', 'active')
    and r.approved_until > now()
  order by r.created_at desc
  limit 1
$$;

revoke execute on function
  public.platform_request_support(uuid, text),
  public.platform_support_requests(),
  public.decide_support_request(uuid, uuid, boolean, integer, text),
  public.platform_begin_support(uuid),
  public.end_support(uuid),
  public.current_support_session(uuid)
from public, anon;
grant execute on function
  public.platform_request_support(uuid, text),
  public.platform_support_requests(),
  public.decide_support_request(uuid, uuid, boolean, integer, text),
  public.platform_begin_support(uuid),
  public.end_support(uuid),
  public.current_support_session(uuid)
to authenticated;
