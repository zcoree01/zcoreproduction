-- Shop floor, after the first product owner review (D-017):
--   * one QR code per order (not per operation): /floor/orders/<id> shows the
--     caller which of the order's operations is theirs;
--   * "arrived": an operation has reached its machine when every earlier
--     operation of the order is done (the first one when the order is released).

-- Every earlier active operation of the order is done.
create function private.operation_arrived(p_operation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.production_order_operations me
    join public.production_order_operations earlier
      on earlier.order_id = me.order_id
      and earlier.archived_at is null
      and earlier.sequence < me.sequence
      and earlier.status <> 'done'
    where me.id = p_operation_id
  )
$$;

revoke execute on function private.operation_arrived(uuid) from public;
grant execute on function private.operation_arrived(uuid) to authenticated;

-- Same as before, plus "arrived".
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
  arrived boolean
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
    private.operation_arrived(o.id)
  from me
  join public.production_order_operations o on o.organization_id = p_org_id
  join public.production_orders r on r.id = o.order_id
  join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
  join public.products p on p.id = r.product_id
  left join public.product_revisions rv on rv.id = r.revision_id
  left join public.machines m on m.id = o.machine_id
  cross join lateral private.order_schedule(r.id) s
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
      (p_machine_id is null and exists (
        select 1 from public.production_order_operation_workers w
        where w.operation_id = o.id and w.employee_id = me.employee_id
      ))
      or o.machine_id = p_machine_id
    )
  order by s.effective_priority, r.due_date, r.order_number, o.sequence
$$;

revoke execute on function public.floor_operation_queue(uuid, uuid) from public, anon;
grant execute on function public.floor_operation_queue(uuid, uuid) to authenticated;

-- One order for the floor (target of the order's QR code): the order and its
-- operations, each marked whether the caller sees it and whether it arrived.
-- Null when the order is not in the caller's organization, or is not on the
-- floor yet (draft, closed) and the caller cannot read orders.
create function public.floor_order(p_order_id uuid)
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
        'status', o.status, 'machine_code', m.code,
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

revoke execute on function public.floor_order(uuid) from public, anon;
grant execute on function public.floor_order(uuid) to authenticated;
