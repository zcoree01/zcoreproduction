-- Archive and restore a firm, schedule its deletion with a 30-day undo (D-049).
-- Archiving cuts access (private.user_org_ids already ignores archived firms),
-- stops the kiosk, ends an open support session and stops billing from the
-- month after the archive month until the restore month. Purge comes later.

alter table public.organizations
  add column archived_reason text check (length(archived_reason) <= 300),
  add column delete_after timestamptz;
comment on column public.organizations.delete_after is
  'Set when deletion is scheduled; the firm is purged after this moment unless cancelled.';

create table public.organization_archive_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  archived_at timestamptz not null,
  restored_at timestamptz,
  archived_by uuid,
  reason text
);
comment on table public.organization_archive_periods is
  'Each time a firm was archived (and when restored); archived months are not billed.';
create unique index organization_archive_periods_open_idx
  on public.organization_archive_periods (organization_id) where restored_at is null;
create index organization_archive_periods_org_idx
  on public.organization_archive_periods (organization_id, archived_at);
alter table public.organization_archive_periods enable row level security;
revoke all on public.organization_archive_periods from anon, authenticated;
create trigger lock_guard before insert or update or delete on public.organization_archive_periods
  for each row execute function private.lock_guard();

-- Existing archived firms get an open period so they stop being billed too.
insert into public.organization_archive_periods (organization_id, archived_at)
select o.id, o.archived_at from public.organizations o
where o.archived_at is not null and not o.is_platform;

-- Kiosk devices of an archived firm are refused like a revoked or unknown device
-- (kiosk_session and kiosk_clock both go through this function). Same as
-- 20261110100000_module_split.sql otherwise.
create or replace function private.kiosk_device(p_org_slug text, p_kiosk_id uuid, p_secret text)
returns public.attendance_kiosks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_kiosks;
begin
  select k.* into v_row
  from public.attendance_kiosks k
  join public.organizations o on o.id = k.organization_id
  where k.id = p_kiosk_id and o.slug = p_org_slug
    and o.archived_at is null
    and k.secret_hash is not null and k.secret_hash = private.sha256(p_secret)
    and k.revoked_at is null;
  if v_row.id is null then
    raise exception 'kiosk_unknown' using errcode = '42501';
  end if;
  if not private.module_enabled(v_row.organization_id, 'kiosk') then
    raise exception 'module_disabled' using errcode = '42501';
  end if;
  update public.attendance_kiosks set last_seen_at = now() where id = v_row.id;
  return v_row;
end;
$$;

-- Same as 20261110180000_prepaid_billing.sql, plus: archived months are not billed.
create or replace function private.billing_months(p_org uuid)
returns table (
  period date,
  package_id uuid,
  package_name text,
  amount numeric,
  due_on date,
  paid_on date,
  note text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (select min(op.valid_from) from public.organization_packages op
       where op.organization_id = p_org and op.package_id is not null) as first_month,
      date_trunc('month', private.org_today(p_org))::date as this_month,
      private.org_grace_days(p_org) as grace,
      (select s.prepaid_since from public.platform_settings s) as prepaid_since
  ),
  months as (
    select m::date as period, b.grace, b.prepaid_since
    from bounds b, generate_series(b.first_month, b.this_month, interval '1 month') as m
    where b.first_month is not null
      and not exists (
        select 1 from public.organization_archive_periods ap
        where ap.organization_id = p_org
          and ap.archived_at::date <= m::date
          and (ap.restored_at is null or date_trunc('month', ap.restored_at)::date > m::date)
      )
  ),
  billed as (
    select m.period, m.grace, m.prepaid_since, private.org_package_on(p_org, m.period) as package_id
    from months m
  )
  select
    b.period,
    b.package_id,
    p.name,
    private.package_price_on(b.package_id, b.period),
    greatest(b.period + b.grace, b.prepaid_since + b.grace),
    pay.paid_on,
    pay.note
  from billed b
  join public.billing_packages p on p.id = b.package_id
  left join public.billing_payments pay on pay.organization_id = p_org and pay.period = b.period
  order by b.period
$$;

-- Same columns as before, plus archived_at and delete_after at the end.
drop function public.platform_billing_overview();
create function public.platform_billing_overview()
returns table (
  organization_id uuid,
  name text,
  slug text,
  package_name text,
  monthly_price numeric,
  state text,
  last_paid_period date,
  member_count integer,
  is_platform boolean,
  archived boolean,
  archived_at timestamptz,
  delete_after timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
  select o.id, o.name, o.slug, p.name,
    private.package_price_on(p.id, date_trunc('month', private.org_today(o.id))::date),
    s.state,
    (select max(bp.period) from public.billing_payments bp where bp.organization_id = o.id),
    (select count(*)::integer from public.memberships m
     where m.organization_id = o.id and m.archived_at is null),
    o.is_platform,
    o.archived_at is not null,
    o.archived_at,
    o.delete_after
  from public.organizations o
  left join public.billing_packages p
    on p.id = private.org_package_on(o.id, date_trunc('month', private.org_today(o.id))::date)
  cross join lateral private.org_lock_state(o.id) s
  where not o.is_platform
  order by o.name;
end;
$$;

create function public.platform_archive_organization(p_org_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(p_reason);
  v_org public.organizations;
begin
  perform private.require_platform_permission('platform.organizations.archive');
  perform private.assert_billable_org(p_org_id);
  if v_reason is null or length(v_reason) not between 1 and 300 then
    raise exception 'invalid reason' using errcode = '22023';
  end if;
  select * into v_org from public.organizations o where o.id = p_org_id for update;
  if v_org.archived_at is not null then
    raise exception 'already_archived' using errcode = '22023';
  end if;
  update public.organizations
  set archived_at = now(), archived_reason = v_reason
  where id = p_org_id;
  insert into public.organization_archive_periods (organization_id, archived_at, archived_by, reason)
  values (p_org_id, now(), auth.uid(), v_reason);
  -- An open support session ends with the archive (a request not yet approved is cancelled).
  update public.support_access_requests r
  set status = case when r.status = 'pending' then 'cancelled' else 'ended' end,
      ended_at = now(), ended_by = auth.uid()
  where r.organization_id = p_org_id and r.status in ('pending', 'approved', 'active');
  perform private.billing_audit(private.platform_org_id(), 'organization.archived',
    p_org_id::text, null, jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'reason', v_reason));
end;
$$;

create function public.platform_restore_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  perform private.require_platform_permission('platform.organizations.archive');
  perform private.assert_billable_org(p_org_id);
  select * into v_org from public.organizations o where o.id = p_org_id for update;
  if v_org.archived_at is null then
    raise exception 'not_archived' using errcode = '22023';
  end if;
  if v_org.delete_after is not null then
    raise exception 'deletion_scheduled' using errcode = '22023';
  end if;
  update public.organizations set archived_at = null, archived_reason = null where id = p_org_id;
  update public.organization_archive_periods
  set restored_at = now()
  where organization_id = p_org_id and restored_at is null;
  perform private.billing_audit(private.platform_org_id(), 'organization.restored',
    p_org_id::text,
    jsonb_build_object('archived_at', v_org.archived_at, 'reason', v_org.archived_reason),
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug));
end;
$$;

create function public.platform_schedule_organization_deletion(p_org_id uuid, p_confirm_name text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_after timestamptz;
begin
  perform private.require_platform_permission('platform.organizations.delete');
  perform private.assert_billable_org(p_org_id);
  select * into v_org from public.organizations o where o.id = p_org_id for update;
  if v_org.archived_at is null then
    raise exception 'not_archived' using errcode = '22023';
  end if;
  if v_org.delete_after is not null then
    raise exception 'already_scheduled' using errcode = '22023';
  end if;
  if p_confirm_name is null or btrim(p_confirm_name) <> v_org.name then
    raise exception 'name_mismatch' using errcode = '22023';
  end if;
  v_after := now() + interval '30 days';
  update public.organizations set delete_after = v_after where id = p_org_id;
  perform private.billing_audit(private.platform_org_id(), 'organization.deletion_scheduled',
    p_org_id::text, null,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'delete_after', v_after));
  return v_after;
end;
$$;

create function public.platform_cancel_organization_deletion(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  perform private.require_platform_permission('platform.organizations.delete');
  perform private.assert_billable_org(p_org_id);
  select * into v_org from public.organizations o where o.id = p_org_id for update;
  if v_org.delete_after is null then
    raise exception 'not_scheduled' using errcode = '22023';
  end if;
  update public.organizations set delete_after = null where id = p_org_id;
  perform private.billing_audit(private.platform_org_id(), 'organization.deletion_cancelled',
    p_org_id::text,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'delete_after', v_org.delete_after),
    null);
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.platform_billing_overview()',
    'public.platform_archive_organization(uuid, text)',
    'public.platform_restore_organization(uuid)',
    'public.platform_schedule_organization_deletion(uuid, text)',
    'public.platform_cancel_organization_deletion(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;
end;
$$;
