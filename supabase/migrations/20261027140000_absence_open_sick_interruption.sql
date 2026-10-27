-- Absences, product owner review (D-025):
--   * Sick leave is reported with its first day only and stays open (no end
--     date) until the worker (or a manager) closes it; a second sick leave
--     cannot be opened while one is open.
--   * An approved absence that has started can be interrupted: the worker
--     asks with the last day of absence, the head of production approves or
--     rejects (same rules as other requests).
-- Open sick leave counts days up to today (or the end of a viewed range).

alter table public.absences
  alter column end_date drop not null,
  add constraint absences_open_only_sick check (end_date is not null or kind = 'sick'),
  add column interruption_end_date date,
  add column interruption_status text
    check (interruption_status in ('requested', 'approved', 'rejected')),
  add column interruption_note text
    check (interruption_note is null or length(btrim(interruption_note)) between 1 and 500),
  add column interruption_requested_by uuid,
  add column interruption_requested_at timestamptz,
  add column interruption_decided_by uuid,
  add column interruption_decided_at timestamptz,
  add column interruption_decision_note text
    check (interruption_decision_note is null
      or length(btrim(interruption_decision_note)) between 1 and 500),
  add constraint absences_interruption_check
    check ((interruption_status is null) = (interruption_end_date is null));

create index absences_open_sick_idx on public.absences (organization_id, employee_id)
  where kind = 'sick' and end_date is null and status in ('requested', 'approved');
create index absences_interruption_idx on public.absences (organization_id, interruption_requested_at)
  where interruption_status = 'requested';

-- ---------------------------------------------------------------------------
-- Requests: sick leave without an end
-- ---------------------------------------------------------------------------
create or replace function private.validate_absence(p_kind text, p_start date, p_end date, p_note text, p_reason text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_kind not in ('vacation', 'sick', 'paid_leave', 'unpaid_leave', 'day_off') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_start is null or (p_end is null and p_kind <> 'sick')
    or p_end < p_start or p_end - p_start > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if length(btrim(p_note)) > 500 or length(btrim(p_reason)) > 500 then
    raise exception 'notes too long' using errcode = '22023';
  end if;
end;
$$;

create function private.open_sick_leave(p_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.absences a
  where a.employee_id = p_employee_id and a.kind = 'sick' and a.end_date is null
    and a.status in ('requested', 'approved')
  limit 1
$$;

create or replace function public.request_absence(
  p_org_id uuid,
  p_kind text,
  p_start date,
  p_end date,
  p_note text,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid := private.current_employee(p_org_id);
  v_id uuid;
begin
  if v_employee is null then
    raise exception 'not_an_employee' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select a.id into v_id from public.absences a
  where a.organization_id = p_org_id and a.idempotency_key = p_idempotency_key;
  if v_id is not null then
    return v_id;
  end if;
  perform private.validate_absence(p_kind, p_start, p_end, p_note, p_reason);
  if p_kind = 'sick' and private.open_sick_leave(v_employee) is not null then
    raise exception 'sick_leave_open' using errcode = '55000';
  end if;
  return private.insert_absence(p_org_id, v_employee, p_kind, p_start, p_end, 'requested',
    p_note, p_reason, p_idempotency_key);
end;
$$;

create or replace function public.enter_absence(
  p_org_id uuid,
  p_employee_id uuid,
  p_kind text,
  p_start date,
  p_end date,
  p_note text,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_permission(p_org_id, 'absences.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.employees e where e.id = p_employee_id and e.organization_id = p_org_id
  ) then
    raise exception 'employee not found' using errcode = '23503';
  end if;
  if p_idempotency_key is not null then
    select a.id into v_id from public.absences a
    where a.organization_id = p_org_id and a.idempotency_key = p_idempotency_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  perform private.validate_absence(p_kind, p_start, p_end, p_note, p_reason);
  if p_kind = 'sick' and p_end is null and private.open_sick_leave(p_employee_id) is not null then
    raise exception 'sick_leave_open' using errcode = '55000';
  end if;
  return private.insert_absence(p_org_id, p_employee_id, p_kind, p_start, p_end,
    case when private.can_decide(p_org_id, p_employee_id, null, 'absences.manage')
      then 'approved' else 'requested' end,
    p_note, p_reason, p_idempotency_key);
end;
$$;

-- The worker (or a manager) closes an open sick leave with its last day.
create function public.close_sick_leave(p_absence_id uuid, p_last_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.absences;
  v_today date;
begin
  select * into v_row from public.absences a where a.id = p_absence_id for update;
  if v_row.id is null
    or not (private.is_own_employee(v_row.employee_id)
      or private.has_permission(v_row.organization_id, 'absences.manage')) then
    raise exception 'absence not found' using errcode = 'P0002';
  end if;
  if v_row.kind <> 'sick' or v_row.end_date is not null
    or v_row.status not in ('requested', 'approved') then
    raise exception 'sick_leave_not_open' using errcode = '55000';
  end if;
  select (now() at time zone o.timezone)::date into v_today
  from public.organizations o where o.id = v_row.organization_id;
  if p_last_day is null or p_last_day < v_row.start_date or p_last_day > v_today then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  update public.absences set end_date = p_last_day where id = p_absence_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Interrupting an approved absence that has started
-- ---------------------------------------------------------------------------
create function public.request_absence_interruption(
  p_absence_id uuid,
  p_last_day date,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.absences;
  v_today date;
begin
  select * into v_row from public.absences a where a.id = p_absence_id for update;
  if v_row.id is null or not private.is_own_employee(v_row.employee_id) then
    raise exception 'absence not found' using errcode = 'P0002';
  end if;
  select (now() at time zone o.timezone)::date into v_today
  from public.organizations o where o.id = v_row.organization_id;
  if v_row.status <> 'approved' or v_row.kind = 'sick' or v_row.end_date is null
    or v_row.start_date > v_today or v_row.end_date < v_today then
    raise exception 'absence_not_running' using errcode = '55000';
  end if;
  if v_row.interruption_status = 'requested' then
    raise exception 'interruption_pending' using errcode = '55000';
  end if;
  if p_last_day is null or p_last_day < v_row.start_date or p_last_day >= v_row.end_date then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if length(btrim(p_note)) > 500 then
    raise exception 'notes too long' using errcode = '22023';
  end if;
  update public.absences set
    interruption_end_date = p_last_day,
    interruption_status = 'requested',
    interruption_note = nullif(btrim(p_note), ''),
    interruption_requested_by = auth.uid(),
    interruption_requested_at = now(),
    interruption_decided_by = null,
    interruption_decided_at = null,
    interruption_decision_note = null
  where id = p_absence_id;
end;
$$;

create function public.decide_absence_interruption(
  p_absence_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.absences;
begin
  select * into v_row from public.absences a where a.id = p_absence_id for update;
  if v_row.id is null or not private.has_permission(v_row.organization_id, 'absences.read') then
    raise exception 'absence not found' using errcode = 'P0002';
  end if;
  if not private.can_decide(v_row.organization_id, v_row.employee_id,
      v_row.interruption_requested_by, 'absences.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_row.interruption_status is distinct from 'requested' then
    raise exception 'already_decided' using errcode = '55000';
  end if;
  if not p_approve and nullif(btrim(p_note), '') is null then
    raise exception 'reject_note_required' using errcode = '22023';
  end if;
  update public.absences set
    end_date = case when p_approve then interruption_end_date else end_date end,
    interruption_status = case when p_approve then 'approved' else 'rejected' end,
    interruption_decided_by = auth.uid(),
    interruption_decided_at = now(),
    interruption_decision_note = nullif(btrim(p_note), '')
  where id = p_absence_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads (same as 20261027120000 / 20261027130000 plus open sick leave and
-- interruptions)
-- ---------------------------------------------------------------------------
create or replace function public.pending_requests(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'absences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'employee_id', e.id, 'employee_name', e.first_name || ' ' || e.last_name,
        'kind', a.kind, 'start_date', a.start_date, 'end_date', a.end_date,
        'working_days', private.working_days(a.start_date,
          coalesce(a.end_date, greatest(a.start_date, (now() at time zone o.timezone)::date))),
        'note', a.note, 'requested_at', a.requested_at,
        'has_document', exists (
          select 1 from public.absence_details d
          where d.absence_id = a.id and d.document_path is not null
        )
      ) order by a.requested_at)
      from public.absences a
      join public.employees e on e.id = a.employee_id
      join public.organizations o on o.id = a.organization_id
      where a.organization_id = p_org_id and a.status = 'requested'
        and private.can_decide(p_org_id, a.employee_id, a.requested_by, 'absences.manage')
    ), '[]'::jsonb),
    'interruptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'employee_id', e.id, 'employee_name', e.first_name || ' ' || e.last_name,
        'kind', a.kind, 'start_date', a.start_date, 'end_date', a.end_date,
        'last_day', a.interruption_end_date, 'note', a.interruption_note,
        'requested_at', a.interruption_requested_at
      ) order by a.interruption_requested_at)
      from public.absences a
      join public.employees e on e.id = a.employee_id
      where a.organization_id = p_org_id and a.interruption_status = 'requested'
        and private.can_decide(p_org_id, a.employee_id, a.interruption_requested_by,
          'absences.manage')
    ), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'employee_id', e.id, 'employee_name', e.first_name || ' ' || e.last_name,
        'session_id', c.session_id, 'clock_in_at', c.clock_in_at, 'clock_out_at', c.clock_out_at,
        'original_in', s.clock_in_at, 'original_out', s.clock_out_at,
        'reason', c.reason, 'requested_at', c.requested_at
      ) order by c.requested_at)
      from public.attendance_corrections c
      join public.employees e on e.id = c.employee_id
      left join public.attendance_sessions s on s.id = c.session_id
      where c.organization_id = p_org_id and c.status = 'requested'
        and private.can_decide(p_org_id, c.employee_id, c.requested_by, 'attendance.manage')
    ), '[]'::jsonb)
  )
$$;

create or replace function public.my_requests(p_org_id uuid, p_year integer)
returns jsonb
language plpgsql
stable
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
  select (now() at time zone o.timezone)::date into v_today
  from public.organizations o where o.id = p_org_id;
  return jsonb_build_object(
    'absences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'start_date', a.start_date, 'end_date', a.end_date,
        'status', a.status, 'note', a.note, 'decision_note', a.decision_note,
        'working_days', private.working_days(a.start_date,
          coalesce(a.end_date, greatest(a.start_date, v_today))),
        'requested_at', a.requested_at,
        'has_document', d.document_path is not null,
        'interruption_status', a.interruption_status,
        'interruption_end_date', a.interruption_end_date,
        'interruption_decision_note', a.interruption_decision_note
      ) order by a.start_date desc)
      from public.absences a
      left join public.absence_details d on d.absence_id = a.id
      where a.employee_id = v_employee
        and (a.end_date is null or a.end_date >= make_date(p_year, 1, 1)
          or a.status = 'requested')
    ), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'session_id', c.session_id, 'clock_in_at', c.clock_in_at,
        'clock_out_at', c.clock_out_at, 'reason', c.reason, 'status', c.status,
        'decision_note', c.decision_note, 'requested_at', c.requested_at
      ) order by c.requested_at desc)
      from public.attendance_corrections c
      where c.employee_id = v_employee and c.requested_at > now() - interval '120 days'
    ), '[]'::jsonb),
    'leave', private.leave_data(v_employee, p_year)
  );
end;
$$;

create or replace function public.absences_range(p_org_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (private.has_permission(p_org_id, 'absences.read')
      or private.has_permission(p_org_id, 'attendance.read')) then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'employee_id', e.id, 'employee_name', e.first_name || ' ' || e.last_name,
        'kind', a.kind, 'start_date', a.start_date, 'end_date', a.end_date, 'status', a.status,
        'working_days', private.working_days(a.start_date,
          coalesce(a.end_date, greatest(a.start_date, least(p_to, (now() at time zone o.timezone)::date)))),
        'note', a.note, 'decision_note', a.decision_note, 'requested_at', a.requested_at,
        'reason', case when private.has_permission(p_org_id, 'absences.sensitive.read')
          then d.reason end,
        'has_document', d.document_path is not null
      ) order by a.start_date, e.last_name)
      from public.absences a
      join public.employees e on e.id = a.employee_id
      join public.organizations o on o.id = a.organization_id
      left join public.absence_details d on d.absence_id = a.id
      where a.organization_id = p_org_id
        and a.start_date <= p_to and (a.end_date is null or a.end_date >= p_from)
        and a.status in ('requested', 'approved')
    ), '[]'::jsonb)
  end
$$;

create or replace function public.attendance_board(p_org_id uuid, p_date date)
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
        'absence', (
          select a.kind from public.absences a
          where a.employee_id = e.id and a.status = 'approved'
            and p_date >= a.start_date and (a.end_date is null or p_date <= a.end_date)
          limit 1
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
  revoke execute on function private.open_sick_leave(uuid) from public;
  foreach v_fn in array array[
    'public.close_sick_leave(uuid, date)',
    'public.request_absence_interruption(uuid, date, text)',
    'public.decide_absence_interruption(uuid, boolean, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
