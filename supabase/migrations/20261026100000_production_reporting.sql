-- Phase 3: production reporting on the shop floor (D-018).
--
-- Product answers (2026-10-25):
--   * workers start, pause (with a downtime reason) and finish operations;
--   * quantities may be reported in parts: reported good pieces move on to
--     the next operation at once, which can start while this one still runs;
--   * scrap is counted separately from good pieces, a scrap reason is optional;
--   * inspection operations (between operations and final) are done by the
--     inspector (Kontrolor), who reports good and scrap;
--   * an order completes automatically when its last operation is finished
--     with at least the ordered quantity of good pieces; otherwise the
--     inspector (or a manager) asks to close it with a shortage and the head
--     of production approves (orders.close.approve);
--   * several workers / shifts report separately: worker time (sessions) and
--     machine time (operation running) are kept apart, nothing is counted twice;
--   * the cutting worker's "ready for further processing" records the number of
--     cut pieces and finishes the cutting operation.
--
-- Tables: production_reports (append-only quantities with an idempotency key,
-- voided instead of deleted), production_work_sessions (worker time),
-- production_downtime_events (machine standing still, with reason),
-- production_order_close_requests. Writes only through the functions below.

-- ---------------------------------------------------------------------------
-- Permissions and catalogs
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module_key, description, default_roles) values
  ('orders.close.approve', 'production',
    'Approve closing a production order with fewer good pieces than ordered',
    '{admin,director,head_of_production}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'orders.close.approve'
from public.roles r
where r.is_system and r.key in ('admin', 'director', 'head_of_production')
on conflict do nothing;

alter table public.catalog_items drop constraint catalog_items_kind_check;
alter table public.catalog_items add constraint catalog_items_kind_check
  check (kind in (
    'machine_type', 'location', 'department', 'job_title', 'skill',
    'product_type', 'material_shape', 'downtime_reason', 'scrap_reason'
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
    when p_kind in ('downtime_reason', 'scrap_reason') then 'orders.manage'
  end
$$;

-- Starter reasons; every organization edits its own lists.
create function private.seed_default_reasons(p_org_id uuid)
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
    ('scrap_reason', 'Ostalo')
  ) as v (kind, name)
  where not exists (
    select 1 from public.catalog_items c
    where c.organization_id = p_org_id and c.kind = v.kind
  )
$$;

revoke execute on function private.seed_default_reasons(uuid) from public;

create function private.seed_organization_reasons()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_default_reasons(new.id);
  return null;
end;
$$;

create trigger organizations_seed_reasons after insert on public.organizations
  for each row execute function private.seed_organization_reasons();

select private.seed_default_reasons(o.id) from public.organizations o;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.production_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  operation_id uuid not null,
  -- Worker who reported (null: e.g. the warehouse without an employee record).
  employee_id uuid,
  machine_id uuid,
  good_quantity numeric(14, 3) not null check (good_quantity >= 0),
  scrap_quantity numeric(14, 3) not null check (scrap_quantity >= 0),
  scrap_reason_id uuid,
  scrap_reason_kind text generated always as ('scrap_reason') stored,
  notes text check (notes is null or length(btrim(notes)) between 1 and 500),
  -- Sent by the client; a repeated submission returns the first report.
  idempotency_key uuid not null,
  reported_by uuid default auth.uid(),
  reported_at timestamptz not null default now(),
  -- Wrong reports are voided by a manager, never deleted.
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 1 and 500),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  constraint production_reports_quantity_check check (good_quantity + scrap_quantity > 0),
  constraint production_reports_scrap_reason_check
    check (scrap_reason_id is null or scrap_quantity > 0),
  constraint production_reports_void_check
    check ((voided_at is null) = (void_reason is null)),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, operation_id)
    references public.production_order_operations (organization_id, id) on delete restrict,
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  foreign key (organization_id, machine_id)
    references public.machines (organization_id, id) on delete restrict,
  foreign key (organization_id, scrap_reason_kind, scrap_reason_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict
);

comment on table public.production_reports is
  'Good and scrap quantities reported per operation (append-only, idempotent, voided not deleted).';

create index production_reports_operation_idx
  on public.production_reports (organization_id, operation_id) where voided_at is null;
create index production_reports_order_idx on public.production_reports (organization_id, order_id);
create index production_reports_employee_idx on public.production_reports (organization_id, employee_id);
create index production_reports_machine_idx on public.production_reports (organization_id, machine_id);
create index production_reports_reason_idx
  on public.production_reports (organization_id, scrap_reason_kind, scrap_reason_id);

-- Worker time: one row per worker and uninterrupted stretch of work.
create table public.production_work_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  operation_id uuid not null,
  employee_id uuid not null,
  machine_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (organization_id, id),
  constraint production_work_sessions_period_check check (ended_at is null or ended_at >= started_at),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, operation_id)
    references public.production_order_operations (organization_id, id) on delete restrict,
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  foreign key (organization_id, machine_id)
    references public.machines (organization_id, id) on delete restrict
);

comment on table public.production_work_sessions is
  'Worker time on an operation (start until pause / finish). Machine time is derived from operation status.';

create unique index production_work_sessions_open_key
  on public.production_work_sessions (operation_id, employee_id) where ended_at is null;
create index production_work_sessions_operation_idx
  on public.production_work_sessions (organization_id, operation_id);
create index production_work_sessions_order_idx
  on public.production_work_sessions (organization_id, order_id);
create index production_work_sessions_employee_idx
  on public.production_work_sessions (organization_id, employee_id, started_at);
create index production_work_sessions_machine_idx
  on public.production_work_sessions (organization_id, machine_id);

-- An operation standing still (paused) with its reason.
create table public.production_downtime_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  operation_id uuid not null,
  machine_id uuid,
  employee_id uuid,
  reason_id uuid not null,
  reason_kind text generated always as ('downtime_reason') stored,
  notes text check (notes is null or length(btrim(notes)) between 1 and 500),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  reported_by uuid default auth.uid(),
  unique (organization_id, id),
  constraint production_downtime_events_period_check check (ended_at is null or ended_at >= started_at),
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

comment on table public.production_downtime_events is
  'Downtime of an operation / machine with a configurable reason (from pause until work continues).';

create unique index production_downtime_events_open_key
  on public.production_downtime_events (operation_id) where ended_at is null;
create index production_downtime_events_order_idx
  on public.production_downtime_events (organization_id, order_id);
create index production_downtime_events_operation_idx
  on public.production_downtime_events (organization_id, operation_id);
create index production_downtime_events_machine_idx
  on public.production_downtime_events (organization_id, machine_id, started_at);
create index production_downtime_events_employee_idx
  on public.production_downtime_events (organization_id, employee_id);
create index production_downtime_events_reason_idx
  on public.production_downtime_events (organization_id, reason_kind, reason_id);

-- Closing an order with fewer good pieces than ordered.
create table public.production_order_close_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  -- Good pieces of the last operation when the request was made.
  good_quantity numeric(14, 3) not null check (good_quantity >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 1 and 500),
  unique (organization_id, id),
  constraint production_order_close_requests_decision_check
    check ((status = 'pending') = (decided_at is null)),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict
);

create unique index production_order_close_requests_pending_key
  on public.production_order_close_requests (order_id) where status = 'pending';
create index production_order_close_requests_order_idx
  on public.production_order_close_requests (organization_id, order_id);

create trigger production_reports_audit after insert or update on public.production_reports
  for each row execute function private.audit_row_change();
create trigger production_downtime_events_audit
  after insert or update on public.production_downtime_events
  for each row execute function private.audit_row_change();
create trigger production_order_close_requests_audit
  after insert or update on public.production_order_close_requests
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Quantities along the routing (mirrored by src/modules/production-reporting/rules.ts)
-- ---------------------------------------------------------------------------
create function private.operation_reported(p_operation_id uuid)
returns table (good numeric, scrap numeric, report_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.good_quantity), 0), coalesce(sum(r.scrap_quantity), 0), count(*)::integer
  from public.production_reports r
  where r.operation_id = p_operation_id and r.voided_at is null
$$;

-- Active operation just before this one (or null).
create function private.previous_operation(p_operation_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select prev.id
  from public.production_order_operations me
  join public.production_order_operations prev
    on prev.order_id = me.order_id and prev.archived_at is null and prev.sequence < me.sequence
  where me.id = p_operation_id
  order by prev.sequence desc
  limit 1
$$;

-- Pieces that have reached an operation: the ordered quantity for the first
-- one; otherwise the good pieces reported on the previous operation. A
-- previous operation that is done without reports (external work, status set
-- by hand) passes on what reached it.
create function private.operation_input(p_operation_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prev uuid := private.previous_operation(p_operation_id);
  v_prev_status text;
  v_reported record;
begin
  if v_prev is null then
    return (
      select r.quantity from public.production_order_operations o
      join public.production_orders r on r.id = o.order_id
      where o.id = p_operation_id
    );
  end if;
  select * into v_reported from private.operation_reported(v_prev);
  if v_reported.report_count > 0 then
    return v_reported.good;
  end if;
  select o.status into v_prev_status from public.production_order_operations o where o.id = v_prev;
  if v_prev_status = 'done' then
    return private.operation_input(v_prev);
  end if;
  return 0;
end;
$$;

-- Work has reached the operation: it is the first one, or the previous one is
-- done or has passed on good pieces (parts may move on before it is done).
create or replace function private.operation_arrived(p_operation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select o.status = 'done' or (select r.good from private.operation_reported(o.id) r) > 0
    from public.production_order_operations o
    where o.id = private.previous_operation(p_operation_id)
  ), true)
$$;

-- Last active operation of the order.
create function private.last_operation(p_order_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.production_order_operations o
  where o.order_id = p_order_id and o.archived_at is null
  order by o.sequence desc
  limit 1
$$;

-- Finished good pieces of the order: good pieces of its last operation.
create function private.order_good_quantity(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select r.good from private.operation_reported(private.last_operation(p_order_id)) r), 0)
$$;

-- An order may be completed when every operation is done and the last one
-- reported at least the ordered quantity, or when closing it with a shortage
-- was approved.
create or replace function private.order_completion_allowed(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.production_order_close_requests c
      where c.order_id = p_order_id and c.status = 'approved'
    )
    or (
      exists (
        select 1 from public.production_order_operations o
        where o.order_id = p_order_id and o.archived_at is null
      )
      and not exists (
        select 1 from public.production_order_operations o
        where o.order_id = p_order_id and o.archived_at is null and o.status <> 'done'
      )
      and private.order_good_quantity(p_order_id) >= (
        select r.quantity from public.production_orders r where r.id = p_order_id
      )
    )
$$;

-- Seconds an operation was running (status in_progress), from its status history.
create function private.operation_run_seconds(p_operation_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with h as (
    select h.to_status, h.changed_at,
      lead(h.changed_at) over (order by h.changed_at, h.id) as next_at
    from public.production_order_status_history h
    where h.operation_id = p_operation_id
  )
  select coalesce(sum(extract(epoch from coalesce(h.next_at, now()) - h.changed_at)), 0)
  from h
  where h.to_status = 'in_progress'
$$;

create function private.operation_worker_seconds(p_operation_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(extract(epoch from coalesce(s.ended_at, now()) - s.started_at)), 0)
  from public.production_work_sessions s
  where s.operation_id = p_operation_id
$$;

create function private.operation_downtime_seconds(p_operation_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(extract(epoch from coalesce(d.ended_at, now()) - d.started_at)), 0)
  from public.production_downtime_events d
  where d.operation_id = p_operation_id
$$;

-- ---------------------------------------------------------------------------
-- Visibility: inspection operations belong to inspectors
-- ---------------------------------------------------------------------------
-- Assigned workers see the operation. Without workers: an inspection is seen
-- by every inspector (quality.inspect), other operations by everyone
-- qualified for their machine.
create or replace function private.employee_sees_operation(
  p_employee_id uuid,
  p_operation_id uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee_id is not null and case
    when exists (select 1 from public.production_order_operation_workers w where w.operation_id = p_operation_id)
      then exists (
        select 1 from public.production_order_operation_workers w
        where w.operation_id = p_operation_id and w.employee_id = p_employee_id
      )
    when exists (
      select 1 from public.production_order_operations o
      join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
      where o.id = p_operation_id and t.is_inspection
    )
      then exists (
        select 1 from public.employees e
        where e.id = p_employee_id and e.user_id is not null
          and private.user_has_permission(e.organization_id, e.user_id, 'quality.inspect')
      )
    else p_machine_id is not null and exists (
      select 1 from public.employee_machines em
      where em.employee_id = p_employee_id and em.machine_id = p_machine_id
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers (definer; callers check access)
-- ---------------------------------------------------------------------------
create function private.set_operation_status_internal(
  p_operation_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
begin
  select * into v_op from public.production_order_operations o where o.id = p_operation_id;
  if v_op.status = p_status then
    return;
  end if;
  update public.production_order_operations set status = p_status where id = p_operation_id;
  insert into public.production_order_status_history (
    organization_id, order_id, operation_id, from_status, to_status, reason
  ) values (v_op.organization_id, v_op.order_id, p_operation_id, v_op.status, p_status, p_reason);
end;
$$;

-- Moves the order towards p_target along allowed transitions
-- (ready → in_progress → quality_check → completed), with history rows.
create function private.advance_order(p_order_id uuid, p_target text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_next text;
begin
  loop
    select * into v_order from public.production_orders r where r.id = p_order_id for update;
    exit when v_order.status = p_target;
    v_next := case
      when v_order.status in ('ready', 'paused') then 'in_progress'
      when v_order.status = 'quality_check' and p_target = 'in_progress' then 'in_progress'
      when v_order.status = 'in_progress' and p_target in ('quality_check', 'completed') then 'quality_check'
      when v_order.status = 'quality_check' and p_target = 'completed' then 'completed'
    end;
    exit when v_next is null;
    if v_next = 'completed' then
      perform private.close_order_work(p_order_id);
    end if;
    update public.production_orders set status = v_next where id = p_order_id;
    insert into public.production_order_status_history (
      organization_id, order_id, from_status, to_status
    ) values (v_order.organization_id, p_order_id, v_order.status, v_next);
  end loop;
end;
$$;

-- Machine status follows the work: running while someone works on it,
-- stopped while an operation on it is paused, otherwise available.
-- Maintenance and inactive machines are left alone.
create function private.sync_machine_status(p_machine_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_machine_id is null then
    return;
  end if;
  v_status := case
    when exists (
      select 1 from public.production_work_sessions s
      where s.machine_id = p_machine_id and s.ended_at is null
    ) then 'running'
    when exists (
      select 1 from public.production_downtime_events d
      where d.machine_id = p_machine_id and d.ended_at is null
    ) then 'stopped'
    else 'available'
  end;
  update public.machines set status = v_status
  where id = p_machine_id and status in ('available', 'running', 'stopped') and status <> v_status;
end;
$$;

-- Ends all open work and downtime of an operation.
create function private.close_operation_work(p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_machine uuid;
begin
  update public.production_work_sessions set ended_at = now()
  where operation_id = p_operation_id and ended_at is null;
  update public.production_downtime_events set ended_at = now()
  where operation_id = p_operation_id and ended_at is null;
  select o.machine_id into v_machine from public.production_order_operations o where o.id = p_operation_id;
  perform private.sync_machine_status(v_machine);
end;
$$;

create function private.close_order_work(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op uuid;
begin
  for v_op in
    select distinct o.id from public.production_order_operations o
    where o.order_id = p_order_id and (
      exists (select 1 from public.production_work_sessions s where s.operation_id = o.id and s.ended_at is null)
      or exists (select 1 from public.production_downtime_events d where d.operation_id = o.id and d.ended_at is null)
    )
  loop
    perform private.close_operation_work(v_op);
  end loop;
end;
$$;

-- After an operation is done: the order completes when everything is done
-- and enough good pieces were made; it waits for quality control when only
-- inspections are left, or everything is done with a shortage.
create function private.after_operation_done(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.production_order_operations o
    where o.order_id = p_order_id and o.archived_at is null and o.status <> 'done'
  ) then
    if private.order_completion_allowed(p_order_id) then
      perform private.advance_order(p_order_id, 'completed');
    else
      perform private.advance_order(p_order_id, 'quality_check');
    end if;
  elsif not exists (
    select 1 from public.production_order_operations o
    join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
    where o.order_id = p_order_id and o.archived_at is null and o.status <> 'done'
      and not t.is_inspection
  ) and exists (
    select 1 from public.production_orders r where r.id = p_order_id and r.status = 'in_progress'
  ) then
    perform private.advance_order(p_order_id, 'quality_check');
  end if;
end;
$$;

-- The next operation becomes "ready" once pieces reach it.
create function private.mark_next_ready(p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next uuid;
begin
  select nxt.id into v_next
  from public.production_order_operations me
  join public.production_order_operations nxt
    on nxt.order_id = me.order_id and nxt.archived_at is null and nxt.sequence > me.sequence
  where me.id = p_operation_id
  order by nxt.sequence
  limit 1;
  if v_next is not null and private.operation_arrived(v_next) and exists (
    select 1 from public.production_order_operations o where o.id = v_next and o.status = 'waiting'
  ) then
    perform private.set_operation_status_internal(v_next, 'ready');
  end if;
end;
$$;

-- Loads an operation for a floor action of the caller and checks who may
-- work on it. Raises fixed business-rule messages.
create function private.floor_work_operation(p_operation_id uuid)
returns table (
  op_row public.production_order_operations,
  order_row public.production_orders,
  employee_id uuid,
  is_inspection boolean,
  is_cutting boolean,
  is_external boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_order public.production_orders;
  v_type public.operation_types;
  v_employee uuid;
begin
  select * into v_op from public.production_order_operations o
  where o.id = p_operation_id and o.archived_at is null
  for update;
  if v_op.id is null
    or not exists (select 1 from private.user_org_ids() as x (id) where x.id = v_op.organization_id) then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  select * into v_order from public.production_orders r where r.id = v_op.order_id for update;
  select * into v_type from public.operation_types t where t.id = v_op.operation_type_id;

  v_employee := private.current_employee(v_op.organization_id);
  if v_employee is null then
    raise exception 'not_an_employee' using errcode = '42501';
  end if;
  if not private.employee_sees_operation(v_employee, v_op.id, v_op.machine_id) then
    raise exception 'operation not assigned to the caller' using errcode = '42501';
  end if;
  if v_type.is_inspection
    and not private.has_permission(v_op.organization_id, 'quality.inspect') then
    raise exception 'only inspectors report inspections' using errcode = '42501';
  end if;
  if v_type.is_external then
    raise exception 'operation_external' using errcode = '22023';
  end if;
  if v_type.is_cutting then
    raise exception 'cutting_uses_material_status' using errcode = '22023';
  end if;
  if v_order.status in ('completed', 'cancelled', 'archived') then
    raise exception 'order_closed' using errcode = '55000';
  end if;

  return query select v_op, v_order, v_employee, v_type.is_inspection, v_type.is_cutting, v_type.is_external;
end;
$$;

-- ---------------------------------------------------------------------------
-- Floor actions (SECURITY DEFINER: operators have no table writes; the rules
-- and the caller's right to the operation are checked here)
-- ---------------------------------------------------------------------------

-- Start or continue work: opens the caller's session, ends a pause, moves the
-- operation (and a ready order) to in progress and the machine to running.
create function public.start_operation_work(p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
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

-- Pause: ends the caller's session. When nobody else works on the operation,
-- it is paused with the reason (downtime event) and the machine stops.
create function public.pause_operation_work(
  p_operation_id uuid,
  p_reason_id uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
  v_reason text;
  v_notes text := nullif(btrim(p_notes), '');
begin
  select * into w from private.floor_work_operation(p_operation_id);

  select c.name into v_reason from public.catalog_items c
  where c.id = p_reason_id and c.organization_id = (w.op_row).organization_id
    and c.kind = 'downtime_reason' and c.archived_at is null;
  if v_reason is null then
    raise exception 'downtime_reason_required' using errcode = '22023';
  end if;
  if length(v_notes) > 500 then
    raise exception 'notes too long' using errcode = '22023';
  end if;

  update public.production_work_sessions set ended_at = now()
  where operation_id = p_operation_id and employee_id = w.employee_id and ended_at is null;
  if not found then
    raise exception 'no_open_session' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.production_work_sessions s
    where s.operation_id = p_operation_id and s.ended_at is null
  ) then
    insert into public.production_downtime_events (
      organization_id, order_id, operation_id, machine_id, employee_id, reason_id, notes
    ) values (
      (w.op_row).organization_id, (w.op_row).order_id, p_operation_id,
      (w.op_row).machine_id, w.employee_id, p_reason_id, v_notes
    );
    perform private.set_operation_status_internal(p_operation_id, 'paused', v_reason);
  end if;
  perform private.sync_machine_status((w.op_row).machine_id);
end;
$$;

-- Good / scrap of the caller on an operation they work on. p_finish also ends
-- the operation (all sessions and pauses), passes the pieces on and lets the
-- order advance. Idempotent by p_idempotency_key. Returns
-- {report_id (null without quantities), finished}.
create function public.report_operation_quantity(
  p_operation_id uuid,
  p_good numeric,
  p_scrap numeric,
  p_scrap_reason_id uuid,
  p_notes text,
  p_idempotency_key uuid,
  p_finish boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
  v_existing public.production_reports;
  v_good numeric := coalesce(p_good, 0);
  v_scrap numeric := coalesce(p_scrap, 0);
  v_notes text := nullif(btrim(p_notes), '');
  v_reported record;
  v_input numeric;
  v_report_id uuid;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select * into v_existing from public.production_reports r
  where r.idempotency_key = p_idempotency_key and r.operation_id = p_operation_id;
  if v_existing.id is not null then
    return jsonb_build_object('report_id', v_existing.id, 'finished',
      (select o.status = 'done' from public.production_order_operations o where o.id = p_operation_id));
  end if;

  select * into w from private.floor_work_operation(p_operation_id);

  if (w.op_row).status = 'done' then
    raise exception 'operation_done' using errcode = '55000';
  end if;
  if (w.op_row).status not in ('in_progress', 'paused') then
    raise exception 'operation_not_started' using errcode = '55000';
  end if;
  if v_good < 0 or v_scrap < 0 or v_good <> round(v_good, 3) or v_scrap <> round(v_scrap, 3) then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  if (w.order_row).unit in ('pcs', 'set') and (v_good <> trunc(v_good) or v_scrap <> trunc(v_scrap)) then
    raise exception 'whole_pieces_required' using errcode = '22023';
  end if;
  if v_good + v_scrap = 0 and not p_finish then
    raise exception 'quantity_required' using errcode = '22023';
  end if;
  if p_scrap_reason_id is not null and (v_scrap = 0 or not exists (
    select 1 from public.catalog_items c
    where c.id = p_scrap_reason_id and c.organization_id = (w.op_row).organization_id
      and c.kind = 'scrap_reason' and c.archived_at is null
  )) then
    raise exception 'invalid scrap reason' using errcode = '22023';
  end if;
  if length(v_notes) > 500 then
    raise exception 'notes too long' using errcode = '22023';
  end if;

  select * into v_reported from private.operation_reported(p_operation_id);
  v_input := private.operation_input(p_operation_id);
  if v_reported.good + v_reported.scrap + v_good + v_scrap > v_input then
    raise exception 'quantity_exceeds_input' using errcode = '22023';
  end if;
  if p_finish and v_reported.good + v_reported.scrap + v_good + v_scrap = 0 then
    raise exception 'nothing_reported' using errcode = '22023';
  end if;

  if v_good + v_scrap > 0 then
    insert into public.production_reports (
      organization_id, order_id, operation_id, employee_id, machine_id, good_quantity,
      scrap_quantity, scrap_reason_id, notes, idempotency_key
    ) values (
      (w.op_row).organization_id, (w.op_row).order_id, p_operation_id, w.employee_id,
      (w.op_row).machine_id, v_good, v_scrap, p_scrap_reason_id, v_notes, p_idempotency_key
    )
    returning id into v_report_id;
  end if;

  if p_finish then
    perform private.close_operation_work(p_operation_id);
    perform private.set_operation_status_internal(p_operation_id, 'done');
  end if;
  perform private.mark_next_ready(p_operation_id);
  if p_finish then
    perform private.after_operation_done((w.op_row).order_id);
  end if;

  return jsonb_build_object('report_id', v_report_id, 'finished', p_finish);
end;
$$;

-- "Ready for further processing" from the cutting worker / warehouse: records
-- the number of cut pieces, finishes the cutting operation and releases the
-- order (status ready). Idempotent by p_idempotency_key.
create function public.finish_cutting(
  p_order_id uuid,
  p_quantity numeric,
  p_idempotency_key uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_op public.production_order_operations;
  v_employee uuid;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.production_reports r
    where r.idempotency_key = p_idempotency_key and r.order_id = p_order_id
  ) then
    return;
  end if;

  select * into v_order from public.production_orders r where r.id = p_order_id for update;
  if v_order.id is null
    or not exists (select 1 from private.user_org_ids() as x (id) where x.id = v_order.organization_id) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if not (private.has_permission(v_order.organization_id, 'orders.manage')
    or private.has_permission(v_order.organization_id, 'orders.material.update')
    or private.is_cutting_worker(p_order_id)) then
    raise exception 'not allowed to report cutting' using errcode = '42501';
  end if;
  if not private.is_material_transition(v_order.status, 'ready') then
    raise exception 'invalid_status_transition' using errcode = '22023';
  end if;

  select o.* into v_op
  from public.production_order_operations o
  join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
  where o.order_id = p_order_id and o.archived_at is null and t.is_cutting and o.status <> 'done'
  order by o.sequence
  limit 1
  for update of o;
  if v_op.id is null then
    raise exception 'no_cutting_operation' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity <> round(p_quantity, 3)
    or p_quantity > 99999999999 then
    raise exception 'quantity_required' using errcode = '22023';
  end if;
  if v_order.unit in ('pcs', 'set') and p_quantity <> trunc(p_quantity) then
    raise exception 'whole_pieces_required' using errcode = '22023';
  end if;

  v_employee := private.current_employee(v_order.organization_id);
  insert into public.production_reports (
    organization_id, order_id, operation_id, employee_id, machine_id, good_quantity,
    scrap_quantity, idempotency_key
  ) values (
    v_order.organization_id, p_order_id, v_op.id, v_employee, v_op.machine_id, p_quantity, 0,
    p_idempotency_key
  );
  perform private.close_operation_work(v_op.id);
  if v_op.status in ('waiting', 'ready') then
    perform private.set_operation_status_internal(v_op.id, 'in_progress');
  end if;
  perform private.set_operation_status_internal(v_op.id, 'done');
  perform private.mark_next_ready(v_op.id);
  perform public.set_production_order_status(p_order_id, 'ready');
end;
$$;

-- Closing with fewer good pieces than ordered: asked by the inspector (or a
-- manager), decided by orders.close.approve.
create function public.request_order_close(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_reason text := nullif(btrim(p_reason), '');
  v_id uuid;
begin
  select * into v_order from public.production_orders r where r.id = p_order_id for update;
  if v_order.id is null
    or not exists (select 1 from private.user_org_ids() as x (id) where x.id = v_order.organization_id) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if not (private.has_permission(v_order.organization_id, 'quality.inspect')
    or private.has_permission(v_order.organization_id, 'orders.manage')) then
    raise exception 'not allowed to request closing' using errcode = '42501';
  end if;
  if v_order.status not in ('in_progress', 'paused', 'quality_check') then
    raise exception 'order_not_in_production' using errcode = '55000';
  end if;
  if v_reason is null then
    raise exception 'close_reason_required' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'reason too long' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.production_order_close_requests c
    where c.order_id = p_order_id and c.status = 'pending'
  ) then
    raise exception 'close_request_pending' using errcode = '55000';
  end if;

  insert into public.production_order_close_requests (organization_id, order_id, reason, good_quantity)
  values (v_order.organization_id, p_order_id, v_reason, private.order_good_quantity(p_order_id))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.decide_order_close(p_request_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.production_order_close_requests;
  v_note text := nullif(btrim(p_note), '');
begin
  select * into v_request from public.production_order_close_requests c
  where c.id = p_request_id for update;
  if v_request.id is null
    or not exists (select 1 from private.user_org_ids() as x (id) where x.id = v_request.organization_id) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not private.has_permission(v_request.organization_id, 'orders.close.approve') then
    raise exception 'missing permission orders.close.approve' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'close_request_decided' using errcode = '55000';
  end if;
  if length(v_note) > 500 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  if not p_approve and v_note is null then
    raise exception 'reject_note_required' using errcode = '22023';
  end if;

  update public.production_order_close_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(),
    decided_at = now(),
    decision_note = v_note
  where id = p_request_id;

  if p_approve then
    if exists (
      select 1 from public.production_orders r
      where r.id = v_request.order_id and r.status not in ('in_progress', 'paused', 'quality_check')
    ) then
      raise exception 'order_not_in_production' using errcode = '55000';
    end if;
    perform private.advance_order(v_request.order_id, 'completed');
  end if;
end;
$$;

-- Wrong report: a manager voids it with a reason (the row stays).
create function public.void_production_report(p_report_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.production_reports;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select * into v_report from public.production_reports r where r.id = p_report_id for update;
  if v_report.id is null
    or not exists (select 1 from private.user_org_ids() as x (id) where x.id = v_report.organization_id) then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(v_report.organization_id);
  if v_report.voided_at is not null then
    return;
  end if;
  if exists (
    select 1 from public.production_orders r
    where r.id = v_report.order_id and r.status in ('completed', 'cancelled', 'archived')
  ) then
    raise exception 'order_closed' using errcode = '55000';
  end if;
  if v_reason is null then
    raise exception 'void_reason_required' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'reason too long' using errcode = '22023';
  end if;
  update public.production_reports set
    voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_report_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Order status: cutting operation and closing work follow the order
-- (replaces the function from 20261025100000; same rules plus:)
--   * "cutting" starts the cutting operation (and the caller's session);
--   * "waiting_material" from cutting pauses it;
--   * "ready" needs the cut quantity while a cutting operation is open
--     (finish_cutting);
--   * completing / cancelling ends all open work.
-- ---------------------------------------------------------------------------
create or replace function public.set_production_order_status(
  p_order_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_reason text := nullif(btrim(p_reason), '');
  v_cut public.production_order_operations;
  v_employee uuid;
begin
  select * into v_order from public.production_orders r where r.id = p_order_id for update;
  if v_order.id is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = v_order.organization_id) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status = p_status then
    return;
  end if;
  if not private.order_transition_allowed(v_order.status, p_status) then
    raise exception 'invalid_status_transition' using errcode = '22023';
  end if;

  if not private.has_permission(v_order.organization_id, 'orders.manage')
    and not (
      private.is_material_transition(v_order.status, p_status)
      and (private.has_permission(v_order.organization_id, 'orders.material.update')
        or private.is_cutting_worker(p_order_id))
    ) then
    raise exception 'not allowed to change the status of this order' using errcode = '42501';
  end if;

  if p_status = 'cancelled' and v_reason is null then
    raise exception 'cancel_reason_required' using errcode = '22023';
  end if;
  if p_status = 'completed' and not private.order_completion_allowed(p_order_id) then
    raise exception 'completion_requires_production_report' using errcode = '22023';
  end if;
  if p_status in ('ready', 'in_progress') and exists (
    select 1
    from public.production_order_operations o
    join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
    where o.order_id = p_order_id and o.archived_at is null and o.machine_id is null
      and not t.is_external and not t.is_inspection
  ) then
    raise exception 'machine_assignment_missing' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'reason too long' using errcode = '22023';
  end if;

  select o.* into v_cut
  from public.production_order_operations o
  join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
  where o.order_id = p_order_id and o.archived_at is null and t.is_cutting and o.status <> 'done'
  order by o.sequence
  limit 1;

  if p_status = 'ready' and v_cut.id is not null then
    raise exception 'cut_quantity_required' using errcode = '22023';
  end if;

  if p_status in ('completed', 'cancelled') then
    perform private.close_order_work(p_order_id);
  end if;

  update public.production_orders
  set status = p_status,
    cancel_reason = case when p_status = 'cancelled' then v_reason else cancel_reason end
  where id = p_order_id;

  insert into public.production_order_status_history (
    organization_id, order_id, from_status, to_status, reason
  ) values (v_order.organization_id, p_order_id, v_order.status, p_status, v_reason);

  if v_cut.id is not null and p_status = 'cutting' then
    perform private.set_operation_status_internal(v_cut.id, 'in_progress');
    v_employee := private.current_employee(v_order.organization_id);
    if v_employee is not null and private.employee_sees_operation(v_employee, v_cut.id, v_cut.machine_id)
      and not exists (
        select 1 from public.production_work_sessions s
        where s.operation_id = v_cut.id and s.employee_id = v_employee and s.ended_at is null
      ) then
      insert into public.production_work_sessions (
        organization_id, order_id, operation_id, employee_id, machine_id
      ) values (v_order.organization_id, p_order_id, v_cut.id, v_employee, v_cut.machine_id);
    end if;
    perform private.sync_machine_status(v_cut.machine_id);
  elsif v_cut.id is not null and p_status = 'waiting_material' and v_cut.status = 'in_progress' then
    perform private.close_operation_work(v_cut.id);
    perform private.set_operation_status_internal(v_cut.id, 'paused', v_reason);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Floor reads
-- ---------------------------------------------------------------------------
-- Same as before, plus quantities and whether the caller is working on it.
-- Without p_machine_id: operations assigned to the caller by name and
-- (inspectors) unassigned inspections.
drop function public.floor_operation_queue(uuid, uuid);

create function public.floor_operation_queue(p_org_id uuid, p_machine_id uuid default null)
returns table (
  operation_id uuid,
  order_id uuid,
  order_number text,
  order_status text,
  effective_priority smallint,
  due_date date,
  due_warning text,
  quantity numeric,
  unit text,
  part_number text,
  product_name text,
  revision text,
  sequence integer,
  operation_code text,
  operation_name text,
  description text,
  status text,
  machine_code text,
  is_cutting boolean,
  is_inspection boolean,
  planned_seconds numeric,
  previous_code text,
  previous_status text,
  assigned_by_name boolean,
  arrived boolean,
  input_quantity numeric,
  good_quantity numeric,
  scrap_quantity numeric,
  working boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select private.current_employee(p_org_id) as employee_id)
  select o.id, r.id, r.order_number, r.status, s.effective_priority, r.due_date, s.due_warning,
    r.quantity, r.unit, p.part_number, p.name, rv.revision, o.sequence, t.code, t.name,
    o.description, o.status, m.code, t.is_cutting, t.is_inspection,
    coalesce(o.setup_time_min, 0) * 60 + coalesce(o.cycle_time_s, 0) * r.quantity,
    prev.code, prev.status,
    exists (
      select 1 from public.production_order_operation_workers w
      where w.operation_id = o.id and w.employee_id = me.employee_id
    ),
    private.operation_arrived(o.id),
    private.operation_input(o.id),
    rep.good,
    rep.scrap,
    exists (
      select 1 from public.production_work_sessions ws
      where ws.operation_id = o.id and ws.employee_id = me.employee_id and ws.ended_at is null
    )
  from me
  join public.production_order_operations o on o.organization_id = p_org_id
  join public.production_orders r on r.id = o.order_id
  join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
  join public.products p on p.id = r.product_id
  left join public.product_revisions rv on rv.id = r.revision_id
  left join public.machines m on m.id = o.machine_id
  cross join lateral private.order_schedule(r.id) s
  cross join lateral private.operation_reported(o.id) rep
  left join lateral (
    select pt.code, po.status
    from public.production_order_operations po
    join public.operation_types pt on pt.id = po.operation_type_id
    where po.order_id = o.order_id and po.archived_at is null and po.sequence < o.sequence
    order by po.sequence desc
    limit 1
  ) prev on true
  where me.employee_id is not null
    and o.archived_at is null
    and o.status <> 'done'
    and private.floor_order_status(r.status)
    and private.employee_sees_operation(me.employee_id, o.id, o.machine_id)
    and (
      (p_machine_id is null and (
        o.machine_id is null
        or exists (
          select 1 from public.production_order_operation_workers w
          where w.operation_id = o.id and w.employee_id = me.employee_id
        )
      ))
      or o.machine_id = p_machine_id
    )
  order by s.effective_priority, r.due_date, r.order_number, o.sequence
$$;

-- Work state of one operation for the caller (null when they do not see it):
-- quantities, who is working, the open pause and what the caller may do.
create function public.floor_operation_work(p_operation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_order public.production_orders;
  v_type public.operation_types;
  v_employee uuid;
  v_reported record;
  v_input numeric;
  v_blocked text;
  v_is_last boolean;
begin
  select * into v_op from public.production_order_operations o where o.id = p_operation_id;
  if v_op.id is null or not private.can_view_order_operation(p_operation_id) then
    return null;
  end if;
  select * into v_order from public.production_orders r where r.id = v_op.order_id;
  select * into v_type from public.operation_types t where t.id = v_op.operation_type_id;
  v_employee := private.current_employee(v_op.organization_id);
  select * into v_reported from private.operation_reported(p_operation_id);
  v_input := private.operation_input(p_operation_id);
  v_is_last := private.last_operation(v_order.id) = p_operation_id;

  v_blocked := case
    when v_type.is_external then 'operation_external'
    when v_type.is_cutting then 'cutting_uses_material_status'
    when v_employee is null then 'not_an_employee'
    when not private.employee_sees_operation(v_employee, v_op.id, v_op.machine_id) then 'not_assigned'
    when v_type.is_inspection and not private.has_permission(v_op.organization_id, 'quality.inspect')
      then 'not_assigned'
    when v_order.status in ('completed', 'cancelled', 'archived') then 'order_closed'
    when v_op.status = 'done' then 'operation_done'
    when v_order.status = 'paused' then 'order_paused'
    when v_order.status not in ('ready', 'in_progress', 'quality_check') then 'order_not_ready'
    when not private.operation_arrived(p_operation_id) then 'not_arrived'
  end;

  return jsonb_build_object(
    'input_quantity', v_input,
    'good_quantity', v_reported.good,
    'scrap_quantity', v_reported.scrap,
    'remaining_quantity', greatest(v_input - v_reported.good - v_reported.scrap, 0),
    'blocked', v_blocked,
    'working', v_employee is not null and exists (
      select 1 from public.production_work_sessions s
      where s.operation_id = p_operation_id and s.employee_id = v_employee and s.ended_at is null
    ),
    'workers_now', coalesce((
      select jsonb_agg(e.first_name || ' ' || e.last_name order by s.started_at)
      from public.production_work_sessions s
      join public.employees e on e.id = s.employee_id
      where s.operation_id = p_operation_id and s.ended_at is null
    ), '[]'::jsonb),
    'pause', (
      select jsonb_build_object('reason', c.name, 'since', d.started_at, 'notes', d.notes)
      from public.production_downtime_events d
      join public.catalog_items c on c.id = d.reason_id
      where d.operation_id = p_operation_id and d.ended_at is null
    ),
    'is_last', v_is_last,
    'order_good_quantity', private.order_good_quantity(v_order.id),
    'close_request', (
      select jsonb_build_object('status', c.status, 'reason', c.reason, 'decision_note', c.decision_note)
      from public.production_order_close_requests c
      where c.order_id = v_order.id
      order by c.requested_at desc
      limit 1
    ),
    'can_request_close', v_order.status in ('in_progress', 'paused', 'quality_check')
      and (private.has_permission(v_op.organization_id, 'quality.inspect')
        or private.has_permission(v_op.organization_id, 'orders.manage'))
      and v_type.is_inspection
      and not exists (
        select 1 from public.production_order_close_requests c
        where c.order_id = v_order.id and c.status = 'pending'
      )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Management reads (SECURITY DEFINER with their own orders.read check:
-- worker names without employees.read)
-- ---------------------------------------------------------------------------
create function public.production_order_reports(p_order_id uuid)
returns table (
  id uuid,
  reported_at timestamptz,
  operation_id uuid,
  operation_code text,
  operation_sequence integer,
  employee_name text,
  username text,
  machine_code text,
  good_quantity numeric,
  scrap_quantity numeric,
  scrap_reason text,
  notes text,
  voided_at timestamptz,
  void_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select rp.id, rp.reported_at, rp.operation_id, t.code, o.sequence,
    e.first_name || ' ' || e.last_name, pf.username, m.code, rp.good_quantity, rp.scrap_quantity,
    c.name, rp.notes, rp.voided_at, rp.void_reason
  from public.production_reports rp
  join public.production_orders r on r.id = rp.order_id
  join public.production_order_operations o on o.id = rp.operation_id
  join public.operation_types t on t.id = o.operation_type_id
  left join public.employees e on e.id = rp.employee_id
  left join public.profiles pf on pf.id = rp.reported_by and pf.organization_id = rp.organization_id
  left join public.machines m on m.id = rp.machine_id
  left join public.catalog_items c on c.id = rp.scrap_reason_id
  where rp.order_id = p_order_id
    and private.has_permission(r.organization_id, 'orders.read')
  order by rp.reported_at desc, rp.id
$$;

create function public.production_order_downtime(p_order_id uuid)
returns table (
  id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  operation_code text,
  operation_sequence integer,
  machine_code text,
  employee_name text,
  reason text,
  notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.started_at, d.ended_at, t.code, o.sequence, m.code,
    e.first_name || ' ' || e.last_name, c.name, d.notes
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

-- Close requests with user names.
create function public.production_order_close_log(p_order_id uuid)
returns table (
  id uuid,
  status text,
  reason text,
  good_quantity numeric,
  requested_at timestamptz,
  requested_by_name text,
  decided_at timestamptz,
  decided_by_name text,
  decision_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.status, c.reason, c.good_quantity, c.requested_at,
    coalesce(rq.full_name, rq.username), c.decided_at, coalesce(dc.full_name, dc.username),
    c.decision_note
  from public.production_order_close_requests c
  join public.production_orders r on r.id = c.order_id
  left join public.profiles rq on rq.id = c.requested_by and rq.organization_id = c.organization_id
  left join public.profiles dc on dc.id = c.decided_by and dc.organization_id = c.organization_id
  where c.order_id = p_order_id
    and private.has_permission(r.organization_id, 'orders.read')
  order by c.requested_at desc
$$;

-- Operations with their production figures (appended columns).
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
  private.operation_downtime_seconds(o.id) as downtime_seconds
from public.production_order_operations o
join public.production_orders r on r.id = o.order_id and r.organization_id = o.organization_id
left join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
left join public.catalog_items mt on mt.id = o.machine_type_id and mt.organization_id = o.organization_id
left join public.machines m on m.id = o.machine_id and m.organization_id = o.organization_id
cross join lateral private.operation_reported(o.id) rep;

-- Orders with finished good pieces and whether they may be completed (appended).
create or replace view public.production_order_directory
with (security_invoker = true)
as
select
  r.id,
  r.organization_id,
  r.order_number,
  r.order_year,
  r.order_sequence,
  r.status,
  r.priority,
  r.due_date,
  r.planned_start,
  r.planned_end,
  r.quantity,
  r.unit,
  r.notes,
  r.created_at,
  r.status_changed_at,
  r.archived_at,
  r.customer_id,
  c.name as customer_name,
  c.customer_number,
  r.product_id,
  p.part_number,
  p.name as product_name,
  r.revision_id,
  rv.revision,
  s.planned_seconds,
  s.remaining_seconds,
  s.days_to_due,
  s.slack_days,
  s.computed_priority,
  s.effective_priority,
  s.started,
  s.due_warning,
  s.due_warning_days,
  (
    select coalesce(array_agg(distinct o.machine_id) filter (where o.machine_id is not null), '{}')
    from public.production_order_operations o
    where o.order_id = r.id and o.archived_at is null
  ) as machine_ids,
  (
    select count(*)::integer from public.production_order_operations o
    where o.order_id = r.id and o.archived_at is null
  ) as operation_count,
  (
    select count(*)::integer from public.production_order_operations o
    where o.order_id = r.id and o.archived_at is null and o.status = 'done'
  ) as operations_done,
  private.order_good_quantity(r.id) as good_quantity,
  private.order_completion_allowed(r.id) as completion_allowed,
  exists (
    select 1 from public.production_order_close_requests cr
    where cr.order_id = r.id and cr.status = 'pending'
  ) as close_request_pending
from public.production_orders r
left join public.customers c on c.id = r.customer_id and c.organization_id = r.organization_id
left join public.products p on p.id = r.product_id and p.organization_id = r.organization_id
left join public.product_revisions rv on rv.id = r.revision_id and rv.organization_id = r.organization_id
cross join lateral private.order_schedule(r.id) s;

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------
revoke all on
  public.production_reports, public.production_work_sessions,
  public.production_downtime_events, public.production_order_close_requests
from anon, authenticated;
grant select on
  public.production_reports, public.production_work_sessions,
  public.production_downtime_events, public.production_order_close_requests
to authenticated;

alter table public.production_reports enable row level security;
alter table public.production_work_sessions enable row level security;
alter table public.production_downtime_events enable row level security;
alter table public.production_order_close_requests enable row level security;

-- Written only by the functions above (no insert/update grants).
create policy production_reports_select on public.production_reports
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));
create policy production_work_sessions_select on public.production_work_sessions
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));
create policy production_downtime_events_select on public.production_downtime_events
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));
create policy production_order_close_requests_select on public.production_order_close_requests
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.seed_organization_reasons()',
    'private.operation_reported(uuid)',
    'private.previous_operation(uuid)',
    'private.operation_input(uuid)',
    'private.last_operation(uuid)',
    'private.order_good_quantity(uuid)',
    'private.operation_run_seconds(uuid)',
    'private.operation_worker_seconds(uuid)',
    'private.operation_downtime_seconds(uuid)',
    'private.set_operation_status_internal(uuid, text, text)',
    'private.advance_order(uuid, text)',
    'private.sync_machine_status(uuid)',
    'private.close_operation_work(uuid)',
    'private.close_order_work(uuid)',
    'private.after_operation_done(uuid)',
    'private.mark_next_ready(uuid)',
    'private.floor_work_operation(uuid)'
  ] loop
    execute format('revoke execute on function %s from public', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.start_operation_work(uuid)',
    'public.pause_operation_work(uuid, uuid, text)',
    'public.report_operation_quantity(uuid, numeric, numeric, uuid, text, uuid, boolean)',
    'public.finish_cutting(uuid, numeric, uuid)',
    'public.request_order_close(uuid, text)',
    'public.decide_order_close(uuid, boolean, text)',
    'public.void_production_report(uuid, text)',
    'public.floor_operation_queue(uuid, uuid)',
    'public.floor_operation_work(uuid)',
    'public.production_order_reports(uuid)',
    'public.production_order_downtime(uuid)',
    'public.production_order_close_log(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
