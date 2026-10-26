-- Tool changes, downtime entered with a duration, and the foreman's day
-- overview (D-020).
--   * production_tool_changes: which tool / insert was changed, on which
--     machine and operation, why (configurable reasons), optional duration;
--     the tool is free text until the tool store exists.
--   * production_downtime_events can also be entered after the fact with a
--     duration (source 'entry'), not only by pausing (source 'pause');
--     idempotency key against double submissions.
--   * production_day: reports, downtime, open work and tool changes of a
--     period for the foreman's screen (orders.read).
-- Recording: the worker who sees the operation (floor) or orders.manage.

-- ---------------------------------------------------------------------------
-- Reasons for tool changes (catalog)
-- ---------------------------------------------------------------------------
alter table public.catalog_items drop constraint catalog_items_kind_check;
alter table public.catalog_items add constraint catalog_items_kind_check
  check (kind in (
    'machine_type', 'location', 'department', 'job_title', 'skill',
    'product_type', 'material_shape', 'downtime_reason', 'scrap_reason', 'tool_change_reason'
  ));

create or replace function private.catalog_manage_permission(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('machine_type', 'location') then 'machines.manage'
    when p_kind in ('department', 'job_title', 'skill') then 'employees.manage'
    when p_kind in ('product_type', 'material_shape') then 'products.manage'
    when p_kind in ('downtime_reason', 'scrap_reason', 'tool_change_reason') then 'orders.manage'
  end
$$;

create or replace function private.seed_default_reasons(p_org_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.catalog_items (organization_id, kind, name)
  select p_org_id, v.kind, v.name
  from (values
    ('downtime_reason', 'Kvar mašine'),
    ('downtime_reason', 'Izmjena alata / pločice'),
    ('downtime_reason', 'Čeka materijal'),
    ('downtime_reason', 'Podešavanje'),
    ('downtime_reason', 'Čeka uputstva'),
    ('downtime_reason', 'Problem s kvalitetom'),
    ('downtime_reason', 'Pauza'),
    ('downtime_reason', 'Kraj smjene'),
    ('downtime_reason', 'Ostalo'),
    ('scrap_reason', 'Greška u mjeri'),
    ('scrap_reason', 'Oštećenje'),
    ('scrap_reason', 'Greška materijala'),
    ('scrap_reason', 'Greška podešavanja'),
    ('scrap_reason', 'Ostalo'),
    ('tool_change_reason', 'Istrošen'),
    ('tool_change_reason', 'Lom'),
    ('tool_change_reason', 'Promjena programa'),
    ('tool_change_reason', 'Ostalo')
  ) as v (kind, name)
  where not exists (
    select 1 from public.catalog_items c
    where c.organization_id = p_org_id and c.kind = v.kind
  )
$$;

select private.seed_default_reasons(o.id) from public.organizations o;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
alter table public.production_downtime_events
  add column source text not null default 'pause' check (source in ('pause', 'entry')),
  add column idempotency_key uuid;

create unique index production_downtime_events_idempotency_key
  on public.production_downtime_events (organization_id, idempotency_key)
  where idempotency_key is not null;

create table public.production_tool_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  operation_id uuid not null,
  machine_id uuid,
  employee_id uuid,
  -- Free text until the tool store exists (e.g. "Nož VBMT 160404").
  tool text not null check (length(btrim(tool)) between 1 and 200),
  insert_name text check (insert_name is null or length(btrim(insert_name)) between 1 and 200),
  reason_id uuid not null,
  reason_kind text generated always as ('tool_change_reason') stored,
  duration_min numeric(8, 2) check (duration_min > 0 and duration_min <= 1440),
  notes text check (notes is null or length(btrim(notes)) between 1 and 500),
  changed_at timestamptz not null default now(),
  reported_by uuid default auth.uid(),
  idempotency_key uuid not null,
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, operation_id)
    references public.production_order_operations (organization_id, id) on delete restrict,
  foreign key (organization_id, machine_id)
    references public.machines (organization_id, id) on delete restrict,
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  foreign key (organization_id, reason_kind, reason_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict
);

comment on table public.production_tool_changes is
  'Tool / insert changes on an operation and machine (tool as text until the tool store exists).';

create index production_tool_changes_order_idx on public.production_tool_changes (organization_id, order_id);
create index production_tool_changes_operation_idx
  on public.production_tool_changes (organization_id, operation_id);
create index production_tool_changes_machine_idx
  on public.production_tool_changes (organization_id, machine_id, changed_at);
create index production_tool_changes_employee_idx
  on public.production_tool_changes (organization_id, employee_id);
create index production_tool_changes_reason_idx
  on public.production_tool_changes (organization_id, reason_kind, reason_id);

create trigger production_tool_changes_audit after insert on public.production_tool_changes
  for each row execute function private.audit_row_change();

revoke all on public.production_tool_changes from anon, authenticated;
grant select on public.production_tool_changes to authenticated;
alter table public.production_tool_changes enable row level security;
create policy production_tool_changes_select on public.production_tool_changes
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));

-- ---------------------------------------------------------------------------
-- Who may record on an operation: a manager, or the worker who sees it.
-- Returns the caller's employee (null for a manager without one).
-- ---------------------------------------------------------------------------
create function private.record_access(p_operation_id uuid, p_tool_change boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_type public.operation_types;
  v_order_status text;
  v_employee uuid;
begin
  select * into v_op from public.production_order_operations o
  where o.id = p_operation_id and o.archived_at is null;
  if v_op.id is null
    or not exists (select 1 from private.user_org_ids() as x (id) where x.id = v_op.organization_id) then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  select * into v_type from public.operation_types t where t.id = v_op.operation_type_id;
  select r.status into v_order_status from public.production_orders r where r.id = v_op.order_id;

  if v_type.is_external then
    raise exception 'operation_external' using errcode = '22023';
  end if;
  if p_tool_change and v_type.is_inspection then
    raise exception 'inspection_has_no_tools' using errcode = '22023';
  end if;
  if v_order_status in ('draft', 'completed', 'cancelled', 'archived') then
    raise exception 'order_closed' using errcode = '55000';
  end if;

  v_employee := private.current_employee(v_op.organization_id);
  if private.has_permission(v_op.organization_id, 'orders.manage') then
    return v_employee;
  end if;
  if v_employee is null then
    raise exception 'not_an_employee' using errcode = '42501';
  end if;
  if not private.employee_sees_operation(v_employee, v_op.id, v_op.machine_id) then
    raise exception 'operation not assigned to the caller' using errcode = '42501';
  end if;
  if v_op.status = 'done' then
    raise exception 'operation_done' using errcode = '55000';
  end if;
  return v_employee;
end;
$$;

-- Downtime entered with a duration (ended now, or from p_started_at for
-- managers entering it later). Idempotent by p_idempotency_key.
create function public.record_downtime(
  p_operation_id uuid,
  p_reason_id uuid,
  p_minutes numeric,
  p_idempotency_key uuid,
  p_started_at timestamptz default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_employee uuid;
  v_start timestamptz;
  v_notes text := nullif(btrim(p_notes), '');
  v_id uuid;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select d.id into v_id from public.production_downtime_events d
  where d.idempotency_key = p_idempotency_key and d.operation_id = p_operation_id;
  if v_id is not null then
    return v_id;
  end if;

  v_employee := private.record_access(p_operation_id, false);
  select * into v_op from public.production_order_operations o where o.id = p_operation_id;

  if not exists (
    select 1 from public.catalog_items c
    where c.id = p_reason_id and c.organization_id = v_op.organization_id
      and c.kind = 'downtime_reason' and c.archived_at is null
  ) then
    raise exception 'downtime_reason_required' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes <= 0 or p_minutes > 10080 or p_minutes <> round(p_minutes, 2) then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  if p_started_at is not null
    and not private.has_permission(v_op.organization_id, 'orders.manage') then
    raise exception 'only managers enter a start time' using errcode = '42501';
  end if;
  v_start := coalesce(p_started_at, now() - make_interval(secs => p_minutes * 60));
  if v_start + make_interval(secs => p_minutes * 60) > now() + interval '1 minute' then
    raise exception 'downtime_in_future' using errcode = '22023';
  end if;
  if length(v_notes) > 500 then
    raise exception 'notes too long' using errcode = '22023';
  end if;

  insert into public.production_downtime_events (
    organization_id, order_id, operation_id, machine_id, employee_id, reason_id, notes,
    started_at, ended_at, source, idempotency_key
  ) values (
    v_op.organization_id, v_op.order_id, p_operation_id, v_op.machine_id, v_employee, p_reason_id,
    v_notes, v_start, v_start + make_interval(secs => p_minutes * 60), 'entry', p_idempotency_key
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.record_tool_change(
  p_operation_id uuid,
  p_tool text,
  p_insert text,
  p_reason_id uuid,
  p_minutes numeric,
  p_notes text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_employee uuid;
  v_id uuid;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select t.id into v_id from public.production_tool_changes t
  where t.idempotency_key = p_idempotency_key and t.operation_id = p_operation_id;
  if v_id is not null then
    return v_id;
  end if;

  v_employee := private.record_access(p_operation_id, true);
  select * into v_op from public.production_order_operations o where o.id = p_operation_id;

  if nullif(btrim(p_tool), '') is null then
    raise exception 'tool_required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.catalog_items c
    where c.id = p_reason_id and c.organization_id = v_op.organization_id
      and c.kind = 'tool_change_reason' and c.archived_at is null
  ) then
    raise exception 'tool_change_reason_required' using errcode = '22023';
  end if;
  if p_minutes is not null and (p_minutes <= 0 or p_minutes > 1440 or p_minutes <> round(p_minutes, 2)) then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;

  insert into public.production_tool_changes (
    organization_id, order_id, operation_id, machine_id, employee_id, tool, insert_name, reason_id,
    duration_min, notes, idempotency_key
  ) values (
    v_op.organization_id, v_op.order_id, p_operation_id, v_op.machine_id, v_employee,
    btrim(p_tool), nullif(btrim(p_insert), ''), p_reason_id, p_minutes, nullif(btrim(p_notes), ''),
    p_idempotency_key
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
-- Same as 20261026100000 plus source and duration.
drop function public.production_order_downtime(uuid);

create function public.production_order_downtime(p_order_id uuid)
returns table (
  id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds numeric,
  operation_code text,
  operation_sequence integer,
  machine_code text,
  employee_name text,
  reason text,
  source text,
  notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.started_at, d.ended_at,
    extract(epoch from coalesce(d.ended_at, now()) - d.started_at),
    t.code, o.sequence, m.code, e.first_name || ' ' || e.last_name, c.name, d.source, d.notes
  from public.production_downtime_events d
  join public.production_orders r on r.id = d.order_id
  join public.production_order_operations o on o.id = d.operation_id
  join public.operation_types t on t.id = o.operation_type_id
  left join public.machines m on m.id = d.machine_id
  left join public.employees e on e.id = d.employee_id
  join public.catalog_items c on c.id = d.reason_id
  where d.order_id = p_order_id
    and private.has_permission(r.organization_id, 'orders.read')
  order by d.started_at desc
$$;

create function public.production_order_tool_changes(p_order_id uuid)
returns table (
  id uuid,
  changed_at timestamptz,
  operation_code text,
  machine_code text,
  employee_name text,
  tool text,
  insert_name text,
  reason text,
  duration_min numeric,
  notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select tc.id, tc.changed_at, t.code, m.code, e.first_name || ' ' || e.last_name, tc.tool,
    tc.insert_name, c.name, tc.duration_min, tc.notes
  from public.production_tool_changes tc
  join public.production_orders r on r.id = tc.order_id
  join public.production_order_operations o on o.id = tc.operation_id
  join public.operation_types t on t.id = o.operation_type_id
  left join public.machines m on m.id = tc.machine_id
  left join public.employees e on e.id = tc.employee_id
  join public.catalog_items c on c.id = tc.reason_id
  where tc.order_id = p_order_id
    and private.has_permission(r.organization_id, 'orders.read')
  order by tc.changed_at desc
$$;

-- The foreman's overview of a period [p_from, p_to): reports, downtime
-- overlapping it (and every open one), open work sessions and tool changes.
create function public.production_day(p_org_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.has_permission(p_org_id, 'orders.read') then null else
  jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rp.id, 'at', rp.reported_at, 'order_id', r.id, 'order_number', r.order_number,
        'operation_code', t.code, 'machine_id', rp.machine_id, 'machine_code', m.code,
        'employee_id', rp.employee_id, 'employee_name', e.first_name || ' ' || e.last_name,
        'good', rp.good_quantity, 'scrap', rp.scrap_quantity, 'scrap_reason', c.name,
        'voided', rp.voided_at is not null
      ) order by rp.reported_at desc)
      from public.production_reports rp
      join public.production_orders r on r.id = rp.order_id
      join public.production_order_operations o on o.id = rp.operation_id
      join public.operation_types t on t.id = o.operation_type_id
      left join public.machines m on m.id = rp.machine_id
      left join public.employees e on e.id = rp.employee_id
      left join public.catalog_items c on c.id = rp.scrap_reason_id
      where rp.organization_id = p_org_id and rp.reported_at >= p_from and rp.reported_at < p_to
    ), '[]'::jsonb),
    'downtime', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'started_at', d.started_at, 'ended_at', d.ended_at,
        'seconds', extract(epoch from least(coalesce(d.ended_at, now()), p_to)
          - greatest(d.started_at, p_from)),
        'order_id', r.id, 'order_number', r.order_number, 'operation_code', t.code,
        'machine_id', d.machine_id, 'machine_code', m.code,
        'employee_id', d.employee_id, 'employee_name', e.first_name || ' ' || e.last_name,
        'reason', c.name, 'source', d.source, 'notes', d.notes
      ) order by d.started_at desc)
      from public.production_downtime_events d
      join public.production_orders r on r.id = d.order_id
      join public.production_order_operations o on o.id = d.operation_id
      join public.operation_types t on t.id = o.operation_type_id
      left join public.machines m on m.id = d.machine_id
      left join public.employees e on e.id = d.employee_id
      join public.catalog_items c on c.id = d.reason_id
      where d.organization_id = p_org_id
        and (d.ended_at is null or (d.started_at < p_to and d.ended_at > p_from))
    ), '[]'::jsonb),
    'working', coalesce((
      select jsonb_agg(jsonb_build_object(
        'started_at', s.started_at, 'order_id', r.id, 'order_number', r.order_number,
        'operation_code', t.code, 'operation_name', t.name,
        'machine_id', s.machine_id, 'machine_code', m.code,
        'employee_id', s.employee_id, 'employee_name', e.first_name || ' ' || e.last_name
      ) order by s.started_at)
      from public.production_work_sessions s
      join public.production_orders r on r.id = s.order_id
      join public.production_order_operations o on o.id = s.operation_id
      join public.operation_types t on t.id = o.operation_type_id
      left join public.machines m on m.id = s.machine_id
      join public.employees e on e.id = s.employee_id
      where s.organization_id = p_org_id and s.ended_at is null
    ), '[]'::jsonb),
    'tool_changes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tc.id, 'at', tc.changed_at, 'order_id', r.id, 'order_number', r.order_number,
        'operation_code', t.code, 'machine_id', tc.machine_id, 'machine_code', m.code,
        'employee_id', tc.employee_id, 'employee_name', e.first_name || ' ' || e.last_name,
        'tool', tc.tool, 'insert_name', tc.insert_name, 'reason', c.name,
        'duration_min', tc.duration_min
      ) order by tc.changed_at desc)
      from public.production_tool_changes tc
      join public.production_orders r on r.id = tc.order_id
      join public.production_order_operations o on o.id = tc.operation_id
      join public.operation_types t on t.id = o.operation_type_id
      left join public.machines m on m.id = tc.machine_id
      left join public.employees e on e.id = tc.employee_id
      join public.catalog_items c on c.id = tc.reason_id
      where tc.organization_id = p_org_id and tc.changed_at >= p_from and tc.changed_at < p_to
    ), '[]'::jsonb)
  ) end
$$;

do $$
declare
  v_fn text;
begin
  revoke execute on function private.record_access(uuid, boolean) from public;
  grant execute on function private.record_access(uuid, boolean) to authenticated;
  foreach v_fn in array array[
    'public.record_downtime(uuid, uuid, numeric, uuid, timestamptz, text)',
    'public.record_tool_change(uuid, text, text, uuid, numeric, text, uuid)',
    'public.production_order_downtime(uuid)',
    'public.production_order_tool_changes(uuid)',
    'public.production_day(uuid, timestamptz, timestamptz)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
