-- Shifts and working time, part B1: schedule (D-023).
--   * shift_crews + shift_crew_members: crews ("ekipe"), an employee belongs
--     to at most one crew.
--   * shift_rotations + shift_rotation_days: repeating patterns of N days
--     (e.g. 14 days: week of I shift, week of II shift; 8 days: 2 day, 2 night,
--     4 off for four crews on turnus). Days without a row are days off.
--   * shift_rotation_assignments: a crew or one employee follows a rotation
--     from a start date (day 1 of the pattern) until an optional end date.
--   * shift_schedule (part A) gets a source: rows written by
--     apply_rotations() are 'rotation', rows set by hand or copied are
--     'manual' and are never overwritten by a rotation.
-- Everything here is planning: rows are replaced or removed (audited), not
-- archived; attendance keeps its own snapshot of the shift.

alter table public.shift_schedule
  add column source text not null default 'manual' check (source in ('manual', 'rotation'));

-- ---------------------------------------------------------------------------
-- Crews
-- ---------------------------------------------------------------------------
create table public.shift_crews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 60),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id)
);

create unique index shift_crews_name_active on public.shift_crews (organization_id, lower(btrim(name)))
  where archived_at is null;

create table public.shift_crew_members (
  organization_id uuid not null,
  crew_id uuid not null,
  employee_id uuid not null,
  primary key (crew_id, employee_id),
  -- One crew per employee.
  unique (organization_id, employee_id),
  foreign key (organization_id, crew_id)
    references public.shift_crews (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict
);

create trigger shift_crews_updated_at before update on public.shift_crews
  for each row execute function private.set_updated_at();
create trigger shift_crews_audit after insert or update on public.shift_crews
  for each row execute function private.audit_row_change();
create trigger shift_crew_members_audit after insert or delete on public.shift_crew_members
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Rotations
-- ---------------------------------------------------------------------------
create table public.shift_rotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 60),
  cycle_days integer not null check (cycle_days between 1 and 56),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id)
);

create unique index shift_rotations_name_active
  on public.shift_rotations (organization_id, lower(btrim(name)))
  where archived_at is null;

create table public.shift_rotation_days (
  organization_id uuid not null,
  rotation_id uuid not null,
  -- 0-based day of the cycle.
  day_index integer not null check (day_index between 0 and 55),
  shift_id uuid not null,
  primary key (rotation_id, day_index),
  foreign key (organization_id, rotation_id)
    references public.shift_rotations (organization_id, id) on delete cascade,
  foreign key (organization_id, shift_id)
    references public.shifts (organization_id, id) on delete restrict
);

create table public.shift_rotation_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  rotation_id uuid not null,
  crew_id uuid,
  employee_id uuid,
  -- Day 1 of the pattern falls on this date.
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint shift_rotation_assignments_target_check
    check ((crew_id is null) <> (employee_id is null)),
  constraint shift_rotation_assignments_period_check
    check (end_date is null or end_date >= start_date),
  foreign key (organization_id, rotation_id)
    references public.shift_rotations (organization_id, id) on delete restrict,
  foreign key (organization_id, crew_id)
    references public.shift_crews (organization_id, id) on delete restrict,
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict
);

create index shift_rotation_assignments_rotation_idx
  on public.shift_rotation_assignments (organization_id, rotation_id);
create index shift_rotation_assignments_crew_idx
  on public.shift_rotation_assignments (organization_id, crew_id);
create index shift_rotation_assignments_employee_idx
  on public.shift_rotation_assignments (organization_id, employee_id);

create trigger shift_rotations_updated_at before update on public.shift_rotations
  for each row execute function private.set_updated_at();
create trigger shift_rotations_audit after insert or update on public.shift_rotations
  for each row execute function private.audit_row_change();
create trigger shift_rotation_days_audit after insert or delete on public.shift_rotation_days
  for each row execute function private.audit_row_change();
create trigger shift_rotation_assignments_audit
  after insert or update or delete on public.shift_rotation_assignments
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS: crews, rotations and assignments are read by attendance.read; workers
-- see their own schedule rows (part A policy). Writes through functions.
-- ---------------------------------------------------------------------------
revoke all on public.shift_crews, public.shift_crew_members, public.shift_rotations,
  public.shift_rotation_days, public.shift_rotation_assignments from anon, authenticated;
grant select on public.shift_crews, public.shift_crew_members, public.shift_rotations,
  public.shift_rotation_days, public.shift_rotation_assignments to authenticated;

alter table public.shift_crews enable row level security;
alter table public.shift_crew_members enable row level security;
alter table public.shift_rotations enable row level security;
alter table public.shift_rotation_days enable row level security;
alter table public.shift_rotation_assignments enable row level security;

create policy shift_crews_select on public.shift_crews
  for select to authenticated using (private.has_permission(organization_id, 'attendance.read'));
create policy shift_crew_members_select on public.shift_crew_members
  for select to authenticated using (private.has_permission(organization_id, 'attendance.read'));
create policy shift_rotations_select on public.shift_rotations
  for select to authenticated using (private.has_permission(organization_id, 'attendance.read'));
create policy shift_rotation_days_select on public.shift_rotation_days
  for select to authenticated using (private.has_permission(organization_id, 'attendance.read'));
create policy shift_rotation_assignments_select on public.shift_rotation_assignments
  for select to authenticated using (private.has_permission(organization_id, 'attendance.read'));

create function private.require_attendance_manage(p_org_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'attendance.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Crews and rotations (attendance.manage)
-- ---------------------------------------------------------------------------
-- Creates or updates a crew with its members; a member moves out of any
-- other crew.
create function public.save_crew(
  p_org_id uuid,
  p_id uuid,
  p_name text,
  p_color text,
  p_employee_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_ids uuid[] := coalesce(p_employee_ids, '{}');
begin
  perform private.require_attendance_manage(p_org_id);
  if exists (
    select 1 from unnest(v_ids) as x (id)
    where not exists (
      select 1 from public.employees e
      where e.id = x.id and e.organization_id = p_org_id and e.archived_at is null
    )
  ) then
    raise exception 'employee not found' using errcode = '23503';
  end if;

  if v_id is null then
    insert into public.shift_crews (organization_id, name, color)
    values (p_org_id, btrim(p_name), nullif(btrim(p_color), ''))
    returning id into v_id;
  else
    update public.shift_crews set name = btrim(p_name), color = nullif(btrim(p_color), '')
    where id = v_id and organization_id = p_org_id and archived_at is null;
    if not found then
      raise exception 'crew not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.shift_crew_members m
  where (m.crew_id = v_id and not (m.employee_id = any (v_ids)))
    or (m.organization_id = p_org_id and m.employee_id = any (v_ids) and m.crew_id <> v_id);
  insert into public.shift_crew_members (organization_id, crew_id, employee_id)
  select p_org_id, v_id, x.id from unnest(v_ids) as x (id)
  on conflict do nothing;
  return v_id;
end;
$$;

create function public.set_crew_archived(p_crew_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select c.organization_id into v_org from public.shift_crews c where c.id = p_crew_id;
  if v_org is null then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  perform private.require_attendance_manage(v_org);
  update public.shift_crews
  set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_crew_id;
  if p_archived then
    delete from public.shift_crew_members where crew_id = p_crew_id;
    update public.shift_rotation_assignments
    set end_date = greatest(start_date, (now() at time zone 'utc')::date)
    where crew_id = p_crew_id and (end_date is null or end_date > (now() at time zone 'utc')::date);
  end if;
end;
$$;

-- p_days: [{"day": 0-based index, "shift_id": uuid}] (missing days are off).
create function public.save_rotation(
  p_org_id uuid,
  p_id uuid,
  p_name text,
  p_cycle_days integer,
  p_days jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  perform private.require_attendance_manage(p_org_id);
  if p_cycle_days is null or p_cycle_days < 1 or p_cycle_days > 56
    or jsonb_typeof(coalesce(p_days, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid rotation' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) d
    where (d ->> 'day')::integer not between 0 and p_cycle_days - 1
      or not exists (
        select 1 from public.shifts s
        where s.id = (d ->> 'shift_id')::uuid and s.organization_id = p_org_id
          and s.archived_at is null
      )
  ) then
    raise exception 'invalid rotation' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.shift_rotations (organization_id, name, cycle_days)
    values (p_org_id, btrim(p_name), p_cycle_days)
    returning id into v_id;
  else
    update public.shift_rotations set name = btrim(p_name), cycle_days = p_cycle_days
    where id = v_id and organization_id = p_org_id and archived_at is null;
    if not found then
      raise exception 'rotation not found' using errcode = 'P0002';
    end if;
    delete from public.shift_rotation_days where rotation_id = v_id;
  end if;

  insert into public.shift_rotation_days (organization_id, rotation_id, day_index, shift_id)
  select distinct on ((d ->> 'day')::integer)
    p_org_id, v_id, (d ->> 'day')::integer, (d ->> 'shift_id')::uuid
  from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) d;
  return v_id;
end;
$$;

create function public.set_rotation_archived(p_rotation_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select r.organization_id into v_org from public.shift_rotations r where r.id = p_rotation_id;
  if v_org is null then
    raise exception 'rotation not found' using errcode = 'P0002';
  end if;
  perform private.require_attendance_manage(v_org);
  update public.shift_rotations
  set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_rotation_id;
end;
$$;

-- A crew or an employee follows a rotation from p_start_date (pattern day 1).
create function public.assign_rotation(
  p_org_id uuid,
  p_rotation_id uuid,
  p_crew_id uuid,
  p_employee_id uuid,
  p_start_date date,
  p_end_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_attendance_manage(p_org_id);
  if not exists (
    select 1 from public.shift_rotations r
    where r.id = p_rotation_id and r.organization_id = p_org_id and r.archived_at is null
  ) then
    raise exception 'rotation not found' using errcode = 'P0002';
  end if;
  if (p_crew_id is null) = (p_employee_id is null) or p_start_date is null
    or (p_end_date is not null and p_end_date < p_start_date) then
    raise exception 'invalid assignment' using errcode = '22023';
  end if;
  insert into public.shift_rotation_assignments (
    organization_id, rotation_id, crew_id, employee_id, start_date, end_date
  ) values (p_org_id, p_rotation_id, p_crew_id, p_employee_id, p_start_date, p_end_date)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.end_rotation_assignment(p_assignment_id uuid, p_end_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.shift_rotation_assignments;
begin
  select * into v_row from public.shift_rotation_assignments a where a.id = p_assignment_id;
  if v_row.id is null then
    raise exception 'assignment not found' using errcode = 'P0002';
  end if;
  perform private.require_attendance_manage(v_row.organization_id);
  if p_end_date is null or p_end_date < v_row.start_date then
    -- Ended before it began: it never applied.
    delete from public.shift_rotation_assignments where id = p_assignment_id;
    delete from public.shift_schedule s
    where s.organization_id = v_row.organization_id and s.source = 'rotation'
      and s.work_date >= v_row.start_date
      and s.employee_id in (
        select coalesce(v_row.employee_id, m.employee_id)
        from (select 1) x
        left join public.shift_crew_members m on m.crew_id = v_row.crew_id
      );
    return;
  end if;
  update public.shift_rotation_assignments set end_date = p_end_date where id = p_assignment_id;
  delete from public.shift_schedule s
  where s.organization_id = v_row.organization_id and s.source = 'rotation'
    and s.work_date > p_end_date
    and s.employee_id in (
      select coalesce(v_row.employee_id, m.employee_id)
      from (select 1) x
      left join public.shift_crew_members m on m.crew_id = v_row.crew_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule writes (attendance.manage)
-- ---------------------------------------------------------------------------
-- Writes the rotations into the schedule for [p_from, p_to] (at most 62
-- days): rotation rows are replaced, manual rows stay. A crew assignment
-- covers the crew's current members. Returns the number of days planned.
create function public.apply_rotations(p_org_id uuid, p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_attendance_manage(p_org_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 61 then
    raise exception 'invalid range' using errcode = '22023';
  end if;

  delete from public.shift_schedule s
  where s.organization_id = p_org_id and s.source = 'rotation'
    and s.work_date between p_from and p_to;

  with targets as (
    select a.rotation_id, a.start_date, a.end_date, coalesce(a.employee_id, m.employee_id) as employee_id,
      -- An employee's own assignment wins over the crew's.
      case when a.employee_id is not null then 0 else 1 end as priority
    from public.shift_rotation_assignments a
    join public.shift_rotations r on r.id = a.rotation_id and r.archived_at is null
    left join public.shift_crew_members m on m.crew_id = a.crew_id
    where a.organization_id = p_org_id
      and a.start_date <= p_to and (a.end_date is null or a.end_date >= p_from)
  ),
  planned as (
    select distinct on (t.employee_id, d.day::date)
      t.employee_id, d.day::date as work_date, rd.shift_id
    from targets t
    join public.employees e on e.id = t.employee_id and e.archived_at is null and e.status = 'active'
    join public.shift_rotations r on r.id = t.rotation_id
    cross join lateral generate_series(
      greatest(p_from, t.start_date), least(p_to, coalesce(t.end_date, p_to)), interval '1 day'
    ) as d (day)
    left join public.shift_rotation_days rd
      on rd.rotation_id = t.rotation_id
      and rd.day_index = ((d.day::date - t.start_date) % r.cycle_days)
    where t.employee_id is not null
    order by t.employee_id, d.day::date, t.priority, t.start_date desc
  )
  insert into public.shift_schedule (organization_id, employee_id, work_date, shift_id, source)
  select p_org_id, p.employee_id, p.work_date, p.shift_id, 'rotation'
  from planned p
  where p.shift_id is not null
  on conflict (organization_id, employee_id, work_date) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Manual entries: [{"employee_id", "work_date", "shift_id" | null}];
-- null removes the day's entry (day off).
create function public.set_schedule_entries(p_org_id uuid, p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_count integer := 0;
begin
  perform private.require_attendance_manage(p_org_id);
  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) > 2000 then
    raise exception 'invalid entries' using errcode = '22023';
  end if;
  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    if not exists (
      select 1 from public.employees e
      where e.id = (v_entry ->> 'employee_id')::uuid and e.organization_id = p_org_id
    ) then
      raise exception 'employee not found' using errcode = '23503';
    end if;
    if nullif(v_entry ->> 'shift_id', '') is null then
      delete from public.shift_schedule
      where organization_id = p_org_id
        and employee_id = (v_entry ->> 'employee_id')::uuid
        and work_date = (v_entry ->> 'work_date')::date;
    else
      if not exists (
        select 1 from public.shifts s
        where s.id = (v_entry ->> 'shift_id')::uuid and s.organization_id = p_org_id
          and s.archived_at is null
      ) then
        raise exception 'shift not found' using errcode = '23503';
      end if;
      insert into public.shift_schedule (organization_id, employee_id, work_date, shift_id, source)
      values (
        p_org_id, (v_entry ->> 'employee_id')::uuid, (v_entry ->> 'work_date')::date,
        (v_entry ->> 'shift_id')::uuid, 'manual'
      )
      on conflict (organization_id, employee_id, work_date)
      do update set shift_id = excluded.shift_id, source = 'manual';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Copies the 7 days from p_source_monday to p_target_monday (both Mondays)
-- as manual entries; the target week is replaced for the copied employees
-- (all employees with entries in either week, or only p_employee_ids).
create function public.copy_schedule_week(
  p_org_id uuid,
  p_source_monday date,
  p_target_monday date,
  p_employee_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_attendance_manage(p_org_id);
  if p_source_monday is null or p_target_monday is null
    or extract(isodow from p_source_monday) <> 1 or extract(isodow from p_target_monday) <> 1
    or p_source_monday = p_target_monday then
    raise exception 'invalid weeks' using errcode = '22023';
  end if;

  delete from public.shift_schedule s
  where s.organization_id = p_org_id
    and s.work_date between p_target_monday and p_target_monday + 6
    and (p_employee_ids is null or s.employee_id = any (p_employee_ids))
    and (p_employee_ids is not null or exists (
      select 1 from public.shift_schedule src
      where src.organization_id = p_org_id and src.employee_id = s.employee_id
        and src.work_date between p_source_monday and p_source_monday + 6
    ));

  insert into public.shift_schedule (organization_id, employee_id, work_date, shift_id, source)
  select p_org_id, s.employee_id, s.work_date + (p_target_monday - p_source_monday), s.shift_id, 'manual'
  from public.shift_schedule s
  join public.shifts sh on sh.id = s.shift_id and sh.archived_at is null
  where s.organization_id = p_org_id
    and s.work_date between p_source_monday and p_source_monday + 6
    and (p_employee_ids is null or s.employee_id = any (p_employee_ids))
  on conflict (organization_id, employee_id, work_date)
  do update set shift_id = excluded.shift_id, source = 'manual';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
-- Schedule grid for [p_from, p_to] (at most 62 days): active employees with
-- their crew and entries (attendance.read).
create function public.schedule_range(p_org_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.has_permission(p_org_id, 'attendance.read')
      or p_to < p_from or p_to - p_from > 61 then null
    else jsonb_build_object(
      'employees', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'number', e.employee_number, 'name', e.first_name || ' ' || e.last_name,
          'department_id', e.department_id, 'department', d.name,
          'crew_id', c.id, 'crew', c.name, 'crew_color', c.color,
          'entries', coalesce((
            select jsonb_agg(jsonb_build_object(
              'date', s.work_date, 'shift_id', s.shift_id, 'source', s.source
            ) order by s.work_date)
            from public.shift_schedule s
            where s.employee_id = e.id and s.work_date between p_from and p_to
          ), '[]'::jsonb)
        ) order by c.name nulls last, e.last_name, e.first_name)
        from public.employees e
        left join public.catalog_items d on d.id = e.department_id
        left join public.shift_crew_members m on m.employee_id = e.id
        left join public.shift_crews c on c.id = m.crew_id
        where e.organization_id = p_org_id and e.status = 'active' and e.archived_at is null
      ), '[]'::jsonb)
    )
  end
$$;

-- The caller's own schedule for [p_from, p_to] (at most 62 days).
create function public.my_schedule(p_org_id uuid, p_from date, p_to date)
returns table (work_date date, shift_id uuid, code text, name text, starts_at time, ends_at time)
language sql
stable
security definer
set search_path = ''
as $$
  select s.work_date, sh.id, sh.code, sh.name, sh.starts_at, sh.ends_at
  from public.shift_schedule s
  join public.shifts sh on sh.id = s.shift_id
  where s.employee_id = private.current_employee(p_org_id)
    and s.work_date between p_from and p_to
    and p_to - p_from <= 61
  order by s.work_date
$$;

do $$
declare
  v_fn text;
begin
  revoke execute on function private.require_attendance_manage(uuid) from public;
  foreach v_fn in array array[
    'public.save_crew(uuid, uuid, text, text, uuid[])',
    'public.set_crew_archived(uuid, boolean)',
    'public.save_rotation(uuid, uuid, text, integer, jsonb)',
    'public.set_rotation_archived(uuid, boolean)',
    'public.assign_rotation(uuid, uuid, uuid, uuid, date, date)',
    'public.end_rotation_assignment(uuid, date)',
    'public.apply_rotations(uuid, date, date)',
    'public.set_schedule_entries(uuid, jsonb)',
    'public.copy_schedule_week(uuid, date, date, uuid[])',
    'public.schedule_range(uuid, date, date)',
    'public.my_schedule(uuid, date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
