-- Follow-up to 20261026100000_production_reporting (D-018).
--
-- 1. Orders released before production reporting existed reached "ready"
--    (or later) without the cutting operation being finished. Pieces now flow
--    from operation to operation, so such cutting operations are closed here
--    (no quantity: the ordered quantity passes on to the next operation).
-- 2. An operation set to "done" by hand (head of production, e.g. external
--    work) ends open work, passes the pieces on and lets the order advance,
--    like a finish reported on the floor.

with stale as (
  select o.id, o.organization_id, o.order_id, o.status
  from public.production_order_operations o
  join public.production_orders r on r.id = o.order_id
  join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
  where t.is_cutting
    and o.archived_at is null
    and o.status <> 'done'
    and r.status in ('ready', 'in_progress', 'paused', 'quality_check')
),
history as (
  insert into public.production_order_status_history (
    organization_id, order_id, operation_id, from_status, to_status, reason
  )
  select s.organization_id, s.order_id, s.id, s.status, 'done',
    'Zatvoreno pri uvođenju prijave proizvodnje (nalog je već bio spreman).'
  from stale s
)
update public.production_order_operations o
set status = 'done'
from stale s
where o.id = s.id;

create or replace function public.set_order_operation_status(p_operation_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_order_status text;
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
  if not private.operation_transition_allowed(v_op.status, p_status) then
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
