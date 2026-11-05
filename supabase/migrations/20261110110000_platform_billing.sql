-- Platform billing (D-049). Zcore sells packages (sets of modules, one monthly
-- price) and records payments by hand: firms pay invoices by bank transfer. A
-- month is paid or not (no instalments). The state of a firm (trial, active,
-- warning, overdue, locked) is computed from these tables whenever it is read,
-- so a payment unlocks at once and the due date locks exactly, without a job.
--
-- Platform tables: no tenant grants; only the platform RPCs below (platform
-- admin) read and write them. Firms see their own state through
-- my_billing_notice (20261110120000).

create table public.billing_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index billing_packages_name_key on public.billing_packages (lower(btrim(name)))
  where archived_at is null;

-- Price history: a month costs the price valid on its first day.
create table public.billing_package_prices (
  package_id uuid not null references public.billing_packages (id) on delete restrict,
  valid_from date not null check (extract(day from valid_from) = 1),
  monthly_price numeric(12, 2) not null check (monthly_price >= 0),
  primary key (package_id, valid_from)
);

create table public.billing_package_modules (
  package_id uuid not null references public.billing_packages (id) on delete restrict,
  module_key text not null references public.modules (key) on delete restrict,
  primary key (package_id, module_key),
  check (module_key not in ('core', 'platform'))
);

-- A firm's package per month (null = no package from that month on).
create table public.organization_packages (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  valid_from date not null check (extract(day from valid_from) = 1),
  package_id uuid references public.billing_packages (id) on delete restrict,
  primary key (organization_id, valid_from)
);

create index organization_packages_package_idx on public.organization_packages (package_id);

create table public.organization_billing (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  grace_days integer check (grace_days between 0 and 90),
  auto_lock boolean not null default true,
  locked_at timestamptz,
  locked_reason text check (length(locked_reason) <= 300),
  unlocked_until date,
  updated_at timestamptz not null default now(),
  check ((locked_at is null) = (locked_reason is null))
);

-- A row = the month is paid; "Poništi" deletes it (the audit log keeps it).
create table public.billing_payments (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  period date not null check (extract(day from period) = 1),
  paid_on date not null,
  note text check (length(note) <= 200),
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  primary key (organization_id, period)
);

alter table public.platform_settings
  add column payment_grace_days integer not null default 15 check (payment_grace_days between 0 and 90),
  add column lock_warning_days integer not null default 5 check (lock_warning_days between 0 and 30),
  add column lock_contact text not null default '' check (length(lock_contact) <= 300);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'billing_packages', 'billing_package_prices', 'billing_package_modules',
    'organization_packages', 'organization_billing', 'billing_payments'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Computed state
-- ---------------------------------------------------------------------------

create function private.org_today(p_org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_org
$$;

create function private.org_grace_days(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.grace_days from public.organization_billing b where b.organization_id = p_org),
    (select s.payment_grace_days from public.platform_settings s)
  )
$$;

-- The package of a firm in a month (null: none).
create function private.org_package_on(p_org uuid, p_period date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select op.package_id from public.organization_packages op
  where op.organization_id = p_org and op.valid_from <= p_period
  order by op.valid_from desc
  limit 1
$$;

create function private.package_price_on(p_package uuid, p_period date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select pr.monthly_price from public.billing_package_prices pr
  where pr.package_id = p_package and pr.valid_from <= p_period
  order by pr.valid_from desc
  limit 1
$$;

-- Every billed month from the first package up to the current month (org
-- timezone). Due = last day of the month + grace days.
create function private.billing_months(p_org uuid)
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
      private.org_grace_days(p_org) as grace
  ),
  months as (
    select m::date as period, b.grace
    from bounds b, generate_series(b.first_month, b.this_month, interval '1 month') as m
    where b.first_month is not null
  ),
  billed as (
    select m.period, m.grace, private.org_package_on(p_org, m.period) as package_id from months m
  )
  select
    b.period,
    b.package_id,
    p.name,
    private.package_price_on(b.package_id, b.period),
    ((b.period + interval '1 month')::date - 1) + b.grace,
    pay.paid_on,
    pay.note
  from billed b
  join public.billing_packages p on p.id = b.package_id
  left join public.billing_payments pay on pay.organization_id = p_org and pay.period = b.period
  order by b.period
$$;

-- state: trial | active | warning | overdue | locked; reason: manual | unpaid.
create function private.org_lock_state(p_org uuid)
returns table (state text, unpaid_period date, lock_on date, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_platform boolean;
  v_billing public.organization_billing;
  v_today date := private.org_today(p_org);
  v_period date;
  v_due date;
begin
  select o.is_platform into v_platform from public.organizations o where o.id = p_org;
  if v_platform then
    return query select 'active'::text, null::date, null::date, null::text;
    return;
  end if;
  select * into v_billing from public.organization_billing b where b.organization_id = p_org;
  if v_billing.locked_at is not null then
    return query select 'locked'::text, null::date, null::date, 'manual'::text;
    return;
  end if;

  select m.period, m.due_on into v_period, v_due
  from private.billing_months(p_org) m
  where m.paid_on is null and m.due_on < v_today
  order by m.period
  limit 1;
  if v_period is not null then
    if coalesce(v_billing.auto_lock, true)
      and not coalesce(v_billing.unlocked_until >= v_today, false) then
      return query select 'locked'::text, v_period, v_due + 1, 'unpaid'::text;
    else
      return query select 'overdue'::text, v_period, v_due + 1, 'unpaid'::text;
    end if;
    return;
  end if;

  select m.period, m.due_on into v_period, v_due
  from private.billing_months(p_org) m
  where m.paid_on is null
    and m.due_on - v_today < (select s.lock_warning_days from public.platform_settings s)
  order by m.period
  limit 1;
  if v_period is not null then
    return query select 'warning'::text, v_period, v_due + 1, null::text;
    return;
  end if;

  if not exists (
    select 1 from public.organization_packages op
    where op.organization_id = p_org and op.package_id is not null
  ) then
    return query select 'trial'::text, null::date, null::date, null::text;
    return;
  end if;
  return query select 'active'::text, null::date, null::date, null::text;
end;
$$;

create function private.org_locked(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.state = 'locked' from private.org_lock_state(p_org) s), false)
$$;

-- Raises module_requirement when a module lacks one it needs (core is always on).
create function private.assert_module_set(p_modules text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(p_modules) as k (key)
    where k.key in ('core', 'platform') or not exists (select 1 from public.modules m where m.key = k.key)
  ) then
    raise exception 'invalid module' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.module_dependencies d
    where d.module_key = any (p_modules) and not (d.requires = any (p_modules)) and d.requires <> 'core'
  ) then
    raise exception 'module_requirement' using errcode = '22023';
  end if;
end;
$$;

-- Package modules on, other paid modules off; trial modules (active_until set) stay.
create function private.sync_package_modules(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package uuid := private.org_package_on(p_org, date_trunc('month', private.org_today(p_org))::date);
begin
  if v_package is null then
    return;
  end if;
  insert into public.org_modules (organization_id, module_key, enabled, enabled_at, active_until)
  select p_org, pm.module_key, true, now(), null
  from public.billing_package_modules pm where pm.package_id = v_package
  on conflict (organization_id, module_key) do update
    set enabled = true, active_until = null,
        enabled_at = case when public.org_modules.enabled then public.org_modules.enabled_at else now() end;
  update public.org_modules om set enabled = false
  where om.organization_id = p_org
    and om.enabled
    and om.active_until is null
    and om.module_key not in ('core', 'platform')
    and not exists (
      select 1 from public.billing_package_modules pm
      where pm.package_id = v_package and pm.module_key = om.module_key
    );
end;
$$;

create function private.billing_audit(
  p_org uuid, p_action text, p_entity_id text, p_before jsonb, p_after jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (p_org, auth.uid(), p_action, 'billing', p_entity_id, p_before, p_after)
$$;

create function private.platform_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.organizations o where o.is_platform and o.archived_at is null limit 1
$$;

create function private.assert_billable_org(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organizations o where o.id = p_org) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.organizations o where o.id = p_org and o.is_platform) then
    raise exception 'platform_org' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform RPCs (platform admin only)
-- ---------------------------------------------------------------------------

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
  archived boolean
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
    o.archived_at is not null
  from public.organizations o
  left join public.billing_packages p
    on p.id = private.org_package_on(o.id, date_trunc('month', private.org_today(o.id))::date)
  cross join lateral private.org_lock_state(o.id) s
  where not o.is_platform
  order by o.name;
end;
$$;

create function public.platform_organization_billing(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_billing public.organization_billing;
  v_this_month date;
  v_package uuid;
  v_state record;
begin
  perform private.require_platform_admin();
  select * into v_org from public.organizations o where o.id = p_org_id and not o.is_platform;
  if v_org.id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  select * into v_billing from public.organization_billing b where b.organization_id = p_org_id;
  v_this_month := date_trunc('month', private.org_today(p_org_id))::date;
  v_package := private.org_package_on(p_org_id, v_this_month);
  select * into v_state from private.org_lock_state(p_org_id);

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_org.id, 'name', v_org.name, 'slug', v_org.slug, 'timezone', v_org.timezone,
      'created_at', v_org.created_at, 'archived', v_org.archived_at is not null,
      'member_count', (select count(*) from public.memberships m
                       where m.organization_id = v_org.id and m.archived_at is null),
      'tax_id', (select c.tax_id from public.companies c where c.id = v_org.company_id),
      'city', (select c.city from public.companies c where c.id = v_org.company_id)
    ),
    'package', (select jsonb_build_object('id', p.id, 'name', p.name,
                  'monthly_price', private.package_price_on(p.id, v_this_month))
                from public.billing_packages p where p.id = v_package),
    'grace_days', v_billing.grace_days,
    'effective_grace_days', private.org_grace_days(p_org_id),
    'auto_lock', coalesce(v_billing.auto_lock, true),
    'locked_at', v_billing.locked_at,
    'locked_reason', v_billing.locked_reason,
    'unlocked_until', v_billing.unlocked_until,
    'state', v_state.state,
    'reason', v_state.reason,
    'unpaid_period', v_state.unpaid_period,
    'lock_on', v_state.lock_on,
    'months', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period', m.period, 'package_name', m.package_name, 'amount', m.amount,
        'due_on', m.due_on, 'paid_on', m.paid_on, 'note', m.note,
        'state', case
          when m.paid_on is not null then 'paid'
          when m.due_on < private.org_today(p_org_id) then 'unpaid'
          else 'pending'
        end
      ) order by m.period desc)
      from private.billing_months(p_org_id) m
    ), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', md.key,
        'enabled', coalesce(om.enabled, false),
        'active_until', om.active_until,
        'source', case
          when exists (select 1 from public.billing_package_modules pm
                       where pm.package_id = v_package and pm.module_key = md.key) then 'package'
          when om.enabled and om.active_until is not null then 'trial'
          when om.enabled then 'manual'
          else 'off'
        end
      ) order by md.key)
      from public.modules md
      left join public.org_modules om on om.organization_id = p_org_id and om.module_key = md.key
      where md.key not in ('core', 'platform')
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h order by h.created_at desc) from (
        select a.created_at, a.action, a.before, a.after,
          (select p.username from public.profiles p where p.id = a.actor_id) as actor
        from public.audit_log a
        where a.organization_id = p_org_id and a.entity_type = 'billing'
        order by a.created_at desc
        limit 50
      ) h
    ), '[]'::jsonb)
  );
end;
$$;

create function public.platform_save_package(
  p_id uuid, p_name text, p_monthly_price numeric, p_modules text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_this_month date := date_trunc('month', now() at time zone 'UTC')::date;
  v_before jsonb;
  v_org uuid;
begin
  perform private.require_platform_admin();
  if p_name is null or length(btrim(p_name)) not between 1 and 80
    or p_monthly_price is null or p_monthly_price < 0 or p_monthly_price <> round(p_monthly_price, 2) then
    raise exception 'invalid package' using errcode = '22023';
  end if;
  perform private.assert_module_set(coalesce(p_modules, '{}'));

  if v_id is null then
    insert into public.billing_packages (name) values (btrim(p_name)) returning id into v_id;
  else
    select jsonb_build_object('name', p.name,
        'monthly_price', private.package_price_on(p.id, v_this_month),
        'modules', (select jsonb_agg(pm.module_key order by pm.module_key)
                    from public.billing_package_modules pm where pm.package_id = p.id))
      into v_before
    from public.billing_packages p where p.id = v_id;
    if v_before is null then
      raise exception 'package not found' using errcode = 'P0002';
    end if;
    update public.billing_packages set name = btrim(p_name) where id = v_id;
  end if;

  delete from public.billing_package_modules where package_id = v_id;
  insert into public.billing_package_modules (package_id, module_key)
  select v_id, k from unnest(p_modules) as k group by k;

  if private.package_price_on(v_id, v_this_month) is distinct from p_monthly_price then
    insert into public.billing_package_prices (package_id, valid_from, monthly_price)
    values (v_id, v_this_month, p_monthly_price)
    on conflict (package_id, valid_from) do update set monthly_price = excluded.monthly_price;
  end if;

  for v_org in
    select o.id from public.organizations o
    where private.org_package_on(o.id, date_trunc('month', private.org_today(o.id))::date) = v_id
  loop
    perform private.sync_package_modules(v_org);
  end loop;

  perform private.billing_audit(private.platform_org_id(),
    case when p_id is null then 'billing.package_created' else 'billing.package_updated' end,
    v_id::text, v_before,
    jsonb_build_object('name', btrim(p_name), 'monthly_price', p_monthly_price, 'modules', to_jsonb(p_modules)));
  return v_id;
end;
$$;

create function public.platform_set_package_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  update public.billing_packages
  set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_id;
  if not found then
    raise exception 'package not found' using errcode = 'P0002';
  end if;
  perform private.billing_audit(private.platform_org_id(),
    case when p_archived then 'billing.package_archived' else 'billing.package_restored' end,
    p_id::text, null, null);
end;
$$;

create function public.platform_assign_package(p_org_id uuid, p_package_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_before uuid;
begin
  perform private.require_platform_admin();
  perform private.assert_billable_org(p_org_id);
  if p_package_id is not null and not exists (
    select 1 from public.billing_packages p where p.id = p_package_id and p.archived_at is null
  ) then
    raise exception 'package not found' using errcode = 'P0002';
  end if;
  v_month := date_trunc('month', private.org_today(p_org_id))::date;
  v_before := private.org_package_on(p_org_id, v_month);
  insert into public.organization_packages (organization_id, valid_from, package_id)
  values (p_org_id, v_month, p_package_id)
  on conflict (organization_id, valid_from) do update set package_id = excluded.package_id;
  perform private.sync_package_modules(p_org_id);
  perform private.billing_audit(p_org_id, 'billing.package_assigned', p_package_id::text,
    jsonb_build_object('package_id', v_before), jsonb_build_object('package_id', p_package_id));
end;
$$;

create function public.platform_set_org_billing(p_org_id uuid, p_grace_days integer, p_auto_lock boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform private.require_platform_admin();
  perform private.assert_billable_org(p_org_id);
  if (p_grace_days is not null and p_grace_days not between 0 and 90) or p_auto_lock is null then
    raise exception 'invalid billing settings' using errcode = '22023';
  end if;
  select jsonb_build_object('grace_days', b.grace_days, 'auto_lock', b.auto_lock) into v_before
  from public.organization_billing b where b.organization_id = p_org_id;
  insert into public.organization_billing (organization_id, grace_days, auto_lock)
  values (p_org_id, p_grace_days, p_auto_lock)
  on conflict (organization_id) do update
    set grace_days = excluded.grace_days, auto_lock = excluded.auto_lock, updated_at = now();
  perform private.billing_audit(p_org_id, 'billing.settings', null, v_before,
    jsonb_build_object('grace_days', p_grace_days, 'auto_lock', p_auto_lock));
end;
$$;

create function public.platform_set_payment(
  p_org_id uuid, p_period date, p_paid boolean, p_paid_on date, p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform private.require_platform_admin();
  perform private.assert_billable_org(p_org_id);
  if p_period is null or extract(day from p_period) <> 1 or p_paid is null
    or (p_paid and p_paid_on is null) or length(coalesce(p_note, '')) > 200 then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  select to_jsonb(bp) - 'organization_id' into v_before
  from public.billing_payments bp where bp.organization_id = p_org_id and bp.period = p_period;
  if p_paid then
    insert into public.billing_payments (organization_id, period, paid_on, note, recorded_by)
    values (p_org_id, p_period, p_paid_on, nullif(btrim(p_note), ''), auth.uid())
    on conflict (organization_id, period) do update
      set paid_on = excluded.paid_on, note = excluded.note,
          recorded_by = excluded.recorded_by, recorded_at = now();
  else
    delete from public.billing_payments where organization_id = p_org_id and period = p_period;
  end if;
  perform private.billing_audit(p_org_id,
    case when p_paid then 'billing.payment_recorded' else 'billing.payment_cancelled' end,
    p_period::text, v_before,
    case when p_paid then jsonb_build_object('period', p_period, 'paid_on', p_paid_on, 'note', p_note) end);
end;
$$;

create function public.platform_set_lock(p_org_id uuid, p_locked boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  perform private.assert_billable_org(p_org_id);
  if p_locked and (p_reason is null or length(btrim(p_reason)) not between 1 and 300) then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  insert into public.organization_billing (organization_id, locked_at, locked_reason)
  values (p_org_id, case when p_locked then now() end, case when p_locked then btrim(p_reason) end)
  on conflict (organization_id) do update
    set locked_at = excluded.locked_at, locked_reason = excluded.locked_reason, updated_at = now();
  perform private.billing_audit(p_org_id,
    case when p_locked then 'billing.locked' else 'billing.unlocked' end, null, null,
    case when p_locked then jsonb_build_object('reason', btrim(p_reason)) end);
end;
$$;

create function public.platform_unlock_until(p_org_id uuid, p_until date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  perform private.assert_billable_org(p_org_id);
  insert into public.organization_billing (organization_id, unlocked_until)
  values (p_org_id, p_until)
  on conflict (organization_id) do update set unlocked_until = excluded.unlocked_until, updated_at = now();
  perform private.billing_audit(p_org_id, 'billing.unlocked_until', null, null,
    jsonb_build_object('until', p_until));
end;
$$;

create function public.platform_save_billing_settings(
  p_grace_days integer, p_warning_days integer, p_contact text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_grace_days not between 0 and 90 or p_warning_days not between 0 and 30
    or length(coalesce(p_contact, '')) > 300 then
    raise exception 'invalid billing settings' using errcode = '22023';
  end if;
  update public.platform_settings
  set payment_grace_days = p_grace_days, lock_warning_days = p_warning_days,
      lock_contact = btrim(coalesce(p_contact, '')), updated_at = now();
  perform private.billing_audit(private.platform_org_id(), 'billing.platform_settings', null, null,
    jsonb_build_object('grace_days', p_grace_days, 'warning_days', p_warning_days));
end;
$$;

create or replace function public.platform_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return (select jsonb_build_object(
            'default_trial_days', s.default_trial_days,
            'payment_grace_days', s.payment_grace_days,
            'lock_warning_days', s.lock_warning_days,
            'lock_contact', s.lock_contact)
          from public.platform_settings s);
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.org_today(uuid)', 'private.org_grace_days(uuid)', 'private.org_package_on(uuid, date)',
    'private.package_price_on(uuid, date)', 'private.billing_months(uuid)',
    'private.org_lock_state(uuid)', 'private.org_locked(uuid)', 'private.assert_module_set(text[])',
    'private.sync_package_modules(uuid)', 'private.billing_audit(uuid, text, text, jsonb, jsonb)',
    'private.platform_org_id()', 'private.assert_billable_org(uuid)',
    'public.platform_billing_overview()', 'public.platform_organization_billing(uuid)',
    'public.platform_save_package(uuid, text, numeric, text[])',
    'public.platform_set_package_archived(uuid, boolean)',
    'public.platform_assign_package(uuid, uuid)',
    'public.platform_set_org_billing(uuid, integer, boolean)',
    'public.platform_set_payment(uuid, date, boolean, date, text)',
    'public.platform_set_lock(uuid, boolean, text)',
    'public.platform_unlock_until(uuid, date)',
    'public.platform_save_billing_settings(integer, integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;
end;
$$;
