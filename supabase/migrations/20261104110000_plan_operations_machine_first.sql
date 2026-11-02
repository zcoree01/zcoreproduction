-- plan_operations (20261104100000) wrote the operators before the machine,
-- so an operator qualified only for the new machine was refused
-- (worker_not_qualified checks against the operation's machine). Now the
-- machine is set first; operators kept on a machine change must be
-- qualified for the new machine as well.
create or replace function public.plan_operations(p_org_id uuid, p_moves jsonb)
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
    if v_day is not null and (v_position is null or v_position not between 1 and 100000) then
      raise exception 'invalid_moves' using errcode = '22023';
    end if;
    if v_day is not null and v_machine_id is null then
      raise exception 'machine not found' using errcode = 'P0002';
    end if;

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
      update public.production_order_operations set machine_id = v_machine_id where id = v_op.id;
    end if;

    if v_move ? 'employee_ids' then
      v_employees := array(
        select distinct e::uuid from jsonb_array_elements_text(v_move -> 'employee_ids') as e
      );
      delete from public.production_order_operation_workers w
      where w.operation_id = v_op.id and w.employee_id <> all (v_employees);
      -- The insert trigger checks active, same organization and qualified.
      insert into public.production_order_operation_workers (organization_id, operation_id, employee_id)
      select p_org_id, v_op.id, e from unnest(v_employees) as e
      on conflict (operation_id, employee_id) do nothing;
      if exists (
        select 1 from unnest(v_employees) as e (id)
        where not exists (
          select 1 from public.employee_machines em
          where em.employee_id = e.id and em.machine_id = v_machine_id
        )
      ) then
        raise exception 'worker_not_qualified' using errcode = '23514';
      end if;
    elsif v_machine_id is distinct from v_op.machine_id and exists (
      select 1 from public.production_order_operation_workers w
      where w.operation_id = v_op.id and not exists (
        select 1 from public.employee_machines em
        where em.employee_id = w.employee_id and em.machine_id = v_machine_id
      )
    ) then
      raise exception 'worker_not_qualified' using errcode = '23514';
    end if;

    if v_day is not null and not exists (
      select 1 from public.production_order_operation_workers w where w.operation_id = v_op.id
    ) then
      raise exception 'operator_required' using errcode = '23514';
    end if;

    update public.production_order_operations set
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
      and ((plan_day, plan_position) is distinct from
          (v_day, case when v_day is null then null else v_position end)
        or v_machine_id is distinct from v_op.machine_id);
  end loop;
end;
$$;
