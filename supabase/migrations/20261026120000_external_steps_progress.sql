-- Product owner review of production reporting (D-019):
--   1. External operations (work done by another company) only move through
--      the head of production's steps: waiting → "priprema za isporuku"
--      (ready) → "isporučeno" (in_progress) → "primljeno" (done). No pause.
--   2. Progress per order (percent and the operation it has reached) for the
--      customer page and the order list.
--   3. Pending requests to close with a shortage, for the approvers'
--      notification bell.

-- ---------------------------------------------------------------------------
-- External operations
-- ---------------------------------------------------------------------------
-- Mirrored by EXTERNAL_OPERATION_TRANSITIONS in status-rules.ts.
create function private.external_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('waiting', 'ready'), ('ready', 'waiting'), ('ready', 'in_progress'),
    ('in_progress', 'ready'), ('in_progress', 'done'), ('done', 'in_progress')
  )
$$;

revoke execute on function private.external_transition_allowed(text, text) from public;
grant execute on function private.external_transition_allowed(text, text) to authenticated;

create or replace function public.set_order_operation_status(p_operation_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_order_status text;
  v_external boolean;
begin
  select * into v_op from public.production_order_operations o
  where o.id = p_operation_id and o.archived_at is null
  for update;
  if v_op.id is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = v_op.organization_id) then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(v_op.organization_id);

  if v_op.status = p_status then
    return;
  end if;
  select t.is_external into v_external from public.operation_types t where t.id = v_op.operation_type_id;
  if (v_external and not private.external_transition_allowed(v_op.status, p_status))
    or (not v_external and not private.operation_transition_allowed(v_op.status, p_status)) then
    raise exception 'invalid_status_transition' using errcode = '22023';
  end if;
  select r.status into v_order_status from public.production_orders r where r.id = v_op.order_id;
  if v_order_status in ('draft', 'completed', 'cancelled', 'archived') then
    raise exception 'order_not_released' using errcode = '55000';
  end if;

  if p_status = 'done' then
    perform private.close_operation_work(p_operation_id);
  end if;

  update public.production_order_operations set status = p_status where id = p_operation_id;

  insert into public.production_order_status_history (
    organization_id, order_id, operation_id, from_status, to_status
  ) values (v_op.organization_id, v_op.order_id, p_operation_id, v_op.status, p_status);

  if p_status = 'done' then
    perform private.mark_next_ready(p_operation_id);
    perform private.after_operation_done(v_op.order_id);
  end if;
end;
$$;

-- Floor screens label external steps too: operations carry is_external.
create or replace function public.floor_order(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', r.id, 'order_number', r.order_number, 'status', r.status,
      'quantity', r.quantity, 'unit', r.unit, 'due_date', r.due_date,
      'effective_priority', s.effective_priority,
      'part_number', p.part_number, 'product_name', p.name, 'revision', rv.revision
    ),
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'sequence', o.sequence, 'code', t.code, 'name', t.name,
        'status', o.status, 'machine_code', m.code, 'is_external', t.is_external,
        'mine', private.can_view_order_operation(o.id),
        'arrived', private.operation_arrived(o.id)
      ) order by o.sequence)
      from public.production_order_operations o
      join public.operation_types t on t.id = o.operation_type_id
      left join public.machines m on m.id = o.machine_id
      where o.order_id = r.id and o.archived_at is null
    ), '[]'::jsonb)
  )
  from public.production_orders r
  join public.products p on p.id = r.product_id
  left join public.product_revisions rv on rv.id = r.revision_id
  cross join lateral private.order_schedule(r.id) s
  where r.id = p_order_id
    and r.organization_id in (select private.user_org_ids())
    and (private.floor_order_status(r.status)
      or private.has_permission(r.organization_id, 'orders.read'))
$$;

create or replace function public.floor_operation(p_operation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_order public.production_orders;
  v_current jsonb;
begin
  select * into v_op from public.production_order_operations o where o.id = p_operation_id;
  if v_op.id is null
    or not exists (select 1 from private.user_org_ids() as x (id) where x.id = v_op.organization_id) then
    return null;
  end if;
  select * into v_order from public.production_orders r where r.id = v_op.order_id;

  -- First operation that is not done: where the work is now.
  select jsonb_build_object('code', t.code, 'name', t.name, 'sequence', o.sequence,
      'status', o.status, 'machine_code', m.code, 'machine_name', m.name,
      'is_external', t.is_external)
  into v_current
  from public.production_order_operations o
  join public.operation_types t on t.id = o.operation_type_id
  left join public.machines m on m.id = o.machine_id
  where o.order_id = v_order.id and o.archived_at is null and o.status <> 'done'
  order by o.sequence
  limit 1;

  if not private.can_view_order_operation(p_operation_id) then
    return jsonb_build_object(
      'visible', false,
      'order_number', v_order.order_number,
      'current', v_current
    );
  end if;

  return jsonb_build_object(
    'visible', true,
    'current', v_current,
    'order', (
      select jsonb_build_object(
        'id', r.id, 'order_number', r.order_number, 'status', r.status,
        'quantity', r.quantity, 'unit', r.unit, 'due_date', r.due_date, 'notes', r.notes,
        'effective_priority', s.effective_priority, 'due_warning', s.due_warning,
        'piece_length_mm', r.piece_length_mm, 'kerf_mm', r.kerf_mm,
        'bar_length_mm', r.bar_length_mm, 'bar_remnant_mm', r.bar_remnant_mm,
        'part_number', p.part_number, 'product_name', p.name, 'revision', rv.revision,
        'drawing_number', rv.drawing_number, 'material', mat.designation,
        'can_set_material', private.is_cutting_worker(r.id)
          or private.has_permission(r.organization_id, 'orders.material.update')
          or private.has_permission(r.organization_id, 'orders.manage')
      )
      from public.production_orders r
      join public.products p on p.id = r.product_id
      left join public.product_revisions rv on rv.id = r.revision_id
      left join public.materials mat on mat.id = rv.material_id
      cross join lateral private.order_schedule(r.id) s
      where r.id = v_order.id
    ),
    'operation', (
      select jsonb_build_object(
        'id', o.id, 'sequence', o.sequence, 'code', t.code, 'name', t.name,
        'description', o.description, 'status', o.status, 'notes', o.notes,
        'is_cutting', t.is_cutting, 'is_inspection', t.is_inspection, 'is_external', t.is_external,
        'machine_code', m.code, 'machine_name', m.name, 'external_company', o.external_company,
        'setup_time_min', o.setup_time_min, 'cycle_time_s', o.cycle_time_s,
        'planned_seconds', coalesce(o.setup_time_min, 0) * 60 + coalesce(o.cycle_time_s, 0) * v_order.quantity,
        'planned_start', o.planned_start, 'planned_end', o.planned_end,
        'workers', coalesce((
          select jsonb_agg(e.first_name || ' ' || e.last_name order by e.last_name, e.first_name)
          from public.production_order_operation_workers w
          join public.employees e on e.id = w.employee_id
          where w.operation_id = o.id
        ), '[]'::jsonb)
      )
      from public.production_order_operations o
      join public.operation_types t on t.id = o.operation_type_id
      left join public.machines m on m.id = o.machine_id
      where o.id = p_operation_id
    ),
    'operations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'sequence', o.sequence, 'code', t.code, 'name', t.name,
        'status', o.status, 'machine_code', m.code, 'is_external', t.is_external
      ) order by o.sequence), '[]'::jsonb)
      from public.production_order_operations o
      join public.operation_types t on t.id = o.operation_type_id
      left join public.machines m on m.id = o.machine_id
      where o.order_id = v_order.id and o.archived_at is null
    ),
    -- Drawings of the order; machine drawings only for this operation (or for none).
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'title', a.title, 'file_name', a.file_name,
        'content_type', a.content_type, 'for_operation', a.operation_id is not null
      ) order by (a.kind <> 'main_drawing'), a.created_at), '[]'::jsonb)
      from public.production_order_attachments oa
      join public.product_attachments a on a.id = oa.attachment_id
      where oa.order_id = v_order.id and oa.archived_at is null
        and (a.kind <> 'machine_drawing' or a.operation_id is null
          or a.operation_id = v_op.source_operation_id)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Progress (mirrored by orderProgress() in src/modules/production-reporting/rules.ts)
-- Every active operation counts equally: done = 1, otherwise reported pieces
-- (good + scrap) / ordered quantity (at most 1); an external operation that
-- was shipped counts half. Completed orders are 100 %.
-- ---------------------------------------------------------------------------
create function private.order_progress(p_order_id uuid)
returns table (
  progress_percent integer,
  current_operation_code text,
  current_operation_name text,
  current_machine_code text,
  current_operation_external boolean,
  current_operation_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select o.id, o.status, o.quantity from public.production_orders o where o.id = p_order_id
  ),
  ops as (
    select op.sequence, op.status, t.code, t.name, t.is_external, m.code as machine_code,
      case
        when op.status = 'done' then 1::numeric
        when t.is_external and op.status = 'in_progress' then 0.5
        else least(1, (rep.good + rep.scrap) / nullif(r.quantity, 0))
      end as fraction
    from r
    join public.production_order_operations op on op.order_id = r.id and op.archived_at is null
    join public.operation_types t on t.id = op.operation_type_id
    left join public.machines m on m.id = op.machine_id
    cross join lateral private.operation_reported(op.id) rep
  ),
  cur as (
    select * from ops where ops.status <> 'done' order by ops.sequence limit 1
  )
  select
    case
      when (select r.status from r) = 'completed' then 100
      else coalesce(floor(100 * (select avg(ops.fraction) from ops))::integer, 0)
    end,
    (select cur.code from cur),
    (select cur.name from cur),
    (select cur.machine_code from cur),
    (select cur.is_external from cur),
    (select cur.status from cur)
$$;

revoke execute on function private.order_progress(uuid) from public;
grant execute on function private.order_progress(uuid) to authenticated;

-- Same as 20261026100000 plus progress columns (appended).
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
  ) as close_request_pending,
  pr.progress_percent,
  pr.current_operation_code,
  pr.current_operation_name,
  pr.current_machine_code,
  pr.current_operation_external,
  pr.current_operation_status
from public.production_orders r
left join public.customers c on c.id = r.customer_id and c.organization_id = r.organization_id
left join public.products p on p.id = r.product_id and p.organization_id = r.organization_id
left join public.product_revisions rv on rv.id = r.revision_id and rv.organization_id = r.organization_id
cross join lateral private.order_schedule(r.id) s
cross join lateral private.order_progress(r.id) pr;

-- ---------------------------------------------------------------------------
-- Notifications: pending requests to close with a shortage, for approvers
-- ---------------------------------------------------------------------------
create function public.pending_close_requests(p_org_id uuid)
returns table (
  request_id uuid,
  order_id uuid,
  order_number text,
  reason text,
  good_quantity numeric,
  quantity numeric,
  unit text,
  requested_at timestamptz,
  requested_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, r.id, r.order_number, c.reason, c.good_quantity, r.quantity, r.unit,
    c.requested_at, coalesce(pf.full_name, pf.username)
  from public.production_order_close_requests c
  join public.production_orders r on r.id = c.order_id
  left join public.profiles pf on pf.id = c.requested_by and pf.organization_id = c.organization_id
  where c.organization_id = p_org_id
    and c.status = 'pending'
    and private.has_permission(p_org_id, 'orders.close.approve')
  order by c.requested_at
$$;

revoke execute on function public.pending_close_requests(uuid) from public, anon;
grant execute on function public.pending_close_requests(uuid) to authenticated;
