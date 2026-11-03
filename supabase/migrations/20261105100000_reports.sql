-- Phase 5 e: reports (D-043).
--   * reports.read (production): production output and efficiency, machines
--     and downtime, orders and due dates, material / tool consumption and
--     costs. Admin, director and head of production by default.
--   * machines.hourly_rate (KM per machine hour): the machine cost of an
--     order = machine running hours × hourly rate.
--   * report_* functions return facts already split by local day (the
--     organization's time zone) and by machine / worker / order / operation;
--     the app groups and filters them (src/modules/reports). They run as
--     definer behind reports.read, so the report also shows material values
--     to a head of production without inventory rights.

insert into public.permissions (key, module_key, description, default_roles) values
  ('reports.read', 'production', 'View production, machine, order and cost reports',
    '{admin,director,head_of_production}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.key = 'reports.read'
on conflict do nothing;

alter table public.machines
  add column hourly_rate numeric(10, 2) check (hourly_rate is null or hourly_rate >= 0);

grant insert (hourly_rate), update (hourly_rate) on public.machines to authenticated;

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
  m.capacity_hours,
  m.hourly_rate
from public.machines m
left join public.catalog_items t on t.id = m.type_id and t.organization_id = m.organization_id
left join public.catalog_items l on l.id = m.location_id and l.organization_id = m.organization_id;

-- An interval split into local calendar days: seconds per day.
create function private.split_by_day(p_start timestamptz, p_end timestamptz, p_timezone text)
returns table (day date, seconds numeric)
language sql
immutable
set search_path = ''
as $$
  select d::date,
    extract(epoch from
      least(p_end, ((d::date + 1)::timestamp at time zone p_timezone))
      - greatest(p_start, (d::date::timestamp at time zone p_timezone)))
  from generate_series(
    (p_start at time zone p_timezone)::date,
    (p_end at time zone p_timezone)::date,
    interval '1 day'
  ) as d
  where p_end > p_start
    and least(p_end, ((d::date + 1)::timestamp at time zone p_timezone))
      > greatest(p_start, (d::date::timestamp at time zone p_timezone))
$$;

revoke execute on function private.split_by_day(timestamptz, timestamptz, text) from public;
grant execute on function private.split_by_day(timestamptz, timestamptz, text) to authenticated;

create function private.require_reports(p_org_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
begin
  if not private.has_permission(p_org_id, 'reports.read') then
    raise exception 'missing permission reports.read' using errcode = '42501';
  end if;
  select o.timezone into v_timezone from public.organizations o where o.id = p_org_id;
  return v_timezone;
end;
$$;

revoke execute on function private.require_reports(uuid) from public;
grant execute on function private.require_reports(uuid) to authenticated;

-- Production and machines between two local days (both included):
--   output       good / scrap and the routing time for those pieces,
--   scrap        scrap by reason,
--   machine_time running time of operations (status in progress),
--   worker_time  worker sessions,
--   downtime     pauses and entered downtime by reason,
--   tool_changes count and minutes by reason,
-- each per local day, machine, worker (where known), order and operation;
-- plus the machines, workers and orders they name.
create function public.report_production(p_org_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text := private.require_reports(p_org_id);
  v_from timestamptz := p_from::timestamp at time zone v_timezone;
  v_to timestamptz := (p_to + 1)::timestamp at time zone v_timezone;
  v_result jsonb;
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  with
  output as (
    select (rp.reported_at at time zone v_timezone)::date as day,
      rp.machine_id, rp.employee_id, rp.order_id, rp.operation_id,
      sum(rp.good_quantity) as good, sum(rp.scrap_quantity) as scrap,
      sum((rp.good_quantity + rp.scrap_quantity) * coalesce(o.cycle_time_s, 0)) as planned_seconds
    from public.production_reports rp
    join public.production_order_operations o on o.id = rp.operation_id
    where rp.organization_id = p_org_id and rp.voided_at is null
      and rp.reported_at >= v_from and rp.reported_at < v_to
    group by 1, 2, 3, 4, 5
  ),
  scrap as (
    select (rp.reported_at at time zone v_timezone)::date as day,
      rp.machine_id, rp.employee_id, rp.order_id, c.name as reason,
      sum(rp.scrap_quantity) as scrap
    from public.production_reports rp
    left join public.catalog_items c on c.id = rp.scrap_reason_id
    where rp.organization_id = p_org_id and rp.voided_at is null and rp.scrap_quantity > 0
      and rp.reported_at >= v_from and rp.reported_at < v_to
    group by 1, 2, 3, 4, 5
  ),
  runs as (
    select h.operation_id, h.order_id, h.to_status, h.changed_at,
      lead(h.changed_at) over (partition by h.operation_id order by h.changed_at, h.id) as next_at
    from public.production_order_status_history h
    where h.organization_id = p_org_id and h.operation_id is not null
      and h.changed_at < v_to
  ),
  machine_time as (
    select s.day, o.machine_id, r.order_id, r.operation_id, sum(s.seconds) as seconds
    from runs r
    join public.production_order_operations o on o.id = r.operation_id
    join public.operation_types t on t.id = o.operation_type_id
    cross join lateral private.split_by_day(
      greatest(r.changed_at, v_from), least(coalesce(r.next_at, now()), v_to), v_timezone) s
    where r.to_status = 'in_progress' and not t.is_external
      and coalesce(r.next_at, now()) > v_from
    group by 1, 2, 3, 4
  ),
  worker_time as (
    select s.day, w.employee_id, w.machine_id, w.order_id, w.operation_id, sum(s.seconds) as seconds
    from public.production_work_sessions w
    cross join lateral private.split_by_day(
      greatest(w.started_at, v_from), least(coalesce(w.ended_at, now()), v_to), v_timezone) s
    where w.organization_id = p_org_id and w.started_at < v_to
      and coalesce(w.ended_at, now()) > v_from
    group by 1, 2, 3, 4, 5
  ),
  downtime as (
    select s.day, d.machine_id, d.employee_id, d.order_id, c.name as reason, sum(s.seconds) as seconds
    from public.production_downtime_events d
    join public.catalog_items c on c.id = d.reason_id
    cross join lateral private.split_by_day(
      greatest(d.started_at, v_from), least(coalesce(d.ended_at, now()), v_to), v_timezone) s
    where d.organization_id = p_org_id and d.started_at < v_to
      and coalesce(d.ended_at, now()) > v_from
    group by 1, 2, 3, 4, 5
  ),
  tool_changes as (
    select (tc.changed_at at time zone v_timezone)::date as day, tc.machine_id,
      c.name as reason, count(*) as changes, coalesce(sum(tc.duration_min), 0) as minutes
    from public.production_tool_changes tc
    join public.catalog_items c on c.id = tc.reason_id
    where tc.organization_id = p_org_id and tc.changed_at >= v_from and tc.changed_at < v_to
    group by 1, 2, 3
  ),
  order_ids as (
    select order_id from output union select order_id from machine_time
    union select order_id from worker_time union select order_id from downtime
  ),
  operation_ids as (
    select operation_id from output union select operation_id from machine_time
    union select operation_id from worker_time
  )
  select jsonb_build_object(
    'output', coalesce((select jsonb_agg(to_jsonb(x)) from output x), '[]'::jsonb),
    'scrap', coalesce((select jsonb_agg(to_jsonb(x)) from scrap x), '[]'::jsonb),
    'machine_time', coalesce((select jsonb_agg(to_jsonb(x)) from machine_time x), '[]'::jsonb),
    'worker_time', coalesce((select jsonb_agg(to_jsonb(x)) from worker_time x), '[]'::jsonb),
    'downtime', coalesce((select jsonb_agg(to_jsonb(x)) from downtime x), '[]'::jsonb),
    'tool_changes', coalesce((select jsonb_agg(to_jsonb(x)) from tool_changes x), '[]'::jsonb),
    'machines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'code', m.code, 'name', m.name, 'runs_unattended', m.runs_unattended,
        'capacity_hours', m.capacity_hours, 'hourly_rate', m.hourly_rate,
        'archived', m.archived_at is not null or m.status = 'inactive'
      ) order by m.code)
      from public.machines m where m.organization_id = p_org_id
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.first_name || ' ' || e.last_name, 'number', e.employee_number
      ) order by e.last_name, e.first_name)
      from public.employees e where e.organization_id = p_org_id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.order_number, 'customer_id', r.customer_id,
        'customer', c.name, 'part_number', p.part_number, 'product', p.name
      ))
      from public.production_orders r
      join order_ids i on i.order_id = r.id
      left join public.customers c on c.id = r.customer_id
      left join public.products p on p.id = r.product_id
    ), '[]'::jsonb),
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'code', t.code, 'name', t.name))
      from public.production_order_operations o
      join operation_ids i on i.operation_id = o.id
      join public.operation_types t on t.id = o.operation_type_id
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- Orders finished in the period, or due in it, or overdue and still open:
-- due date, completion day, good pieces, times and costs (material issued −
-- returned, machine hours × hourly rate, external operations).
create function public.report_orders(p_org_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text := private.require_reports(p_org_id);
  v_today date := (now() at time zone v_timezone)::date;
  v_result jsonb;
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  with completed as (
    select h.order_id, (max(h.changed_at) at time zone v_timezone)::date as completed_on
    from public.production_order_status_history h
    where h.organization_id = p_org_id and h.operation_id is null and h.to_status = 'completed'
    group by h.order_id
  ),
  picked as (
    select r.*, c.completed_on
    from public.production_orders r
    left join completed c on c.order_id = r.id
    where r.organization_id = p_org_id and r.status not in ('draft', 'cancelled')
      and (
        (r.status in ('completed', 'archived') and c.completed_on between p_from and p_to)
        or (r.status not in ('completed', 'archived') and (
          r.due_date between p_from and p_to or r.due_date < v_today))
      )
  ),
  ops as (
    select o.order_id,
      sum(case when t.is_external then 0
        else coalesce(o.setup_time_min, 0) * 60 + coalesce(o.cycle_time_s, 0) * p.quantity end)
        as planned_seconds,
      sum(case when t.is_external then 0 else private.operation_run_seconds(o.id) end) as run_seconds,
      sum(case when t.is_external then 0
        else private.operation_run_seconds(o.id) / 3600 * coalesce(m.hourly_rate, 0) end) as machine_cost,
      bool_or(not t.is_external and o.machine_id is not null and m.hourly_rate is null
        and private.operation_run_seconds(o.id) > 0) as rate_missing,
      sum(case when t.is_external then coalesce(o.external_cost, 0) else 0 end) as external_cost,
      sum(case when t.is_external then coalesce(o.external_days, 0) else 0 end) as external_days
    from picked p
    join public.production_order_operations o on o.order_id = p.id and o.archived_at is null
    join public.operation_types t on t.id = o.operation_type_id
    left join public.machines m on m.id = o.machine_id
    group by o.order_id
  ),
  material as (
    select s.order_id, sum(s.issued_value - s.returned_value) as material_cost
    from public.stock_order_issued s
    join picked p on p.id = s.order_id
    group by s.order_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'number', p.order_number, 'status', p.status,
    'customer_id', p.customer_id, 'customer', c.name,
    'part_number', pr.part_number, 'product', pr.name,
    'quantity', p.quantity, 'unit', p.unit, 'good', private.order_good_quantity(p.id),
    'due_date', p.due_date, 'completed_on', p.completed_on,
    'planned_seconds', coalesce(o.planned_seconds, 0), 'run_seconds', coalesce(o.run_seconds, 0),
    'material_cost', coalesce(mt.material_cost, 0), 'machine_cost', coalesce(o.machine_cost, 0),
    'external_cost', coalesce(o.external_cost, 0), 'external_days', coalesce(o.external_days, 0),
    'rate_missing', coalesce(o.rate_missing, false)
  ) order by p.due_date, p.order_number), '[]'::jsonb)
  into v_result
  from picked p
  left join ops o on o.order_id = p.id
  left join material mt on mt.order_id = p.id
  left join public.customers c on c.id = p.customer_id
  left join public.products pr on pr.id = p.product_id;
  return v_result;
end;
$$;

-- Material and tools in the period: issues to orders (net of returns) by
-- item and order, receipts by item, tool consumption (used up / scrapped)
-- by tool and machine; and the value of own stock today by item.
create function public.report_inventory(p_org_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text := private.require_reports(p_org_id);
  v_from timestamptz := p_from::timestamp at time zone v_timezone;
  v_to timestamptz := (p_to + 1)::timestamp at time zone v_timezone;
  v_result jsonb;
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'consumption', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select m.item_id, m.production_order_id as order_id, r.order_number,
          -sum(m.quantity) as quantity, -sum(coalesce(m.mass_kg, 0)) as mass_kg,
          -sum(m.value) as value
        from public.stock_movements m
        join public.production_orders r on r.id = m.production_order_id
        where m.organization_id = p_org_id and m.kind in ('issue', 'remnant', 'return')
          and m.created_at >= v_from and m.created_at < v_to
        group by 1, 2, 3
      ) x
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select m.item_id, sum(m.quantity) as quantity, sum(coalesce(m.mass_kg, 0)) as mass_kg,
          sum(m.value) as value
        from public.stock_movements m
        where m.organization_id = p_org_id and m.kind = 'receipt'
          and m.created_at >= v_from and m.created_at < v_to
        group by 1
      ) x
    ), '[]'::jsonb),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', s.item_id, 'quantity', s.own_quantity, 'mass_kg', s.own_mass_kg,
        'value', s.own_value
      ))
      from public.stock_item_totals s
      where s.organization_id = p_org_id and s.own_quantity <> 0
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'code', i.code, 'name', i.name, 'unit', i.base_unit
      ) order by i.code)
      from public.stock_items i where i.organization_id = p_org_id
    ), '[]'::jsonb),
    'tools', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select tm.tool_id, t.code, t.name, t.kind, tc.machine_id,
          -sum(tm.quantity) filter (where tm.kind = 'consume') as consumed,
          -sum(tm.quantity) filter (where tm.kind = 'scrap') as scrapped
        from public.tool_movements tm
        join public.tools t on t.id = tm.tool_id
        left join public.production_tool_changes tc on tc.id = tm.tool_change_id
        where tm.organization_id = p_org_id and tm.kind in ('consume', 'scrap')
          and tm.created_at >= v_from and tm.created_at < v_to
        group by 1, 2, 3, 4, 5
      ) x
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.report_production(uuid, date, date) from public, anon;
revoke execute on function public.report_orders(uuid, date, date) from public, anon;
revoke execute on function public.report_inventory(uuid, date, date) from public, anon;
grant execute on function public.report_production(uuid, date, date) to authenticated;
grant execute on function public.report_orders(uuid, date, date) to authenticated;
grant execute on function public.report_inventory(uuid, date, date) to authenticated;
