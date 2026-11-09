-- Prepaid billing, final review fixes (D-050).
--
-- 1. A month is never due before the day its billing actually began. A firm
--    that gets its first package (or a package after months without one) on
--    the 20th, or is restored from the archive on the 20th, used to be due on
--    the 1st + grace and was locked on the spot. Now the start day is the
--    assignment day or the restore day: due_on = greatest(period, assigned
--    day, restore day, prepaid_since) + grace.
-- 2. organization_billing.prepaid_since: a per-firm transition day that
--    overrides platform_settings.prepaid_since (tests set it on their own
--    fixture firm instead of rewriting the global value).
-- 3. Archive and restore days are counted in the firm's timezone, not UTC.
-- 4. platform_billing_overview also returns the firm's timezone (the list
--    shows the deletion date in it, like the firm page).

alter table public.organization_packages add column assigned_on date;
comment on column public.organization_packages.assigned_on is
  'Org-local day the package was assigned (platform_assign_package). When billing begins with this row, the month is due from this day + grace.';
-- Existing rows: the first assignment of a package in that month (audit log,
-- org-local day), so a firm already assigned late this month is not locked;
-- otherwise the first day of the month (unchanged due date).
update public.organization_packages op
set assigned_on = coalesce(
  (select min((a.created_at at time zone o.timezone)::date)
   from public.audit_log a
   join public.organizations o on o.id = a.organization_id
   where a.organization_id = op.organization_id
     and a.action = 'billing.package_assigned'
     and a.after ->> 'package_id' is not null
     and (a.created_at at time zone o.timezone)::date >= op.valid_from
     and (a.created_at at time zone o.timezone)::date < (op.valid_from + interval '1 month')::date),
  op.valid_from)
where op.assigned_on is null;

alter table public.organization_billing add column prepaid_since date;
comment on column public.organization_billing.prepaid_since is
  'Per-firm transition day of the prepaid rule; null = platform_settings.prepaid_since.';

-- Same as 20261110190000_organization_archive.sql, plus: the start day of a
-- month (assignment or restore during that month), the per-firm transition
-- day, and archive/restore days in the firm's timezone.
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
      coalesce(
        (select ob.prepaid_since from public.organization_billing ob where ob.organization_id = p_org),
        (select s.prepaid_since from public.platform_settings s)
      ) as prepaid_since,
      (select o.timezone from public.organizations o where o.id = p_org) as tz
  ),
  archive as (
    select
      (ap.archived_at at time zone b.tz)::date as archived_day,
      (ap.restored_at at time zone b.tz)::date as restored_day
    from public.organization_archive_periods ap, bounds b
    where ap.organization_id = p_org
  ),
  months as (
    select m::date as period, b.grace, b.prepaid_since
    from bounds b, generate_series(b.first_month, b.this_month, interval '1 month') as m
    where b.first_month is not null
      and not exists (
        select 1 from archive a
        where a.archived_day <= m::date
          and (a.restored_day is null or date_trunc('month', a.restored_day)::date > m::date)
      )
  ),
  billed as (
    select
      m.period,
      m.grace,
      m.prepaid_since,
      private.org_package_on(p_org, m.period) as package_id,
      -- Billing began this month with a package assignment: the firm had no
      -- package the month before (trial, or a removed package).
      (select op.assigned_on from public.organization_packages op
       where op.organization_id = p_org and op.valid_from = m.period
         and op.package_id is not null
         and op.assigned_on >= m.period
         and op.assigned_on < (m.period + interval '1 month')::date
         and private.org_package_on(p_org, (m.period - interval '1 month')::date) is null
      ) as assigned_on,
      -- Billing began again this month with a restore from the archive.
      (select max(a.restored_day) from archive a
       where a.restored_day >= m.period
         and a.restored_day < (m.period + interval '1 month')::date
      ) as restored_on
    from months m
  )
  select
    b.period,
    b.package_id,
    p.name,
    private.package_price_on(b.package_id, b.period),
    greatest(b.period, b.assigned_on, b.restored_on, b.prepaid_since) + b.grace,
    pay.paid_on,
    pay.note
  from billed b
  join public.billing_packages p on p.id = b.package_id
  left join public.billing_payments pay on pay.organization_id = p_org and pay.period = b.period
  order by b.period
$$;

-- Same as the live definition (20261110150000_package_removal.sql with the
-- permission check of 20261110171000_platform_permission_checks.sql), plus:
-- records the org-local assignment day. Changing the package again in the
-- same month keeps the first day billing began (unless the month had no
-- package until now).
create or replace function public.platform_assign_package(p_org_id uuid, p_package_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_today date;
  v_before uuid;
begin
  perform private.require_platform_permission('platform.packages.assign');
  perform private.assert_billable_org(p_org_id);
  if p_package_id is not null and not exists (
    select 1 from public.billing_packages p where p.id = p_package_id and p.archived_at is null
  ) then
    raise exception 'package not found' using errcode = 'P0002';
  end if;
  v_today := private.org_today(p_org_id);
  v_month := date_trunc('month', v_today)::date;
  v_before := private.org_package_on(p_org_id, v_month);
  insert into public.organization_packages (organization_id, valid_from, package_id, assigned_on)
  values (p_org_id, v_month, p_package_id, v_today)
  on conflict (organization_id, valid_from) do update
    set package_id = excluded.package_id,
        assigned_on = case
          when public.organization_packages.package_id is null then excluded.assigned_on
          else public.organization_packages.assigned_on
        end;
  if p_package_id is null then
    if v_before is not null then
      update public.org_modules om set enabled = false
      where om.organization_id = p_org_id
        and om.enabled
        and om.active_until is null
        and om.module_key not in ('core', 'platform');
    end if;
  else
    perform private.sync_package_modules(p_org_id);
  end if;
  perform private.billing_audit(p_org_id, 'billing.package_assigned', p_package_id::text,
    jsonb_build_object('package_id', v_before), jsonb_build_object('package_id', p_package_id));
end;
$$;

-- Same columns as 20261110190000, plus timezone at the end.
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
  delete_after timestamptz,
  timezone text
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
    o.delete_after,
    o.timezone
  from public.organizations o
  left join public.billing_packages p
    on p.id = private.org_package_on(o.id, date_trunc('month', private.org_today(o.id))::date)
  cross join lateral private.org_lock_state(o.id) s
  where not o.is_platform
  order by o.name;
end;
$$;

revoke all on function public.platform_billing_overview() from public, anon;
grant execute on function public.platform_billing_overview() to authenticated, service_role;
