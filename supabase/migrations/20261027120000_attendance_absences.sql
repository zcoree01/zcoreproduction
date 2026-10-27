-- Shifts and working time, part B2: absences, leave and corrections (D-024).
--   * New system role hr ("Kadrovska") for every organization.
--   * absences: vacation, sick leave, paid / unpaid leave, day off; requested
--     by the worker on the phone or entered by a manager; no overlapping
--     open absences per employee. Sensitive details (sick-leave reason and
--     the photo of the sick note) live in absence_details, readable only by
--     the employee, the director and HR (absences.sensitive.read).
--   * Leave balance: rules in attendance_settings (base days, extra days per
--     N years of service, maximum, first months with one day per month),
--     hire date and earlier service in employee_work_info, carry-over and an
--     optional override per year in employee_leave_years. The entitlement is
--     computed in TypeScript (src/modules/attendance/leave-rules.ts).
--   * attendance_corrections: a worker asks to fix or add a clock-in /
--     clock-out; the foreman / head of production approves. Requests of
--     managers (and a manager's own) need admin / director
--     (attendance.approve.managers). Approving archives the original session
--     and records a new one: the original stays.
-- Working days of an absence = Monday–Friday (holidays come with part C).

-- ---------------------------------------------------------------------------
-- Role "Kadrovska" and permissions
-- ---------------------------------------------------------------------------
create or replace function private.bootstrap_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.roles (organization_id, key, name, is_system) values
    (new.id, 'admin', 'Administrator', true),
    (new.id, 'director', 'Direktor', true),
    (new.id, 'head_of_production', 'Šef proizvodnje', true),
    (new.id, 'warehouse', 'Skladištar', true),
    (new.id, 'operator', 'Operater', true),
    (new.id, 'quality_inspector', 'Kontrolor', true),
    (new.id, 'hr', 'Kadrovska', true);

  insert into public.role_permissions (organization_id, role_id, permission_key)
  select new.id, r.id, p.key
  from public.roles r
  join public.permissions p on r.key = any (p.default_roles)
  where r.organization_id = new.id;

  insert into public.org_modules (organization_id, module_key, enabled, enabled_at)
  values (new.id, 'core', true, now());

  return null;
end;
$$;

insert into public.roles (organization_id, key, name, is_system)
select o.id, 'hr', 'Kadrovska', true
from public.organizations o
on conflict (organization_id, key) do nothing;

insert into public.permissions (key, module_key, description, default_roles) values
  ('absences.read', 'attendance', 'View absences and leave balances of all employees',
    '{admin,director,head_of_production,hr}'),
  ('absences.manage', 'attendance', 'Enter absences, decide leave requests, set leave data',
    '{admin,director,head_of_production,hr}'),
  ('absences.sensitive.read', 'attendance',
    'See sick-leave reasons and documents of other employees', '{director,hr}'),
  ('attendance.approve.managers', 'attendance',
    'Decide requests of managers (their own leave and attendance corrections)',
    '{admin,director}');

-- HR reads attendance and employees like the managers do.
update public.permissions
set default_roles = array_append(default_roles, 'hr')
where key in ('attendance.read', 'employees.read')
  and not ('hr' = any (default_roles));

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system
  and (p.key in ('absences.read', 'absences.manage', 'absences.sensitive.read',
      'attendance.approve.managers')
    or r.key = 'hr')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Leave rules and employee data
-- ---------------------------------------------------------------------------
alter table public.attendance_settings
  add column leave_base_days integer not null default 20 check (leave_base_days between 0 and 60),
  add column leave_extra_days integer not null default 1 check (leave_extra_days between 0 and 10),
  -- Every this many full years of service adds leave_extra_days (0 = never).
  add column leave_extra_every_years integer not null default 5
    check (leave_extra_every_years between 0 and 50),
  add column leave_max_days integer not null default 30 check (leave_max_days between 0 and 60),
  -- Before this many months of work: one day per full month worked.
  add column leave_probation_months integer not null default 6
    check (leave_probation_months between 0 and 24);

grant update (leave_base_days, leave_extra_days, leave_extra_every_years, leave_max_days,
  leave_probation_months) on public.attendance_settings to authenticated;

create table public.employee_work_info (
  employee_id uuid primary key,
  organization_id uuid not null,
  hired_on date,
  -- Service before this company (counts for extra leave days).
  prior_service_months integer not null default 0 check (prior_service_months between 0 and 720),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_id),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict
);

create table public.employee_leave_years (
  organization_id uuid not null,
  employee_id uuid not null,
  year integer not null check (year between 2000 and 2100),
  carried_over_days numeric(5, 1) not null default 0 check (carried_over_days between 0 and 100),
  -- Replaces the computed entitlement when set.
  entitlement_override numeric(5, 1) check (entitlement_override between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (employee_id, year),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict
);

create trigger employee_work_info_updated_at before update on public.employee_work_info
  for each row execute function private.set_updated_at();
create trigger employee_work_info_audit after insert or update on public.employee_work_info
  for each row execute function private.audit_row_change();
create trigger employee_leave_years_updated_at before update on public.employee_leave_years
  for each row execute function private.set_updated_at();

-- audit_row_change uses the id column; these tables are keyed by employee.
create function private.audit_leave_year()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (new.organization_id, auth.uid(), 'employee_leave_years.' || lower(tg_op),
    'employee_leave_years', new.employee_id || ':' || new.year,
    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return null;
end;
$$;

create trigger employee_leave_years_audit after insert or update on public.employee_leave_years
  for each row execute function private.audit_leave_year();

-- ---------------------------------------------------------------------------
-- Absences
-- ---------------------------------------------------------------------------
create table public.absences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  kind text not null check (kind in ('vacation', 'sick', 'paid_leave', 'unpaid_leave', 'day_off')),
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('requested', 'approved', 'rejected', 'cancelled')),
  -- Visible to managers (not sensitive).
  note text check (note is null or length(btrim(note)) between 1 and 500),
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 1 and 500),
  idempotency_key uuid,
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  constraint absences_period_check check (end_date >= start_date and end_date - start_date <= 366),
  constraint absences_no_overlap exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('requested', 'approved')),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict
);

comment on table public.absences is
  'Absences (vacation, sick leave, paid / unpaid leave, day off); rejected and cancelled ones stay as history.';

create index absences_employee_idx on public.absences (organization_id, employee_id, start_date);
create index absences_period_idx on public.absences (organization_id, start_date, end_date);
create index absences_requested_idx on public.absences (organization_id, requested_at)
  where status = 'requested';

create table public.absence_details (
  absence_id uuid primary key,
  organization_id uuid not null,
  -- Sick-leave reason / diagnosis note: sensitive.
  reason text check (reason is null or length(btrim(reason)) between 1 and 500),
  document_path text check (document_path is null or document_path like organization_id::text || '/%'),
  document_name text check (document_name is null or length(document_name) between 1 and 200),
  document_type text,
  document_size bigint check (document_size is null or document_size > 0),
  foreign key (organization_id, absence_id)
    references public.absences (organization_id, id) on delete restrict
);

create trigger absences_audit after insert or update on public.absences
  for each row execute function private.audit_row_change();

-- Details are audited without their content (only that they changed).
create function private.audit_absence_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (new.organization_id, auth.uid(), 'absence_details.' || lower(tg_op), 'absences',
    new.absence_id::text, null,
    jsonb_build_object('reason_set', new.reason is not null, 'document_set', new.document_path is not null));
  return null;
end;
$$;

create trigger absence_details_audit after insert or update on public.absence_details
  for each row execute function private.audit_absence_details();

-- ---------------------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------------------
create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  -- The session to fix; null = a missing clock-in / clock-out is added.
  session_id uuid,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  status text not null check (status in ('requested', 'approved', 'rejected', 'cancelled')),
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 1 and 500),
  -- The session recorded on approval.
  new_session_id uuid,
  idempotency_key uuid,
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  constraint attendance_corrections_period_check
    check (clock_out_at > clock_in_at and clock_out_at - clock_in_at <= interval '24 hours'),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  foreign key (organization_id, session_id)
    references public.attendance_sessions (organization_id, id) on delete restrict,
  foreign key (organization_id, new_session_id)
    references public.attendance_sessions (organization_id, id) on delete restrict
);

create index attendance_corrections_employee_idx
  on public.attendance_corrections (organization_id, employee_id, requested_at desc);
create index attendance_corrections_requested_idx
  on public.attendance_corrections (organization_id, requested_at) where status = 'requested';

create trigger attendance_corrections_audit after insert or update on public.attendance_corrections
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
revoke all on public.employee_work_info, public.employee_leave_years, public.absences,
  public.absence_details, public.attendance_corrections from anon, authenticated;
grant select on public.employee_work_info, public.employee_leave_years, public.absences,
  public.absence_details, public.attendance_corrections to authenticated;

alter table public.employee_work_info enable row level security;
alter table public.employee_leave_years enable row level security;
alter table public.absences enable row level security;
alter table public.absence_details enable row level security;
alter table public.attendance_corrections enable row level security;

create policy employee_work_info_select on public.employee_work_info
  for select to authenticated
  using (private.has_permission(organization_id, 'absences.read')
    or (organization_id in (select private.user_org_ids()) and private.is_own_employee(employee_id)));
create policy employee_leave_years_select on public.employee_leave_years
  for select to authenticated
  using (private.has_permission(organization_id, 'absences.read')
    or (organization_id in (select private.user_org_ids()) and private.is_own_employee(employee_id)));
create policy absences_select on public.absences
  for select to authenticated
  using (private.has_permission(organization_id, 'absences.read')
    or private.has_permission(organization_id, 'attendance.read')
    or (organization_id in (select private.user_org_ids()) and private.is_own_employee(employee_id)));
create policy absence_details_select on public.absence_details
  for select to authenticated
  using (private.has_permission(organization_id, 'absences.sensitive.read')
    or (organization_id in (select private.user_org_ids()) and exists (
      select 1 from public.absences a
      where a.id = absence_id and private.is_own_employee(a.employee_id)
    )));
create policy attendance_corrections_select on public.attendance_corrections
  for select to authenticated
  using (private.has_permission(organization_id, 'attendance.read')
    or (organization_id in (select private.user_org_ids()) and private.is_own_employee(employee_id)));

-- ---------------------------------------------------------------------------
-- Storage: private bucket for sick notes (<organization>/<absence>/<file>)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'absence-documents', 'absence-documents', false, 10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create function private.storage_absence_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 2)::uuid
  end
$$;

-- Upload: the absence's own employee (open absence) or absences.manage.
create function private.can_upload_absence_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.absences a
    where a.id = private.storage_absence_id(p_name)
      and a.organization_id = private.storage_org_id(p_name)
      and a.status in ('requested', 'approved')
      and (private.is_own_employee(a.employee_id)
        or private.has_permission(a.organization_id, 'absences.manage'))
  )
$$;

-- Read: the own employee or absences.sensitive.read.
create function private.can_read_absence_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.absences a
    where a.id = private.storage_absence_id(p_name)
      and a.organization_id = private.storage_org_id(p_name)
      and (private.is_own_employee(a.employee_id)
        or private.has_permission(a.organization_id, 'absences.sensitive.read'))
  )
$$;

create policy absence_documents_select on storage.objects
  for select to authenticated
  using (bucket_id = 'absence-documents' and private.can_read_absence_file(name));
create policy absence_documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'absence-documents' and private.can_upload_absence_file(name));

-- ---------------------------------------------------------------------------
-- Rules shared by the decisions
-- ---------------------------------------------------------------------------
-- Monday–Friday days in [p_from, p_to].
create function private.working_days(p_from date, p_to date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
  from generate_series(p_from, p_to, interval '1 day') as d (day)
  where extract(isodow from d.day) < 6
$$;

-- Is this user a manager of attendance / absences (their requests need
-- attendance.approve.managers)?
create function private.is_attendance_manager(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and (
    private.user_has_permission(p_org_id, p_user_id, 'attendance.manage')
    or private.user_has_permission(p_org_id, p_user_id, 'absences.manage')
  )
$$;

-- The caller may decide a request about p_employee_id made by p_requested_by
-- when they hold p_permission, are neither the employee nor the requester,
-- and hold attendance.approve.managers when the employee or the requester is
-- a manager.
create function private.can_decide(
  p_org_id uuid,
  p_employee_id uuid,
  p_requested_by uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_org_id, p_permission)
    and not private.is_own_employee(p_employee_id)
    and (p_requested_by is null or p_requested_by <> (select auth.uid()))
    and (
      not (
        private.is_attendance_manager(p_org_id, p_requested_by)
        or private.is_attendance_manager(p_org_id,
          (select e.user_id from public.employees e where e.id = p_employee_id))
      )
      or private.has_permission(p_org_id, 'attendance.approve.managers')
    )
$$;

-- ---------------------------------------------------------------------------
-- Absences: requests and entries
-- ---------------------------------------------------------------------------
create function private.validate_absence(p_kind text, p_start date, p_end date, p_note text, p_reason text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_kind not in ('vacation', 'sick', 'paid_leave', 'unpaid_leave', 'day_off') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if length(btrim(p_note)) > 500 or length(btrim(p_reason)) > 500 then
    raise exception 'notes too long' using errcode = '22023';
  end if;
end;
$$;

create function private.insert_absence(
  p_org_id uuid,
  p_employee_id uuid,
  p_kind text,
  p_start date,
  p_end date,
  p_status text,
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
  begin
    insert into public.absences (
      organization_id, employee_id, kind, start_date, end_date, status, note,
      decided_by, decided_at, idempotency_key
    ) values (
      p_org_id, p_employee_id, p_kind, p_start, p_end, p_status, nullif(btrim(p_note), ''),
      case when p_status = 'approved' then auth.uid() end,
      case when p_status = 'approved' then now() end,
      p_idempotency_key
    )
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'absence_overlaps' using errcode = '23P01';
  end;
  if nullif(btrim(p_reason), '') is not null then
    insert into public.absence_details (absence_id, organization_id, reason)
    values (v_id, p_org_id, btrim(p_reason));
  end if;
  return v_id;
end;
$$;

-- The caller asks for an absence for themselves (sick leave can be reported
-- for today / the past). p_reason is the sensitive part (sick leave).
create function public.request_absence(
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
  return private.insert_absence(p_org_id, v_employee, p_kind, p_start, p_end, 'requested',
    p_note, p_reason, p_idempotency_key);
end;
$$;

-- A manager enters an absence: approved at once for other employees, a
-- request for themselves.
create function public.enter_absence(
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
  return private.insert_absence(p_org_id, p_employee_id, p_kind, p_start, p_end,
    case when private.can_decide(p_org_id, p_employee_id, null, 'absences.manage')
      then 'approved' else 'requested' end,
    p_note, p_reason, p_idempotency_key);
end;
$$;

create function public.decide_absence(p_absence_id uuid, p_approve boolean, p_note text default null)
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
  if not private.can_decide(v_row.organization_id, v_row.employee_id, v_row.requested_by,
      'absences.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'already_decided' using errcode = '55000';
  end if;
  if not p_approve and nullif(btrim(p_note), '') is null then
    raise exception 'reject_note_required' using errcode = '22023';
  end if;
  update public.absences set
    status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(),
    decided_at = now(),
    decision_note = nullif(btrim(p_note), '')
  where id = p_absence_id;
end;
$$;

-- The employee withdraws a request; a manager cancels an approved absence.
create function public.cancel_absence(p_absence_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.absences;
begin
  select * into v_row from public.absences a where a.id = p_absence_id for update;
  if v_row.id is null then
    raise exception 'absence not found' using errcode = 'P0002';
  end if;
  if v_row.status = 'requested' and private.is_own_employee(v_row.employee_id) then
    null;
  elsif v_row.status in ('requested', 'approved')
    and private.has_permission(v_row.organization_id, 'absences.manage') then
    null;
  else
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.absences set
    status = 'cancelled',
    decided_by = auth.uid(),
    decided_at = now(),
    decision_note = coalesce(nullif(btrim(p_note), ''), decision_note)
  where id = p_absence_id;
end;
$$;

-- Records the uploaded sick note (the server action checked the file in
-- Storage); the path must belong to the absence.
create function public.attach_absence_document(
  p_absence_id uuid,
  p_path text,
  p_name text,
  p_type text,
  p_size bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.absences;
begin
  select * into v_row from public.absences a where a.id = p_absence_id;
  if v_row.id is null or not private.can_upload_absence_file(
      v_row.organization_id || '/' || v_row.id || '/x') then
    raise exception 'absence not found' using errcode = 'P0002';
  end if;
  if p_path is null or p_path not like v_row.organization_id || '/' || v_row.id || '/%' then
    raise exception 'invalid path' using errcode = '22023';
  end if;
  insert into public.absence_details (
    absence_id, organization_id, document_path, document_name, document_type, document_size
  ) values (v_row.id, v_row.organization_id, p_path, left(p_name, 200), p_type, p_size)
  on conflict (absence_id) do update set
    document_path = excluded.document_path,
    document_name = excluded.document_name,
    document_type = excluded.document_type,
    document_size = excluded.document_size;
end;
$$;

-- ---------------------------------------------------------------------------
-- Leave data (absences.manage)
-- ---------------------------------------------------------------------------
create function public.save_leave_data(
  p_employee_id uuid,
  p_year integer,
  p_hired_on date,
  p_prior_service_months integer,
  p_carried_over_days numeric,
  p_entitlement_override numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  if v_org is null or not private.has_permission(v_org, 'absences.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.employee_work_info (employee_id, organization_id, hired_on, prior_service_months)
  values (p_employee_id, v_org, p_hired_on, coalesce(p_prior_service_months, 0))
  on conflict (employee_id) do update set
    hired_on = excluded.hired_on,
    prior_service_months = excluded.prior_service_months;
  insert into public.employee_leave_years (
    organization_id, employee_id, year, carried_over_days, entitlement_override
  ) values (v_org, p_employee_id, p_year, coalesce(p_carried_over_days, 0), p_entitlement_override)
  on conflict (employee_id, year) do update set
    carried_over_days = excluded.carried_over_days,
    entitlement_override = excluded.entitlement_override;
end;
$$;

-- ---------------------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------------------
create function private.validate_correction(
  p_org_id uuid,
  p_employee_id uuid,
  p_session_id uuid,
  p_in timestamptz,
  p_out timestamptz,
  p_reason text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_in is null or p_out is null or p_out <= p_in or p_out - p_in > interval '24 hours' then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if p_out > now() + interval '5 minutes' then
    raise exception 'correction_in_future' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_session_id is not null and not exists (
    select 1 from public.attendance_sessions s
    where s.id = p_session_id and s.organization_id = p_org_id
      and s.employee_id = p_employee_id and s.archived_at is null
  ) then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Archives the original session (if any) and records the corrected one
-- with the shift recognised at the new clock-in; alerts of the original
-- session are resolved.
create function private.apply_correction(p_correction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_corrections;
  v_shift record;
  v_new uuid;
  v_tz text;
begin
  select * into v_row from public.attendance_corrections c where c.id = p_correction_id for update;
  select o.timezone into v_tz from public.organizations o where o.id = v_row.organization_id;
  if v_row.session_id is not null then
    update public.attendance_sessions set archived_at = now()
    where id = v_row.session_id and archived_at is null;
    if not found then
      raise exception 'session_changed' using errcode = '55000';
    end if;
    update public.attendance_alerts set
      resolved_at = now(), resolved_by = auth.uid(), note = coalesce(note, 'Ispravka')
    where session_id = v_row.session_id and resolved_at is null;
  end if;

  select * into v_shift from private.recognize_shift(v_row.employee_id, v_row.clock_in_at);
  begin
    insert into public.attendance_sessions (
      organization_id, employee_id, shift_id, work_date, scheduled_start, scheduled_end, breaks,
      clock_in_at, clock_out_at, clock_in_source, clock_out_source, clock_in_by, clock_out_by,
      idempotency_key
    ) values (
      v_row.organization_id, v_row.employee_id, v_shift.shift_id,
      coalesce(v_shift.work_date, (v_row.clock_in_at at time zone v_tz)::date),
      v_shift.scheduled_start, v_shift.scheduled_end, coalesce(v_shift.breaks, '[]'::jsonb),
      v_row.clock_in_at, v_row.clock_out_at, 'manual', 'manual', auth.uid(), auth.uid(),
      gen_random_uuid()
    )
    returning id into v_new;
  exception when exclusion_violation then
    raise exception 'correction_overlaps' using errcode = '23P01';
  end;
  update public.attendance_corrections set
    status = 'approved', decided_by = auth.uid(), decided_at = now(), new_session_id = v_new
  where id = p_correction_id;
  return v_new;
end;
$$;

-- The caller asks to fix (p_session_id) or add a session of their own.
create function public.request_correction(
  p_org_id uuid,
  p_session_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
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
  select c.id into v_id from public.attendance_corrections c
  where c.organization_id = p_org_id and c.idempotency_key = p_idempotency_key;
  if v_id is not null then
    return v_id;
  end if;
  perform private.validate_correction(p_org_id, v_employee, p_session_id, p_clock_in_at,
    p_clock_out_at, p_reason);
  if p_session_id is not null and exists (
    select 1 from public.attendance_corrections c
    where c.session_id = p_session_id and c.status = 'requested'
  ) then
    raise exception 'correction_pending' using errcode = '55000';
  end if;
  insert into public.attendance_corrections (
    organization_id, employee_id, session_id, clock_in_at, clock_out_at, reason, status,
    idempotency_key
  ) values (
    p_org_id, v_employee, p_session_id, p_clock_in_at, p_clock_out_at, btrim(p_reason),
    'requested', p_idempotency_key
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- A manager corrects another employee's attendance (applied at once, with
-- the reason); for their own attendance it becomes a request.
create function public.enter_correction(
  p_org_id uuid,
  p_employee_id uuid,
  p_session_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
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
  if not private.has_permission(p_org_id, 'attendance.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.employees e where e.id = p_employee_id and e.organization_id = p_org_id
  ) then
    raise exception 'employee not found' using errcode = '23503';
  end if;
  if p_idempotency_key is not null then
    select c.id into v_id from public.attendance_corrections c
    where c.organization_id = p_org_id and c.idempotency_key = p_idempotency_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  perform private.validate_correction(p_org_id, p_employee_id, p_session_id, p_clock_in_at,
    p_clock_out_at, p_reason);
  insert into public.attendance_corrections (
    organization_id, employee_id, session_id, clock_in_at, clock_out_at, reason, status,
    idempotency_key
  ) values (
    p_org_id, p_employee_id, p_session_id, p_clock_in_at, p_clock_out_at, btrim(p_reason),
    'requested', p_idempotency_key
  )
  returning id into v_id;
  if private.can_decide(p_org_id, p_employee_id, null, 'attendance.manage') then
    perform private.apply_correction(v_id);
  end if;
  return v_id;
end;
$$;

create function public.decide_correction(p_correction_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_corrections;
begin
  select * into v_row from public.attendance_corrections c where c.id = p_correction_id for update;
  if v_row.id is null or not private.has_permission(v_row.organization_id, 'attendance.read') then
    raise exception 'correction not found' using errcode = 'P0002';
  end if;
  if not private.can_decide(v_row.organization_id, v_row.employee_id, v_row.requested_by,
      'attendance.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'already_decided' using errcode = '55000';
  end if;
  if p_approve then
    perform private.apply_correction(p_correction_id);
    update public.attendance_corrections set decision_note = nullif(btrim(p_note), '')
    where id = p_correction_id;
  else
    if nullif(btrim(p_note), '') is null then
      raise exception 'reject_note_required' using errcode = '22023';
    end if;
    update public.attendance_corrections set
      status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = btrim(p_note)
    where id = p_correction_id;
  end if;
end;
$$;

create function public.cancel_correction(p_correction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.attendance_corrections set status = 'cancelled', decided_at = now(),
    decided_by = auth.uid()
  where id = p_correction_id and status = 'requested' and private.is_own_employee(employee_id);
  if not found then
    raise exception 'correction not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
-- Requests the caller may decide (for the bell and the approvals list).
create function public.pending_requests(p_org_id uuid)
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
        'working_days', private.working_days(a.start_date, a.end_date),
        'note', a.note, 'requested_at', a.requested_at,
        'has_document', exists (
          select 1 from public.absence_details d
          where d.absence_id = a.id and d.document_path is not null
        )
      ) order by a.requested_at)
      from public.absences a
      join public.employees e on e.id = a.employee_id
      where a.organization_id = p_org_id and a.status = 'requested'
        and private.can_decide(p_org_id, a.employee_id, a.requested_by, 'absences.manage')
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

-- The caller's own absences, corrections and leave data for p_year.
create function public.my_requests(p_org_id uuid, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee uuid := private.current_employee(p_org_id);
begin
  if v_employee is null then
    return null;
  end if;
  return jsonb_build_object(
    'absences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'start_date', a.start_date, 'end_date', a.end_date,
        'status', a.status, 'note', a.note, 'decision_note', a.decision_note,
        'working_days', private.working_days(a.start_date, a.end_date),
        'requested_at', a.requested_at,
        'has_document', d.document_path is not null
      ) order by a.start_date desc)
      from public.absences a
      left join public.absence_details d on d.absence_id = a.id
      where a.employee_id = v_employee
        and (extract(year from a.start_date) = p_year or extract(year from a.end_date) = p_year
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

-- Inputs of the leave balance of one employee for a year.
create function private.leave_data(p_employee_id uuid, p_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hired_on', w.hired_on,
    'prior_service_months', coalesce(w.prior_service_months, 0),
    'carried_over_days', coalesce(y.carried_over_days, 0),
    'entitlement_override', y.entitlement_override,
    'used_days', coalesce((
      select sum(private.working_days(greatest(a.start_date, make_date(p_year, 1, 1)),
        least(a.end_date, make_date(p_year, 12, 31))))
      from public.absences a
      where a.employee_id = p_employee_id and a.kind = 'vacation' and a.status = 'approved'
        and a.start_date <= make_date(p_year, 12, 31) and a.end_date >= make_date(p_year, 1, 1)
    ), 0),
    'pending_days', coalesce((
      select sum(private.working_days(greatest(a.start_date, make_date(p_year, 1, 1)),
        least(a.end_date, make_date(p_year, 12, 31))))
      from public.absences a
      where a.employee_id = p_employee_id and a.kind = 'vacation' and a.status = 'requested'
        and a.start_date <= make_date(p_year, 12, 31) and a.end_date >= make_date(p_year, 1, 1)
    ), 0),
    'rules', (
      select jsonb_build_object(
        'base_days', s.leave_base_days, 'extra_days', s.leave_extra_days,
        'extra_every_years', s.leave_extra_every_years, 'max_days', s.leave_max_days,
        'probation_months', s.leave_probation_months
      )
      from public.attendance_settings s
      join public.employees e on e.organization_id = s.organization_id
      where e.id = p_employee_id
    )
  )
  from (select 1) x
  left join public.employee_work_info w on w.employee_id = p_employee_id
  left join public.employee_leave_years y on y.employee_id = p_employee_id and y.year = p_year
$$;

-- Absences overlapping [p_from, p_to] (absences.read or attendance.read);
-- the sick-leave reason only with absences.sensitive.read.
create function public.absences_range(p_org_id uuid, p_from date, p_to date)
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
        'working_days', private.working_days(a.start_date, a.end_date),
        'note', a.note, 'decision_note', a.decision_note, 'requested_at', a.requested_at,
        'reason', case when private.has_permission(p_org_id, 'absences.sensitive.read')
          then d.reason end,
        'has_document', d.document_path is not null
      ) order by a.start_date, e.last_name)
      from public.absences a
      join public.employees e on e.id = a.employee_id
      left join public.absence_details d on d.absence_id = a.id
      where a.organization_id = p_org_id
        and a.start_date <= p_to and a.end_date >= p_from
        and a.status in ('requested', 'approved')
    ), '[]'::jsonb)
  end
$$;

-- Leave balances of every active employee for p_year (absences.read).
create function public.leave_overview(p_org_id uuid, p_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.has_permission(p_org_id, 'absences.read') then null else
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'number', e.employee_number, 'name', e.first_name || ' ' || e.last_name,
        'leave', private.leave_data(e.id, p_year)
      ) order by e.last_name, e.first_name)
      from public.employees e
      where e.organization_id = p_org_id and e.status = 'active' and e.archived_at is null
    ), '[]'::jsonb)
  end
$$;

-- Same as 20261026140000 plus each employee's approved absence on the date.
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
            and p_date between a.start_date and a.end_date
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
  foreach v_fn in array array[
    'private.audit_leave_year()',
    'private.audit_absence_details()',
    'private.working_days(date, date)',
    'private.is_attendance_manager(uuid, uuid)',
    'private.can_decide(uuid, uuid, uuid, text)',
    'private.validate_absence(text, date, date, text, text)',
    'private.insert_absence(uuid, uuid, text, date, date, text, text, text, uuid)',
    'private.validate_correction(uuid, uuid, uuid, timestamptz, timestamptz, text)',
    'private.apply_correction(uuid)',
    'private.leave_data(uuid, integer)',
    'private.storage_absence_id(text)',
    'private.can_upload_absence_file(text)',
    'private.can_read_absence_file(text)'
  ] loop
    execute format('revoke execute on function %s from public', v_fn);
  end loop;
  -- Storage policies run as the caller.
  grant execute on function private.storage_absence_id(text) to authenticated;
  grant execute on function private.can_upload_absence_file(text) to authenticated;
  grant execute on function private.can_read_absence_file(text) to authenticated;

  foreach v_fn in array array[
    'public.request_absence(uuid, text, date, date, text, text, uuid)',
    'public.enter_absence(uuid, uuid, text, date, date, text, text, uuid)',
    'public.decide_absence(uuid, boolean, text)',
    'public.cancel_absence(uuid, text)',
    'public.attach_absence_document(uuid, text, text, text, bigint)',
    'public.save_leave_data(uuid, integer, date, integer, numeric, numeric)',
    'public.request_correction(uuid, uuid, timestamptz, timestamptz, text, uuid)',
    'public.enter_correction(uuid, uuid, uuid, timestamptz, timestamptz, text, uuid)',
    'public.decide_correction(uuid, boolean, text)',
    'public.cancel_correction(uuid)',
    'public.pending_requests(uuid)',
    'public.my_requests(uuid, integer)',
    'public.absences_range(uuid, date, date)',
    'public.leave_overview(uuid, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
