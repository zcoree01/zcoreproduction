-- Shifts and working time, part C1: calculation rules, holidays, hourly
-- rates and the monthly overview (D-027).
--   * attendance_settings: overtime daily or weekly (weekly hours, warning
--     above N overtime hours a week), rounding step (always up), night
--     window, premiums in percent (defaults from the product owner: 30 %
--     overtime, night and weekend, 50 % holiday; editable), weekend days.
--   * Net pay only: payroll_settings (default net hourly rate) and
--     employee_hourly_rates (per employee, valid from a date); readable with
--     payroll.read (director, HR), the worker sees only their own pay.
--   * Holidays: holiday_templates (platform list, FBiH 2026–2028; Bajram
--     dates are not confirmed), copied per organization into org_holidays
--     (dates editable); per holiday key the organization chooses whether it
--     is non-working for nobody (default), everybody or selected employees.
--   * Per employee: weekend days (turnus workers) and the holidays they take.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module_key, description, default_roles) values
  ('payroll.read', 'attendance', 'See hourly rates and net pay of all employees', '{director,hr}'),
  ('payroll.manage', 'attendance', 'Set hourly rates and pay premiums', '{director,hr}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.key in ('payroll.read', 'payroll.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Calculation rules
-- ---------------------------------------------------------------------------
alter table public.attendance_settings
  add column overtime_mode text not null default 'daily' check (overtime_mode in ('daily', 'weekly')),
  add column weekly_hours integer not null default 40 check (weekly_hours between 1 and 80),
  add column weekly_overtime_warning_hours integer not null default 10
    check (weekly_overtime_warning_hours between 0 and 80),
  add column overtime_step_min integer not null default 15 check (overtime_step_min between 0 and 60),
  add column night_start time not null default '22:00',
  add column night_end time not null default '06:00',
  add column weekend_days smallint[] not null default '{6,7}'
    check (weekend_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  add column overtime_pct numeric(5, 2) not null default 30 check (overtime_pct between 0 and 500),
  add column night_pct numeric(5, 2) not null default 30 check (night_pct between 0 and 500),
  add column weekend_pct numeric(5, 2) not null default 30 check (weekend_pct between 0 and 500),
  add column holiday_pct numeric(5, 2) not null default 50 check (holiday_pct between 0 and 500),
  add constraint attendance_settings_night_check check (night_start <> night_end);

-- Calculation rules: shifts.manage (direct update, RLS policy of part A);
-- premiums: payroll.manage through save_pay_settings.
grant update (overtime_mode, weekly_hours, weekly_overtime_warning_hours, overtime_step_min,
  night_start, night_end, weekend_days) on public.attendance_settings to authenticated;

create table public.payroll_settings (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  -- Net KM per hour for employees without an own rate.
  default_hourly_rate numeric(10, 2) check (default_hourly_rate >= 0),
  updated_at timestamptz not null default now()
);

create table public.employee_hourly_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  valid_from date not null,
  -- Net KM per hour.
  rate numeric(10, 2) not null check (rate >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (organization_id, id),
  unique (employee_id, valid_from),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict
);

create index employee_hourly_rates_employee_idx
  on public.employee_hourly_rates (organization_id, employee_id, valid_from);

alter table public.employee_work_info
  -- Null = the organization's weekend days.
  add column weekend_days smallint[] check (weekend_days <@ '{1,2,3,4,5,6,7}'::smallint[]);

create trigger payroll_settings_updated_at before update on public.payroll_settings
  for each row execute function private.set_updated_at();

create function private.audit_payroll_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (new.organization_id, auth.uid(), 'payroll_settings.' || lower(tg_op), 'payroll_settings',
    new.organization_id::text, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return null;
end;
$$;

create trigger payroll_settings_audit after insert or update on public.payroll_settings
  for each row execute function private.audit_payroll_settings();
create trigger employee_hourly_rates_audit after insert or update or delete on public.employee_hourly_rates
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Holidays
-- ---------------------------------------------------------------------------
create table public.holiday_templates (
  id uuid primary key default gen_random_uuid(),
  -- Same key every year, e.g. 'statehood_day', 'kurban_bayram'.
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  date date not null,
  name text not null,
  kind text not null check (kind in ('state', 'islamic', 'catholic', 'orthodox')),
  -- Moving religious dates (Bajram) are announced each year: verify.
  confirmed boolean not null default true,
  unique (key, date)
);

comment on table public.holiday_templates is
  'Platform list of holidays (FBiH) copied into organizations; Bajram dates must be verified each year.';

insert into public.holiday_templates (key, date, name, kind, confirmed)
select v.key, v.date::date, v.name, v.kind, v.confirmed
from (values
  ('new_year', '2026-01-01', 'Nova godina', 'state', true),
  ('new_year_2', '2026-01-02', 'Nova godina (drugi dan)', 'state', true),
  ('orthodox_christmas', '2026-01-07', 'Božić (pravoslavni)', 'orthodox', true),
  ('independence_day', '2026-03-01', 'Dan nezavisnosti', 'state', true),
  ('ramadan_bayram', '2026-03-20', 'Ramazanski bajram', 'islamic', false),
  ('catholic_easter', '2026-04-05', 'Uskrs (katolički)', 'catholic', true),
  ('catholic_easter_monday', '2026-04-06', 'Uskrsni ponedjeljak (katolički)', 'catholic', true),
  ('orthodox_easter', '2026-04-12', 'Uskrs (pravoslavni)', 'orthodox', true),
  ('orthodox_easter_monday', '2026-04-13', 'Uskrsni ponedjeljak (pravoslavni)', 'orthodox', true),
  ('labour_day', '2026-05-01', 'Praznik rada', 'state', true),
  ('labour_day_2', '2026-05-02', 'Praznik rada (drugi dan)', 'state', true),
  ('kurban_bayram', '2026-05-27', 'Kurban-bajram', 'islamic', false),
  ('statehood_day', '2026-11-25', 'Dan državnosti', 'state', true),
  ('catholic_christmas', '2026-12-25', 'Božić (katolički)', 'catholic', true),
  ('new_year', '2027-01-01', 'Nova godina', 'state', true),
  ('new_year_2', '2027-01-02', 'Nova godina (drugi dan)', 'state', true),
  ('orthodox_christmas', '2027-01-07', 'Božić (pravoslavni)', 'orthodox', true),
  ('independence_day', '2027-03-01', 'Dan nezavisnosti', 'state', true),
  ('ramadan_bayram', '2027-03-10', 'Ramazanski bajram', 'islamic', false),
  ('catholic_easter', '2027-03-28', 'Uskrs (katolički)', 'catholic', true),
  ('catholic_easter_monday', '2027-03-29', 'Uskrsni ponedjeljak (katolički)', 'catholic', true),
  ('labour_day', '2027-05-01', 'Praznik rada', 'state', true),
  ('orthodox_easter', '2027-05-02', 'Uskrs (pravoslavni)', 'orthodox', true),
  ('labour_day_2', '2027-05-02', 'Praznik rada (drugi dan)', 'state', true),
  ('orthodox_easter_monday', '2027-05-03', 'Uskrsni ponedjeljak (pravoslavni)', 'orthodox', true),
  ('kurban_bayram', '2027-05-17', 'Kurban-bajram', 'islamic', false),
  ('statehood_day', '2027-11-25', 'Dan državnosti', 'state', true),
  ('catholic_christmas', '2027-12-25', 'Božić (katolički)', 'catholic', true),
  ('new_year', '2028-01-01', 'Nova godina', 'state', true),
  ('new_year_2', '2028-01-02', 'Nova godina (drugi dan)', 'state', true),
  ('orthodox_christmas', '2028-01-07', 'Božić (pravoslavni)', 'orthodox', true),
  ('ramadan_bayram', '2028-02-27', 'Ramazanski bajram', 'islamic', false),
  ('independence_day', '2028-03-01', 'Dan nezavisnosti', 'state', true),
  ('catholic_easter', '2028-04-16', 'Uskrs (katolički)', 'catholic', true),
  ('catholic_easter_monday', '2028-04-17', 'Uskrsni ponedjeljak (katolički)', 'catholic', true),
  ('orthodox_easter', '2028-04-16', 'Uskrs (pravoslavni)', 'orthodox', true),
  ('orthodox_easter_monday', '2028-04-17', 'Uskrsni ponedjeljak (pravoslavni)', 'orthodox', true),
  ('labour_day', '2028-05-01', 'Praznik rada', 'state', true),
  ('labour_day_2', '2028-05-02', 'Praznik rada (drugi dan)', 'state', true),
  ('kurban_bayram', '2028-05-05', 'Kurban-bajram', 'islamic', false),
  ('statehood_day', '2028-11-25', 'Dan državnosti', 'state', true),
  ('catholic_christmas', '2028-12-25', 'Božić (katolički)', 'catholic', true)
) as v (key, date, name, kind, confirmed);

create table public.org_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  date date not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('state', 'islamic', 'catholic', 'orthodox', 'other')),
  confirmed boolean not null default true,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id)
);

create unique index org_holidays_key_year_active
  on public.org_holidays (organization_id, key, extract(year from date))
  where archived_at is null;
create index org_holidays_date_idx on public.org_holidays (organization_id, date);

-- Per holiday key: non-working for nobody (no row), everybody or selected employees.
create table public.org_holiday_rules (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  key text not null,
  scope text not null check (scope in ('all', 'selected')),
  primary key (organization_id, key)
);

create table public.employee_holiday_keys (
  organization_id uuid not null,
  employee_id uuid not null,
  key text not null,
  primary key (employee_id, key),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict
);

create trigger org_holidays_audit after insert or update on public.org_holidays
  for each row execute function private.audit_row_change();

-- Copies the platform list for a year into an organization (skips keys it has).
create function private.import_holidays(p_org_id uuid, p_year integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.org_holidays (organization_id, key, date, name, kind, confirmed)
  select p_org_id, t.key, t.date, t.name, t.kind, t.confirmed
  from public.holiday_templates t
  where extract(year from t.date) = p_year
    and not exists (
      select 1 from public.org_holidays h
      where h.organization_id = p_org_id and h.key = t.key
        and extract(year from h.date) = p_year and h.archived_at is null
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Customer organizations only (not the platform organization).
select private.import_holidays(o.id, y.year)
from public.organizations o
cross join (values (2026), (2027), (2028)) as y (year)
where not o.is_platform;

create function private.seed_org_holidays()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_platform then
    return null;
  end if;
  perform private.import_holidays(new.id, extract(year from now())::integer);
  perform private.import_holidays(new.id, extract(year from now())::integer + 1);
  insert into public.payroll_settings (organization_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;

create trigger organizations_seed_holidays after insert on public.organizations
  for each row execute function private.seed_org_holidays();

insert into public.payroll_settings (organization_id)
select o.id from public.organizations o
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
revoke all on public.payroll_settings, public.employee_hourly_rates, public.holiday_templates,
  public.org_holidays, public.org_holiday_rules, public.employee_holiday_keys
  from anon, authenticated;
grant select on public.payroll_settings, public.employee_hourly_rates, public.holiday_templates,
  public.org_holidays, public.org_holiday_rules, public.employee_holiday_keys to authenticated;

alter table public.payroll_settings enable row level security;
alter table public.employee_hourly_rates enable row level security;
alter table public.holiday_templates enable row level security;
alter table public.org_holidays enable row level security;
alter table public.org_holiday_rules enable row level security;
alter table public.employee_holiday_keys enable row level security;

create policy payroll_settings_select on public.payroll_settings
  for select to authenticated using (private.has_permission(organization_id, 'payroll.read'));
create policy employee_hourly_rates_select on public.employee_hourly_rates
  for select to authenticated using (private.has_permission(organization_id, 'payroll.read'));
create policy holiday_templates_select on public.holiday_templates
  for select to authenticated using (true);
create policy org_holidays_select on public.org_holidays
  for select to authenticated using (organization_id in (select private.user_org_ids()));
create policy org_holiday_rules_select on public.org_holiday_rules
  for select to authenticated using (organization_id in (select private.user_org_ids()));
create policy employee_holiday_keys_select on public.employee_holiday_keys
  for select to authenticated
  using (private.has_permission(organization_id, 'attendance.read')
    or (organization_id in (select private.user_org_ids()) and private.is_own_employee(employee_id)));

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------
create function public.save_pay_settings(
  p_org_id uuid,
  p_overtime_pct numeric,
  p_night_pct numeric,
  p_weekend_pct numeric,
  p_holiday_pct numeric,
  p_default_hourly_rate numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'payroll.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.attendance_settings set
    overtime_pct = p_overtime_pct,
    night_pct = p_night_pct,
    weekend_pct = p_weekend_pct,
    holiday_pct = p_holiday_pct
  where organization_id = p_org_id;
  insert into public.payroll_settings (organization_id, default_hourly_rate)
  values (p_org_id, p_default_hourly_rate)
  on conflict (organization_id) do update set default_hourly_rate = excluded.default_hourly_rate;
end;
$$;

-- Adds (or replaces) an hourly rate valid from a date; null rate removes it.
create function public.set_hourly_rate(p_employee_id uuid, p_valid_from date, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  if v_org is null or not private.has_permission(v_org, 'payroll.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_valid_from is null then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  if p_rate is null then
    delete from public.employee_hourly_rates
    where employee_id = p_employee_id and valid_from = p_valid_from;
    return;
  end if;
  insert into public.employee_hourly_rates (organization_id, employee_id, valid_from, rate)
  values (v_org, p_employee_id, p_valid_from, p_rate)
  on conflict (employee_id, valid_from) do update set rate = excluded.rate;
end;
$$;

-- Weekend days (null = the organization's) and the holiday keys an employee
-- takes (for holidays with scope 'selected').
create function public.save_work_calendar(p_employee_id uuid, p_weekend_days smallint[], p_holiday_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  if v_org is null or not private.has_permission(v_org, 'attendance.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.employee_work_info (employee_id, organization_id, weekend_days)
  values (p_employee_id, v_org, p_weekend_days)
  on conflict (employee_id) do update set weekend_days = excluded.weekend_days;
  delete from public.employee_holiday_keys where employee_id = p_employee_id;
  insert into public.employee_holiday_keys (organization_id, employee_id, key)
  select distinct v_org, p_employee_id, k from unnest(coalesce(p_holiday_keys, '{}')) as k;
end;
$$;

-- Holidays of a year: import from the platform list, change a date or name,
-- archive / restore, and the non-working scope per key (shifts.manage).
create function public.import_org_holidays(p_org_id uuid, p_year integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'shifts.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'invalid year' using errcode = '22023';
  end if;
  return private.import_holidays(p_org_id, p_year);
end;
$$;

create function public.save_org_holiday(
  p_org_id uuid,
  p_id uuid,
  p_name text,
  p_date date,
  p_archived boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if not private.has_permission(p_org_id, 'shifts.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_date is null or nullif(btrim(p_name), '') is null then
    raise exception 'invalid holiday' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.org_holidays (organization_id, key, date, name, kind, confirmed)
    values (p_org_id, 'custom_' || replace(gen_random_uuid()::text, '-', ''), p_date,
      btrim(p_name), 'other', true)
    returning id into v_id;
  else
    update public.org_holidays set
      name = btrim(p_name),
      date = p_date,
      confirmed = true,
      archived_at = case when p_archived then coalesce(archived_at, now()) end
    where id = v_id and organization_id = p_org_id;
    if not found then
      raise exception 'holiday not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create function public.set_holiday_scope(p_org_id uuid, p_key text, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'shifts.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_scope is null or p_scope = 'none' then
    delete from public.org_holiday_rules where organization_id = p_org_id and key = p_key;
  elsif p_scope in ('all', 'selected') then
    insert into public.org_holiday_rules (organization_id, key, scope)
    values (p_org_id, p_key, p_scope)
    on conflict (organization_id, key) do update set scope = excluded.scope;
  else
    raise exception 'invalid scope' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
-- Non-working holiday dates of an employee in [p_from, p_to].
create function private.employee_holiday_dates(p_employee_id uuid, p_from date, p_to date)
returns date[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(h.date order by h.date), '{}')
  from public.org_holidays h
  join public.employees e on e.id = p_employee_id and e.organization_id = h.organization_id
  join public.org_holiday_rules r on r.organization_id = h.organization_id and r.key = h.key
  where h.archived_at is null and h.date between p_from and p_to
    and (r.scope = 'all' or exists (
      select 1 from public.employee_holiday_keys k
      where k.employee_id = p_employee_id and k.key = h.key
    ))
$$;

-- Everything the monthly overview needs for [p_from, p_to]: sessions from
-- p_sessions_from (weekly mode needs the whole first week), absences,
-- weekend days and non-working holidays per employee; rates only with
-- payroll.read (attendance.read).
create function public.attendance_month(
  p_org_id uuid,
  p_sessions_from date,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay boolean := private.has_permission(p_org_id, 'payroll.read');
begin
  if not private.has_permission(p_org_id, 'attendance.read')
    or p_to < p_from or p_to - p_sessions_from > 70 then
    return null;
  end if;
  perform private.close_overdue_attendance(p_org_id);
  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'number', e.employee_number, 'name', e.first_name || ' ' || e.last_name,
        'department', d.name,
        'weekend_days', coalesce(w.weekend_days, s.weekend_days),
        'own_weekend', w.weekend_days is not null,
        'holiday_keys', coalesce((
          select jsonb_agg(k.key) from public.employee_holiday_keys k where k.employee_id = e.id
        ), '[]'::jsonb),
        'holidays', to_jsonb(private.employee_holiday_dates(e.id, p_sessions_from, p_to)),
        'rates', case when v_pay then coalesce((
          select jsonb_agg(jsonb_build_object('valid_from', r.valid_from, 'rate', r.rate)
            order by r.valid_from)
          from public.employee_hourly_rates r where r.employee_id = e.id
        ), '[]'::jsonb) end,
        'sessions', coalesce((
          select jsonb_agg(private.attendance_session_json(a) order by a.clock_in_at)
          from public.attendance_sessions a
          where a.employee_id = e.id and a.archived_at is null
            and a.work_date between p_sessions_from and p_to
        ), '[]'::jsonb),
        'absences', coalesce((
          select jsonb_agg(jsonb_build_object('kind', ab.kind, 'start_date', ab.start_date,
            'end_date', ab.end_date) order by ab.start_date)
          from public.absences ab
          where ab.employee_id = e.id and ab.status = 'approved'
            and ab.start_date <= p_to and (ab.end_date is null or ab.end_date >= p_from)
        ), '[]'::jsonb)
      ) order by e.last_name, e.first_name)
      from public.employees e
      join public.attendance_settings s on s.organization_id = e.organization_id
      left join public.employee_work_info w on w.employee_id = e.id
      left join public.catalog_items d on d.id = e.department_id
      where e.organization_id = p_org_id and e.status = 'active' and e.archived_at is null
    ), '[]'::jsonb),
    'default_rate', case when v_pay then (
      select p.default_hourly_rate from public.payroll_settings p where p.organization_id = p_org_id
    ) end
  );
end;
$$;

-- The caller's own pay inputs for [p_from, p_to]: own rates (or the
-- organization's default), weekend days and non-working holidays.
create function public.my_pay_inputs(p_org_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.current_employee(p_org_id) is null then null else
    jsonb_build_object(
      'rates', coalesce((
        select jsonb_agg(jsonb_build_object('valid_from', r.valid_from, 'rate', r.rate)
          order by r.valid_from)
        from public.employee_hourly_rates r
        where r.employee_id = private.current_employee(p_org_id)
      ), '[]'::jsonb),
      'default_rate', (
        select p.default_hourly_rate from public.payroll_settings p where p.organization_id = p_org_id
      ),
      'weekend_days', (
        select coalesce(w.weekend_days, s.weekend_days)
        from public.attendance_settings s
        left join public.employee_work_info w on w.employee_id = private.current_employee(p_org_id)
        where s.organization_id = p_org_id
      ),
      'holidays', to_jsonb(private.employee_holiday_dates(private.current_employee(p_org_id),
        p_from, p_to))
    )
  end
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.audit_payroll_settings()',
    'private.import_holidays(uuid, integer)',
    'private.seed_org_holidays()',
    'private.employee_holiday_dates(uuid, date, date)'
  ] loop
    execute format('revoke execute on function %s from public', v_fn);
  end loop;
  foreach v_fn in array array[
    'public.save_pay_settings(uuid, numeric, numeric, numeric, numeric, numeric)',
    'public.set_hourly_rate(uuid, date, numeric)',
    'public.save_work_calendar(uuid, smallint[], text[])',
    'public.import_org_holidays(uuid, integer)',
    'public.save_org_holiday(uuid, uuid, text, date, boolean)',
    'public.set_holiday_scope(uuid, text, text)',
    'public.attendance_month(uuid, date, date, date)',
    'public.my_pay_inputs(uuid, date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
