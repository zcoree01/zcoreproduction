-- Phase 5 d: production planning by days (D-041).
--   * The head of production places machine operations on a machine and a
--     day (plan_day) and orders them within that day (plan_position), by
--     dragging or with arrows on /planning. plan_added_at records when an
--     operation was put into its day, so "move the work that was added
--     last" can be offered when a day is overloaded.
--   * A planned operation always has a responsible operator, also on a
--     machine that runs unattended (an EDM job started at 14:00 runs on
--     after the operator goes home at 15:00).
--   * machines.runs_unattended / capacity_hours: hours per day a machine can
--     work (null = 24 h when unattended, otherwise the organization's
--     work_hours_per_day).
--   * machine_downtimes: a machine out of service from a day, until a day
--     or "until further notice" (ends_on null).
--   * External operations (hardening, coating…): days and price entered
--     when the pieces come back; not counted as our production time.
--   * Overloads and lateness are warnings only; nothing blocks.

-- ---------------------------------------------------------------------------
-- Machines
-- ---------------------------------------------------------------------------
alter table public.machines
  add column runs_unattended boolean not null default false,
  add column capacity_hours numeric(4, 2)
    check (capacity_hours is null or (capacity_hours > 0 and capacity_hours <= 24));

grant insert (runs_unattended, capacity_hours), update (runs_unattended, capacity_hours)
  on public.machines to authenticated;

create or replace view public.machine_directory
with (security_invoker = true)
as
select
  m.id,
  m.organization_id,
  m.code,
  m.name,
  m.type_id,
  t.name as type_name,
  m.manufacturer,
  m.model,
  m.location_id,
  l.name as location_name,
  m.status,
  m.status_changed_at,
  m.notes,
  m.created_at,
  m.archived_at,
  m.cycle_time_unit,
  m.runs_unattended,
  m.capacity_hours
from public.machines m
left join public.catalog_items t on t.id = m.type_id and t.organization_id = m.organization_id
left join public.catalog_items l on l.id = m.location_id and l.organization_id = m.organization_id;

-- ---------------------------------------------------------------------------
-- Operations: plan and external result
-- ---------------------------------------------------------------------------
alter table public.production_order_operations
  add column plan_day date,
  add column plan_position integer check (plan_position between 1 and 100000),
  add column plan_added_at timestamptz,
  add column external_days integer check (external_days between 0 and 3650),
  add column external_cost numeric(14, 2) check (external_cost >= 0),
  add constraint production_order_operations_plan_check
    check ((plan_day is null) = (plan_position is null) and (plan_day is null) = (plan_added_at is null));

create index production_order_operations_plan_idx
  on public.production_order_operations (organization_id, machine_id, plan_day)
  where plan_day is not null and archived_at is null;

-- Appends the plan and the external result to the view of 20261026100000.
create or replace view public.production_order_operation_directory
with (security_invoker = true)
as
select
  o.id,
  o.organization_id,
  o.order_id,
  o.sequence,
  o.source_operation_id,
  o.operation_type_id,
  t.code as operation_code,
  t.name as operation_name,
  t.is_external,
  t.is_inspection,
  t.is_cutting,
  o.description,
  o.machine_type_id,
  mt.name as machine_type_name,
  o.machine_id,
  m.code as machine_code,
  m.name as machine_name,
  m.cycle_time_unit as machine_cycle_time_unit,
  o.machine_id is not null and o.machine_type_id is not null
    and m.type_id is distinct from o.machine_type_id as machine_type_mismatch,
  o.external_company,
  o.setup_time_min,
  o.cycle_time_s,
  coalesce(o.setup_time_min, 0) * 60 + coalesce(o.cycle_time_s, 0) * r.quantity as planned_seconds,
  o.notes,
  o.planned_start,
  o.planned_end,
  o.status,
  o.status_changed_at,
  o.archived_at,
  private.operation_workers(o.id) as workers,
  (select count(*)::integer from private.operation_overlaps(o.id)) as overlap_count,
  private.operation_input(o.id) as input_quantity,
  rep.good as good_quantity,
  rep.scrap as scrap_quantity,
  private.operation_run_seconds(o.id) as run_seconds,
  private.operation_worker_seconds(o.id) as worker_seconds,
  private.operation_downtime_seconds(o.id) as downtime_seconds,
  o.plan_day,
  o.plan_position,
  o.plan_added_at,
  o.external_days,
  o.external_cost,
  (
    select max(h.changed_at) from public.production_order_status_history h
    where h.operation_id = o.id and h.to_status = 'in_progress'
  ) as external_sent_at,
  (
    select max(h.changed_at) from public.production_order_status_history h
    where h.operation_id = o.id and h.to_status = 'done'
  ) as external_received_at
from public.production_order_operations o
join public.production_orders r on r.id = o.order_id and r.organization_id = o.organization_id
left join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
left join public.catalog_items mt on mt.id = o.machine_type_id and mt.organization_id = o.organization_id
left join public.machines m on m.id = o.machine_id and m.organization_id = o.organization_id
cross join lateral private.operation_reported(o.id) rep;

-- Moves on the planning board, one transaction. p_moves: up to 500 of
-- {operation_id, machine_id, plan_day ("YYYY-MM-DD" or null = take off the
-- plan), position, employee_ids (optional: replaces the operators),
-- auto (optional: a move the program proposed, keeps plan_added_at)}.
-- orders.manage. Machine operations of open orders only; a planned
-- operation needs an operator; a started operation keeps its machine.
create function public.plan_operations(p_org_id uuid, p_moves jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_move jsonb;
  v_op public.production_order_operations;
  v_kind record;
  v_order_status text;
  v_machine_id uuid;
  v_day date;
  v_position integer;
  v_employees uuid[];
begin
  if not exists (select 1 from private.user_org_ids() as o (id) where o.id = p_org_id) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(p_org_id);
  if p_moves is null or jsonb_typeof(p_moves) <> 'array'
    or not (jsonb_array_length(p_moves) between 1 and 500) then
    raise exception 'invalid_moves' using errcode = '22023';
  end if;

  for v_move in select value from jsonb_array_elements(p_moves) loop
    select * into v_op from public.production_order_operations o
    where o.id = (v_move ->> 'operation_id')::uuid
      and o.organization_id = p_org_id and o.archived_at is null
    for update;
    if v_op.id is null then
      raise exception 'operation not found' using errcode = 'P0002';
    end if;
    select t.is_external, t.is_inspection into v_kind
    from public.operation_types t where t.id = v_op.operation_type_id;
    if v_kind.is_external or v_kind.is_inspection then
      raise exception 'not_machine_operation' using errcode = '22023';
    end if;
    select r.status into v_order_status from public.production_orders r where r.id = v_op.order_id;
    if v_order_status in ('completed', 'cancelled', 'archived') or v_op.status = 'done' then
      raise exception 'operation_closed' using errcode = '55000';
    end if;

    v_day := (v_move ->> 'plan_day')::date;
    v_machine_id := coalesce((v_move ->> 'machine_id')::uuid, v_op.machine_id);
    v_position := (v_move ->> 'position')::integer;

    if v_machine_id is distinct from v_op.machine_id then
      if v_op.status in ('in_progress', 'paused') then
        raise exception 'operation_started' using errcode = '55000';
      end if;
      if not exists (
        select 1 from public.machines m
        where m.id = v_machine_id and m.organization_id = p_org_id
          and m.archived_at is null and m.status <> 'inactive'
      ) then
        raise exception 'machine not found' using errcode = 'P0002';
      end if;
    end if;

    if v_move ? 'employee_ids' then
      v_employees := array(
        select distinct e::uuid from jsonb_array_elements_text(v_move -> 'employee_ids') as e
      );
      if exists (
        select 1 from unnest(v_employees) as e (id)
        where not exists (
          select 1 from public.employees x
          where x.id = e.id and x.organization_id = p_org_id
            and x.archived_at is null and x.status = 'active'
        )
      ) then
        raise exception 'employee not found' using errcode = 'P0002';
      end if;
      delete from public.production_order_operation_workers w
      where w.operation_id = v_op.id and w.employee_id <> all (v_employees);
      insert into public.production_order_operation_workers (organization_id, operation_id, employee_id)
      select p_org_id, v_op.id, e from unnest(v_employees) as e
      on conflict (operation_id, employee_id) do nothing;
    end if;

    if v_day is not null then
      if v_position is null or v_position not between 1 and 100000 then
        raise exception 'invalid_moves' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.production_order_operation_workers w where w.operation_id = v_op.id
      ) then
        raise exception 'operator_required' using errcode = '23514';
      end if;
    end if;

    update public.production_order_operations set
      machine_id = v_machine_id,
      plan_day = v_day,
      plan_position = case when v_day is null then null else v_position end,
      plan_added_at = case
        when v_day is null then null
        when v_op.plan_day is not null and coalesce((v_move ->> 'auto')::boolean, false)
          then v_op.plan_added_at
        when v_op.plan_day is not distinct from v_day
          and v_op.machine_id is not distinct from v_machine_id then v_op.plan_added_at
        else now()
      end
    where id = v_op.id
      and (machine_id, plan_day, plan_position) is distinct from
        (v_machine_id, v_day, case when v_day is null then null else v_position end);
  end loop;
end;
$$;

-- Days and price of an external operation once the pieces are back
-- (status done). orders.manage. Null clears a value.
create function public.record_external_result(
  p_operation_id uuid,
  p_days integer,
  p_cost numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
begin
  select * into v_op from public.production_order_operations o
  where o.id = p_operation_id and o.archived_at is null
  for update;
  if v_op.id is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = v_op.organization_id) then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(v_op.organization_id);
  if not exists (
    select 1 from public.operation_types t where t.id = v_op.operation_type_id and t.is_external
  ) then
    raise exception 'not_external_operation' using errcode = '22023';
  end if;
  if v_op.status <> 'done' then
    raise exception 'external_not_received' using errcode = '55000';
  end if;
  update public.production_order_operations
  set external_days = p_days, external_cost = round(p_cost, 2)
  where id = p_operation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Machine downtimes
-- ---------------------------------------------------------------------------
create table public.machine_downtimes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  machine_id uuid not null,
  starts_on date not null,
  -- Last day out of service; null = until further notice.
  ends_on date,
  reason_id uuid,
  reason_kind text generated always as ('downtime_reason') stored,
  note text check (note is null or length(btrim(note)) between 1 and 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  constraint machine_downtimes_period_check check (ends_on is null or ends_on >= starts_on),
  foreign key (organization_id, machine_id)
    references public.machines (organization_id, id) on delete restrict,
  foreign key (organization_id, reason_kind, reason_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict
);

create index machine_downtimes_machine_idx
  on public.machine_downtimes (organization_id, machine_id, starts_on)
  where archived_at is null;

create trigger machine_downtimes_set_updated_at before update on public.machine_downtimes
  for each row execute function private.set_updated_at();
create trigger machine_downtimes_audit after insert or update or delete on public.machine_downtimes
  for each row execute function private.audit_row_change();

revoke all on public.machine_downtimes from anon, authenticated;
grant select on public.machine_downtimes to authenticated;

alter table public.machine_downtimes enable row level security;

create policy machine_downtimes_select on public.machine_downtimes
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create function private.require_downtime_manage(p_org_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not (private.has_permission(p_org_id, 'orders.manage')
    or private.has_permission(p_org_id, 'machines.manage')) then
    raise exception 'missing permission orders.manage' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function private.require_downtime_manage(uuid) from public;
grant execute on function private.require_downtime_manage(uuid) to authenticated;

-- New (p_id null) or changed downtime. orders.manage or machines.manage.
create function public.save_machine_downtime(
  p_org_id uuid,
  p_id uuid,
  p_machine_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_reason_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not exists (select 1 from private.user_org_ids() as o (id) where o.id = p_org_id) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  perform private.require_downtime_manage(p_org_id);
  if p_starts_on is null or (p_ends_on is not null and p_ends_on < p_starts_on) then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.machines m
    where m.id = p_machine_id and m.organization_id = p_org_id and m.archived_at is null
  ) then
    raise exception 'machine not found' using errcode = 'P0002';
  end if;
  if p_reason_id is not null and not exists (
    select 1 from public.catalog_items c
    where c.id = p_reason_id and c.organization_id = p_org_id and c.kind = 'downtime_reason'
  ) then
    raise exception 'reason not found' using errcode = 'P0002';
  end if;

  if p_id is null then
    insert into public.machine_downtimes (
      organization_id, machine_id, starts_on, ends_on, reason_id, note
    ) values (p_org_id, p_machine_id, p_starts_on, p_ends_on, p_reason_id, v_note)
    returning id into v_id;
  else
    update public.machine_downtimes set
      machine_id = p_machine_id, starts_on = p_starts_on, ends_on = p_ends_on,
      reason_id = p_reason_id, note = v_note
    where id = p_id and organization_id = p_org_id and archived_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'downtime not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- Removes a downtime entered by mistake (archived, not deleted).
create function public.archive_machine_downtime(p_org_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.user_org_ids() as o (id) where o.id = p_org_id) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  perform private.require_downtime_manage(p_org_id);
  update public.machine_downtimes set archived_at = now()
  where id = p_id and organization_id = p_org_id and archived_at is null;
  if not found then
    raise exception 'downtime not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.plan_operations(uuid, jsonb) from public, anon;
revoke execute on function public.record_external_result(uuid, integer, numeric) from public, anon;
revoke execute on function public.save_machine_downtime(uuid, uuid, uuid, date, date, uuid, text)
  from public, anon;
revoke execute on function public.archive_machine_downtime(uuid, uuid) from public, anon;
grant execute on function public.plan_operations(uuid, jsonb) to authenticated;
grant execute on function public.record_external_result(uuid, integer, numeric) to authenticated;
grant execute on function public.save_machine_downtime(uuid, uuid, uuid, date, date, uuid, text)
  to authenticated;
grant execute on function public.archive_machine_downtime(uuid, uuid) to authenticated;
