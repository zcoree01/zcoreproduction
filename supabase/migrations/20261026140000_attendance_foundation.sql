-- Shifts and working time, part A (D-021).
--   * Module `attendance` (Radno vrijeme), enabled wherever `production` is.
--   * shifts + shift_breaks: configurable per organization (any length,
--     across midnight when the end is not after the start; breaks with or
--     without a fixed time, paid or unpaid).
--   * attendance_settings: one row per organization (tolerances, automatic
--     clock-out, what happens when work starts without a clock-in).
--   * shift_schedule: who works which shift on which day (filled by the
--     schedule screens of part B; shift recognition already uses it).
--   * attendance_sessions: clock-in / clock-out. The server records the time;
--     the shift is recognised at clock-in and its times and breaks are
--     snapshotted, so later changes to a shift do not change past days.
--     No overlapping sessions per employee (exclusion constraint).
--   * attendance_alerts: automatic clock-out after N hours (at the shift's
--     end, never an invented time) and automatic clock-in at the start of an
--     operation; the foreman checks them with the worker.
-- Presence (attendance) and time on operations (production_work_sessions)
-- are different measures: a worker on two machines has two work sessions but
-- one attendance session.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Module and permissions
-- ---------------------------------------------------------------------------
insert into public.modules (key, name) values ('attendance', 'Radno vrijeme');

insert into public.org_modules (organization_id, module_key, enabled, enabled_at)
select m.organization_id, 'attendance', true, now()
from public.org_modules m
where m.module_key = 'production' and m.enabled
on conflict do nothing;

insert into public.permissions (key, module_key, description, default_roles) values
  ('attendance.read', 'attendance', 'View attendance of all employees',
    '{admin,director,head_of_production}'),
  ('attendance.manage', 'attendance',
    'Check attendance alerts; manage schedules, absences and corrections',
    '{admin,director,head_of_production}'),
  ('shifts.manage', 'attendance', 'Manage shifts, breaks and attendance rules',
    '{admin,director,head_of_production}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.module_key = 'attendance'
on conflict do nothing;

create function private.module_enabled(p_org_id uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_modules m
    where m.organization_id = p_org_id and m.module_key = p_module and m.enabled
  )
$$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.attendance_settings (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  -- A clock-in this many minutes before a shift's start still belongs to it.
  early_window_min integer not null default 60 check (early_window_min between 0 and 240),
  -- Arriving later than this after the start counts as late.
  late_tolerance_min integer not null default 10 check (late_tolerance_min between 0 and 120),
  -- Not clocked in this many minutes after a scheduled start = absent.
  absent_after_min integer not null default 120 check (absent_after_min between 1 and 720),
  -- An open session older than this is closed at its shift's end.
  auto_close_after_hours integer not null default 22
    check (auto_close_after_hours between 12 and 48),
  -- Starting an operation without a clock-in.
  operation_without_clock_in text not null default 'auto_clock_in'
    check (operation_without_clock_in in ('auto_clock_in', 'warn', 'block')),
  updated_at timestamptz not null default now()
);

comment on table public.attendance_settings is 'Attendance rules per organization (one row).';

insert into public.attendance_settings (organization_id)
select o.id from public.organizations o
on conflict do nothing;

create function private.create_attendance_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attendance_settings (organization_id) values (new.id)
  on conflict do nothing;
  return null;
end;
$$;

create trigger organizations_attendance_settings after insert on public.organizations
  for each row execute function private.create_attendance_settings();

create trigger attendance_settings_updated_at before update on public.attendance_settings
  for each row execute function private.set_updated_at();
create trigger attendance_settings_audit after update on public.attendance_settings
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Shifts and breaks
-- ---------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 60),
  -- Short label for calendars and the floor (e.g. "I", "II", "N", "T12").
  code text not null check (length(btrim(code)) between 1 and 10),
  starts_at time not null,
  -- Not after starts_at = the shift ends on the next day.
  ends_at time not null,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  constraint shifts_not_empty check (starts_at <> ends_at)
);

comment on table public.shifts is
  'Shift definitions per organization; ends_at <= starts_at means the shift ends the next day.';

create unique index shifts_name_active on public.shifts (organization_id, lower(btrim(name)))
  where archived_at is null;
create unique index shifts_code_active on public.shifts (organization_id, lower(btrim(code)))
  where archived_at is null;

create table public.shift_breaks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shift_id uuid not null,
  position integer not null check (position between 1 and 20),
  name text check (name is null or length(btrim(name)) between 1 and 60),
  -- Null = taken any time during the shift.
  starts_at time,
  duration_min integer not null check (duration_min between 1 and 240),
  paid boolean not null default false,
  unique (organization_id, id),
  unique (shift_id, position),
  foreign key (organization_id, shift_id)
    references public.shifts (organization_id, id) on delete cascade
);

create index shift_breaks_shift_idx on public.shift_breaks (organization_id, shift_id);

create trigger shifts_updated_at before update on public.shifts
  for each row execute function private.set_updated_at();
create trigger shifts_audit after insert or update on public.shifts
  for each row execute function private.audit_row_change();
create trigger shift_breaks_audit after insert or update or delete on public.shift_breaks
  for each row execute function private.audit_row_change();

-- Length of a shift in minutes on a calendar without a DST change.
create function private.shift_nominal_minutes(p_starts time, p_ends time)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (extract(epoch from (p_ends - p_starts))::integer / 60 + case when p_ends <= p_starts then 1440 else 0 end)
$$;

-- ---------------------------------------------------------------------------
-- Schedule (calendar; screens in part B)
-- ---------------------------------------------------------------------------
create table public.shift_schedule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  work_date date not null,
  shift_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (organization_id, id),
  unique (organization_id, employee_id, work_date),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  foreign key (organization_id, shift_id)
    references public.shifts (organization_id, id) on delete restrict
);

create index shift_schedule_date_idx on public.shift_schedule (organization_id, work_date);
create index shift_schedule_shift_idx on public.shift_schedule (organization_id, shift_id);

create trigger shift_schedule_audit after insert or update or delete on public.shift_schedule
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Attendance sessions and alerts
-- ---------------------------------------------------------------------------
create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  -- Recognised at clock-in (null = outside every shift).
  shift_id uuid,
  -- Day the shift belongs to (a night shift belongs to the day it starts).
  work_date date not null,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  -- Snapshot of the shift's breaks: [{starts_at: timestamptz|null, minutes, paid}].
  breaks jsonb not null default '[]'::jsonb check (jsonb_typeof(breaks) = 'array'),
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  clock_in_source text not null check (clock_in_source in ('mobile', 'kiosk', 'operation', 'manual')),
  clock_out_source text check (clock_out_source in ('mobile', 'kiosk', 'auto', 'manual')),
  clock_in_by uuid default auth.uid(),
  clock_out_by uuid,
  idempotency_key uuid not null,
  clock_out_key uuid,
  created_at timestamptz not null default now(),
  -- Set when a correction (part B) replaces the session; it stays as history.
  archived_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  unique (organization_id, clock_out_key),
  constraint attendance_sessions_period_check
    check (clock_out_at is null or clock_out_at >= clock_in_at),
  constraint attendance_sessions_out_source_check
    check ((clock_out_at is null) = (clock_out_source is null)),
  constraint attendance_sessions_schedule_check
    check ((scheduled_start is null) = (scheduled_end is null)
      and (scheduled_end is null or scheduled_end > scheduled_start)),
  -- One employee is never clocked in twice at the same time.
  constraint attendance_sessions_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(clock_in_at, clock_out_at, '[)') with &&
  ) where (archived_at is null),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  foreign key (organization_id, shift_id)
    references public.shifts (organization_id, id) on delete restrict
);

comment on table public.attendance_sessions is
  'Presence in the company (clock-in / clock-out), recorded by the server; separate from time on operations.';

create index attendance_sessions_employee_idx
  on public.attendance_sessions (organization_id, employee_id, clock_in_at desc);
create index attendance_sessions_date_idx on public.attendance_sessions (organization_id, work_date);
create index attendance_sessions_open_idx on public.attendance_sessions (organization_id, clock_in_at)
  where clock_out_at is null and archived_at is null;
create index attendance_sessions_shift_idx on public.attendance_sessions (organization_id, shift_id);

create trigger attendance_sessions_audit after insert or update on public.attendance_sessions
  for each row execute function private.audit_row_change();

create table public.attendance_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  kind text not null check (kind in ('auto_clock_out', 'auto_clock_in')),
  employee_id uuid not null,
  session_id uuid not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  note text check (note is null or length(btrim(note)) between 1 and 500),
  unique (organization_id, id),
  unique (session_id, kind),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  foreign key (organization_id, session_id)
    references public.attendance_sessions (organization_id, id) on delete restrict
);

create index attendance_alerts_open_idx on public.attendance_alerts (organization_id, created_at)
  where resolved_at is null;
create index attendance_alerts_employee_idx on public.attendance_alerts (organization_id, employee_id);

create trigger attendance_alerts_audit after insert or update on public.attendance_alerts
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS: shifts are visible to every member (workers see their shift);
-- attendance to attendance.read or the employee it belongs to. Writes go
-- through the functions below; only the settings row is updated directly.
-- ---------------------------------------------------------------------------
create function private.is_own_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.user_id = (select auth.uid())
  )
$$;

revoke all on public.attendance_settings, public.shifts, public.shift_breaks,
  public.shift_schedule, public.attendance_sessions, public.attendance_alerts
  from anon, authenticated;
grant select on public.attendance_settings, public.shifts, public.shift_breaks,
  public.shift_schedule, public.attendance_sessions, public.attendance_alerts
  to authenticated;
grant update (early_window_min, late_tolerance_min, absent_after_min, auto_close_after_hours,
  operation_without_clock_in) on public.attendance_settings to authenticated;

alter table public.attendance_settings enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_breaks enable row level security;
alter table public.shift_schedule enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_alerts enable row level security;

create policy attendance_settings_select on public.attendance_settings
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));
create policy attendance_settings_update on public.attendance_settings
  for update to authenticated
  using (private.has_permission(organization_id, 'shifts.manage'))
  with check (private.has_permission(organization_id, 'shifts.manage'));
create policy shifts_select on public.shifts
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));
create policy shift_breaks_select on public.shift_breaks
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));
create policy shift_schedule_select on public.shift_schedule
  for select to authenticated
  using (private.has_permission(organization_id, 'attendance.read')
    or (organization_id in (select private.user_org_ids()) and private.is_own_employee(employee_id)));
create policy attendance_sessions_select on public.attendance_sessions
  for select to authenticated
  using (private.has_permission(organization_id, 'attendance.read')
    or (organization_id in (select private.user_org_ids()) and private.is_own_employee(employee_id)));
create policy attendance_alerts_select on public.attendance_alerts
  for select to authenticated
  using (private.has_permission(organization_id, 'attendance.read'));

-- ---------------------------------------------------------------------------
-- Shift definitions (shifts.manage)
-- ---------------------------------------------------------------------------
-- Creates or updates a shift with its breaks (replaced as a whole). p_breaks:
-- [{"name": text|null, "starts_at": "HH:MM"|null, "minutes": int, "paid": bool}].
-- Past attendance keeps its own snapshot, so changing a shift is safe.
create function public.save_shift(
  p_org_id uuid,
  p_id uuid,
  p_name text,
  p_code text,
  p_starts_at time,
  p_ends_at time,
  p_color text,
  p_breaks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_length integer;
  v_total integer := 0;
  v_break jsonb;
  v_position integer := 0;
  v_start time;
  v_offset integer;
  v_minutes integer;
begin
  if not private.has_permission(p_org_id, 'shifts.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at = p_ends_at then
    raise exception 'invalid_shift_times' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_breaks, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_breaks, '[]'::jsonb)) > 20 then
    raise exception 'invalid breaks' using errcode = '22023';
  end if;
  v_length := private.shift_nominal_minutes(p_starts_at, p_ends_at);

  for v_break in select * from jsonb_array_elements(coalesce(p_breaks, '[]'::jsonb)) loop
    v_minutes := (v_break ->> 'minutes')::integer;
    if v_minutes is null or v_minutes < 1 or v_minutes > 240 then
      raise exception 'invalid breaks' using errcode = '22023';
    end if;
    v_total := v_total + v_minutes;
    if nullif(v_break ->> 'starts_at', '') is not null then
      v_start := (v_break ->> 'starts_at')::time;
      v_offset := private.shift_nominal_minutes(p_starts_at, v_start) % 1440;
      if v_offset + v_minutes > v_length then
        raise exception 'break_outside_shift' using errcode = '22023';
      end if;
    end if;
  end loop;
  if v_total >= v_length then
    raise exception 'breaks_too_long' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.shifts (organization_id, name, code, starts_at, ends_at, color)
    values (p_org_id, btrim(p_name), btrim(p_code), p_starts_at, p_ends_at, nullif(btrim(p_color), ''))
    returning id into v_id;
  else
    update public.shifts set
      name = btrim(p_name),
      code = btrim(p_code),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      color = nullif(btrim(p_color), '')
    where id = v_id and organization_id = p_org_id and archived_at is null;
    if not found then
      raise exception 'shift not found' using errcode = 'P0002';
    end if;
    delete from public.shift_breaks where shift_id = v_id;
  end if;

  for v_break in select * from jsonb_array_elements(coalesce(p_breaks, '[]'::jsonb)) loop
    v_position := v_position + 1;
    insert into public.shift_breaks (organization_id, shift_id, position, name, starts_at, duration_min, paid)
    values (
      p_org_id, v_id, v_position, nullif(btrim(v_break ->> 'name'), ''),
      nullif(v_break ->> 'starts_at', '')::time, (v_break ->> 'minutes')::integer,
      coalesce((v_break ->> 'paid')::boolean, false)
    );
  end loop;
  return v_id;
end;
$$;

create function public.set_shift_archived(p_shift_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select s.organization_id into v_org from public.shifts s where s.id = p_shift_id;
  if v_org is null or not private.has_permission(v_org, 'shifts.manage') then
    raise exception 'shift not found' using errcode = 'P0002';
  end if;
  update public.shifts
  set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_shift_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shift recognition
-- ---------------------------------------------------------------------------
-- The shift an employee works at p_at: a scheduled shift (yesterday's night
-- shift, today's or tomorrow's early one) when the schedule has entries for
-- those days, otherwise any shift. Candidates are shifts whose window
-- [start - early window, end) contains p_at; the closest start wins. Times
-- are converted in the organization's time zone, so a shift in the night of
-- a DST change has its real length.
create function private.recognize_shift(p_employee_id uuid, p_at timestamptz)
returns table (
  shift_id uuid,
  work_date date,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  breaks jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_tz text;
  v_early integer;
  v_day date;
  v_scheduled boolean;
begin
  select e.organization_id, o.timezone into v_org, v_tz
  from public.employees e
  join public.organizations o on o.id = e.organization_id
  where e.id = p_employee_id;
  select s.early_window_min into v_early from public.attendance_settings s where s.organization_id = v_org;
  v_early := coalesce(v_early, 60);
  v_day := (p_at at time zone v_tz)::date;

  v_scheduled := exists (
    select 1 from public.shift_schedule ss
    where ss.employee_id = p_employee_id and ss.work_date between v_day - 1 and v_day + 1
  );

  return query
  with candidates as (
    select s.id, d.day,
      (d.day + s.starts_at) at time zone v_tz as start_at,
      ((d.day + case when s.ends_at <= s.starts_at then 1 else 0 end) + s.ends_at) at time zone v_tz as end_at
    from public.shifts s
    cross join (values (v_day - 1), (v_day), (v_day + 1)) as d (day)
    where s.organization_id = v_org
      and s.archived_at is null
      and (
        (v_scheduled and exists (
          select 1 from public.shift_schedule ss
          where ss.employee_id = p_employee_id and ss.work_date = d.day and ss.shift_id = s.id
        ))
        or not v_scheduled
      )
  )
  select c.id, c.day, c.start_at, c.end_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'starts_at', case when b.starts_at is null then null else
          (c.day + b.starts_at
            + case when b.starts_at < (select s.starts_at from public.shifts s where s.id = c.id)
              then interval '1 day' else interval '0' end) at time zone v_tz end,
        'minutes', b.duration_min,
        'paid', b.paid
      ) order by b.position)
      from public.shift_breaks b where b.shift_id = c.id
    ), '[]'::jsonb)
  from candidates c
  where p_at >= c.start_at - make_interval(mins => v_early) and p_at < c.end_at
  order by abs(extract(epoch from (p_at - c.start_at))), c.start_at
  limit 1;
end;
$$;

-- Readable for checks and tests: the caller's own employee or attendance.read.
create function public.attendance_shift_for(p_employee_id uuid, p_at timestamptz)
returns table (
  shift_id uuid,
  work_date date,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  breaks jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from private.recognize_shift(p_employee_id, p_at) r
  where exists (
    select 1 from public.employees e
    where e.id = p_employee_id
      and (private.has_permission(e.organization_id, 'attendance.read')
        or (e.user_id = (select auth.uid()) and e.organization_id in (select private.user_org_ids())))
  )
$$;

-- ---------------------------------------------------------------------------
-- Clock-in / clock-out
-- ---------------------------------------------------------------------------
-- Open sessions older than the organization's limit are closed at their
-- shift's end (without a shift: at the clock-in, i.e. zero hours) and an
-- alert asks the foreman to check with the worker. Runs whenever attendance
-- is touched, so no scheduler is needed; the result does not depend on when
-- it runs.
create function private.close_overdue_attendance(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer;
  v_session record;
begin
  select s.auto_close_after_hours into v_hours
  from public.attendance_settings s where s.organization_id = p_org_id;
  v_hours := coalesce(v_hours, 22);

  for v_session in
    update public.attendance_sessions a set
      clock_out_at = greatest(a.clock_in_at, coalesce(a.scheduled_end, a.clock_in_at)),
      clock_out_source = 'auto',
      clock_out_by = null
    where a.organization_id = p_org_id
      and a.clock_out_at is null
      and a.archived_at is null
      and a.clock_in_at < now() - make_interval(hours => v_hours)
    returning a.id, a.employee_id
  loop
    insert into public.attendance_alerts (organization_id, kind, employee_id, session_id)
    values (p_org_id, 'auto_clock_out', v_session.employee_id, v_session.id)
    on conflict do nothing;
  end loop;
end;
$$;

create function private.open_attendance_session(p_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.attendance_sessions a
  where a.employee_id = p_employee_id and a.clock_out_at is null and a.archived_at is null
$$;

create function private.clock_in_employee(p_employee_id uuid, p_source text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_shift record;
begin
  select e.organization_id into v_org from public.employees e
  where e.id = p_employee_id and e.status = 'active' and e.archived_at is null;
  if v_org is null then
    raise exception 'not_an_employee' using errcode = '42501';
  end if;
  if not private.module_enabled(v_org, 'attendance') then
    raise exception 'module_disabled' using errcode = '55000';
  end if;

  select a.id into v_id from public.attendance_sessions a
  where a.organization_id = v_org and a.idempotency_key = p_idempotency_key;
  if v_id is not null then
    return v_id;
  end if;

  perform private.close_overdue_attendance(v_org);
  -- Serialize clock-ins of one employee (double taps, kiosk and phone).
  perform 1 from public.employees e where e.id = p_employee_id for update;
  if private.open_attendance_session(p_employee_id) is not null then
    raise exception 'already_clocked_in' using errcode = '55000';
  end if;

  select * into v_shift from private.recognize_shift(p_employee_id, now());
  insert into public.attendance_sessions (
    organization_id, employee_id, shift_id, work_date, scheduled_start, scheduled_end, breaks,
    clock_in_source, idempotency_key
  ) values (
    v_org, p_employee_id, v_shift.shift_id,
    coalesce(v_shift.work_date,
      (now() at time zone (select o.timezone from public.organizations o where o.id = v_org))::date),
    v_shift.scheduled_start, v_shift.scheduled_end, coalesce(v_shift.breaks, '[]'::jsonb),
    p_source, p_idempotency_key
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.clock_in(p_org_id uuid, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  v_employee := private.current_employee(p_org_id);
  if v_employee is null then
    raise exception 'not_an_employee' using errcode = '42501';
  end if;
  return private.clock_in_employee(v_employee, 'mobile', p_idempotency_key);
end;
$$;

create function public.clock_out(p_org_id uuid, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid;
  v_id uuid;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  v_employee := private.current_employee(p_org_id);
  if v_employee is null then
    raise exception 'not_an_employee' using errcode = '42501';
  end if;

  select a.id into v_id from public.attendance_sessions a
  where a.organization_id = p_org_id and a.clock_out_key = p_idempotency_key;
  if v_id is not null then
    return v_id;
  end if;

  perform private.close_overdue_attendance(p_org_id);
  perform 1 from public.employees e where e.id = v_employee for update;
  v_id := private.open_attendance_session(v_employee);
  if v_id is null then
    raise exception 'not_clocked_in' using errcode = '55000';
  end if;
  update public.attendance_sessions set
    clock_out_at = greatest(now(), clock_in_at),
    clock_out_source = 'mobile',
    clock_out_by = auth.uid(),
    clock_out_key = p_idempotency_key
  where id = v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Work on an operation needs a clock-in (attendance module enabled):
-- auto_clock_in (default) clocks the worker in now and alerts the foreman,
-- warn lets the work start (the floor shows a notice), block refuses it.
-- Same as 20261026100000 plus the attendance check.
-- ---------------------------------------------------------------------------
create or replace function public.start_operation_work(p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
  v_rule text;
  v_session uuid;
begin
  select * into w from private.floor_work_operation(p_operation_id);

  if (w.op_row).status = 'done' then
    raise exception 'operation_done' using errcode = '55000';
  end if;
  if (w.order_row).status = 'paused' then
    raise exception 'order_paused' using errcode = '55000';
  end if;
  if (w.order_row).status not in ('ready', 'in_progress', 'quality_check') then
    raise exception 'order_not_ready' using errcode = '55000';
  end if;
  if not private.operation_arrived(p_operation_id) then
    raise exception 'not_arrived' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.production_work_sessions s
    where s.operation_id = p_operation_id and s.employee_id = w.employee_id and s.ended_at is null
  ) then
    return;
  end if;

  if private.module_enabled((w.op_row).organization_id, 'attendance') then
    perform private.close_overdue_attendance((w.op_row).organization_id);
    if private.open_attendance_session(w.employee_id) is null then
      select s.operation_without_clock_in into v_rule
      from public.attendance_settings s where s.organization_id = (w.op_row).organization_id;
      if v_rule = 'block' then
        raise exception 'not_clocked_in' using errcode = '55000';
      elsif coalesce(v_rule, 'auto_clock_in') = 'auto_clock_in' then
        v_session := private.clock_in_employee(w.employee_id, 'operation', gen_random_uuid());
        insert into public.attendance_alerts (organization_id, kind, employee_id, session_id)
        values ((w.op_row).organization_id, 'auto_clock_in', w.employee_id, v_session)
        on conflict do nothing;
      end if;
    end if;
  end if;

  update public.production_downtime_events set ended_at = now()
  where operation_id = p_operation_id and ended_at is null;
  insert into public.production_work_sessions (
    organization_id, order_id, operation_id, employee_id, machine_id
  ) values (
    (w.op_row).organization_id, (w.op_row).order_id, p_operation_id, w.employee_id,
    (w.op_row).machine_id
  );
  perform private.set_operation_status_internal(p_operation_id, 'in_progress');

  if not w.is_inspection then
    perform private.advance_order((w.op_row).order_id, 'in_progress');
  elsif (w.order_row).status = 'ready' then
    perform private.advance_order((w.op_row).order_id, 'in_progress');
  end if;
  perform private.sync_machine_status((w.op_row).machine_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
create function public.resolve_attendance_alert(p_alert_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select a.organization_id into v_org from public.attendance_alerts a where a.id = p_alert_id;
  if v_org is null or not private.has_permission(v_org, 'attendance.read') then
    raise exception 'alert not found' using errcode = 'P0002';
  end if;
  if not private.has_permission(v_org, 'attendance.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if length(btrim(p_note)) > 500 then
    raise exception 'notes too long' using errcode = '22023';
  end if;
  update public.attendance_alerts set
    resolved_at = now(),
    resolved_by = auth.uid(),
    note = nullif(btrim(p_note), '')
  where id = p_alert_id and resolved_at is null;
end;
$$;

-- Open alerts for the bell (closes overdue sessions first, so a forgotten
-- clock-out shows up without a scheduler).
create function public.pending_attendance_alerts(p_org_id uuid)
returns table (
  alert_id uuid,
  kind text,
  employee_id uuid,
  employee_name text,
  session_id uuid,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'attendance.manage')
    or not private.module_enabled(p_org_id, 'attendance') then
    return;
  end if;
  perform private.close_overdue_attendance(p_org_id);
  return query
  select a.id, a.kind, e.id, e.first_name || ' ' || e.last_name, s.id, s.clock_in_at,
    s.clock_out_at, a.created_at
  from public.attendance_alerts a
  join public.employees e on e.id = a.employee_id
  join public.attendance_sessions s on s.id = a.session_id
  where a.organization_id = p_org_id and a.resolved_at is null
  order by a.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
create function private.attendance_session_json(s public.attendance_sessions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'employee_id', s.employee_id, 'shift_id', s.shift_id,
    'shift_code', sh.code, 'shift_name', sh.name, 'work_date', s.work_date,
    'scheduled_start', s.scheduled_start, 'scheduled_end', s.scheduled_end, 'breaks', s.breaks,
    'clock_in_at', s.clock_in_at, 'clock_out_at', s.clock_out_at,
    'clock_in_source', s.clock_in_source, 'clock_out_source', s.clock_out_source
  )
  from (select 1) as x
  left join public.shifts sh on sh.id = s.shift_id
$$;

-- The caller's own attendance for [p_from, p_to] (work dates): sessions, the
-- open one, today's scheduled shift and the rules needed to compute hours.
create function public.my_attendance(p_org_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid := private.current_employee(p_org_id);
  v_today date;
begin
  if v_employee is null then
    return null;
  end if;
  if not private.module_enabled(p_org_id, 'attendance') then
    return null;
  end if;
  perform private.close_overdue_attendance(p_org_id);
  select (now() at time zone o.timezone)::date into v_today from public.organizations o where o.id = p_org_id;

  return jsonb_build_object(
    'employee_id', v_employee,
    'open', (
      select private.attendance_session_json(a) from public.attendance_sessions a
      where a.employee_id = v_employee and a.clock_out_at is null and a.archived_at is null
    ),
    'sessions', coalesce((
      select jsonb_agg(private.attendance_session_json(a) order by a.clock_in_at)
      from public.attendance_sessions a
      where a.employee_id = v_employee and a.archived_at is null
        and a.work_date between p_from and p_to
    ), '[]'::jsonb),
    'today_shift', (
      select jsonb_build_object('code', s.code, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
      from public.shift_schedule ss join public.shifts s on s.id = ss.shift_id
      where ss.employee_id = v_employee and ss.work_date = v_today
    ),
    'expected_shift', (
      select jsonb_build_object('code', s.code, 'name', s.name, 'scheduled_start', r.scheduled_start,
        'scheduled_end', r.scheduled_end)
      from private.recognize_shift(v_employee, now()) r join public.shifts s on s.id = r.shift_id
    )
  );
end;
$$;

-- Foreman's board for one work date: every active employee with their
-- scheduled shift and sessions of that date, plus everyone clocked in now.
create function public.attendance_board(p_org_id uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'attendance.read') then
    return null;
  end if;
  perform private.close_overdue_attendance(p_org_id);
  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'number', e.employee_number, 'name', e.first_name || ' ' || e.last_name,
        'department', d.name,
        'scheduled', (
          select jsonb_build_object('shift_id', s.id, 'code', s.code, 'name', s.name,
            'scheduled_start', (ss.work_date + s.starts_at) at time zone o.timezone)
          from public.shift_schedule ss join public.shifts s on s.id = ss.shift_id
          where ss.employee_id = e.id and ss.work_date = p_date
        ),
        'sessions', coalesce((
          select jsonb_agg(private.attendance_session_json(a) order by a.clock_in_at)
          from public.attendance_sessions a
          where a.employee_id = e.id and a.archived_at is null
            and (a.work_date = p_date or a.clock_out_at is null)
        ), '[]'::jsonb)
      ) order by e.last_name, e.first_name)
      from public.employees e
      join public.organizations o on o.id = e.organization_id
      left join public.catalog_items d on d.id = e.department_id
      where e.organization_id = p_org_id and e.status = 'active' and e.archived_at is null
    ), '[]'::jsonb),
    'settings', (
      select jsonb_build_object('late_tolerance_min', s.late_tolerance_min,
        'absent_after_min', s.absent_after_min)
      from public.attendance_settings s where s.organization_id = p_org_id
    )
  );
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.module_enabled(uuid, text)',
    'private.is_own_employee(uuid)',
    'private.shift_nominal_minutes(time, time)',
    'private.recognize_shift(uuid, timestamptz)',
    'private.close_overdue_attendance(uuid)',
    'private.open_attendance_session(uuid)',
    'private.clock_in_employee(uuid, text, uuid)',
    'private.attendance_session_json(public.attendance_sessions)',
    'private.create_attendance_settings()'
  ] loop
    execute format('revoke execute on function %s from public', v_fn);
  end loop;
  -- Used inside RLS policies evaluated as the caller.
  grant execute on function private.module_enabled(uuid, text) to authenticated;
  grant execute on function private.is_own_employee(uuid) to authenticated;

  foreach v_fn in array array[
    'public.save_shift(uuid, uuid, text, text, time, time, text, jsonb)',
    'public.set_shift_archived(uuid, boolean)',
    'public.attendance_shift_for(uuid, timestamptz)',
    'public.clock_in(uuid, uuid)',
    'public.clock_out(uuid, uuid)',
    'public.resolve_attendance_alert(uuid, text)',
    'public.pending_attendance_alerts(uuid)',
    'public.my_attendance(uuid, date, date)',
    'public.attendance_board(uuid, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
