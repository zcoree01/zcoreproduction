-- Shift performance (D-045): output and worker time carry the shift of the
-- worker's attendance session at that moment (reported_at / start of the
-- work session); null = not clocked in or outside every shift. Plus the
-- organization's shifts. Replaces report_production of 20261105110000.
create or replace function public.report_production(p_org_id uuid, p_from date, p_to date)
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
      (
        select a.shift_id from public.attendance_sessions a
        where a.employee_id = rp.employee_id and a.clock_in_at <= rp.reported_at
          and (a.clock_out_at is null or a.clock_out_at > rp.reported_at)
        order by a.clock_in_at desc limit 1
      ) as shift_id,
      sum(rp.good_quantity) as good, sum(rp.scrap_quantity) as scrap,
      sum((rp.good_quantity + rp.scrap_quantity) * coalesce(o.cycle_time_s, 0)) as planned_seconds
    from public.production_reports rp
    join public.production_order_operations o on o.id = rp.operation_id
    join public.operation_types t on t.id = o.operation_type_id
    where rp.organization_id = p_org_id and rp.voided_at is null and not t.is_inspection
      and rp.reported_at >= v_from and rp.reported_at < v_to
    group by 1, 2, 3, 4, 5, 6
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
    where r.to_status = 'in_progress' and not t.is_external and not t.is_inspection
      and coalesce(r.next_at, now()) > v_from
    group by 1, 2, 3, 4
  ),
  worker_time as (
    select s.day, w.employee_id, w.machine_id, w.order_id, w.operation_id,
      (
        select a.shift_id from public.attendance_sessions a
        where a.employee_id = w.employee_id and a.clock_in_at <= w.started_at
          and (a.clock_out_at is null or a.clock_out_at > w.started_at)
        order by a.clock_in_at desc limit 1
      ) as shift_id,
      sum(s.seconds) as seconds
    from public.production_work_sessions w
    cross join lateral private.split_by_day(
      greatest(w.started_at, v_from), least(coalesce(w.ended_at, now()), v_to), v_timezone) s
    where w.organization_id = p_org_id and w.started_at < v_to
      and coalesce(w.ended_at, now()) > v_from
    group by 1, 2, 3, 4, 5, 6
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
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object('id', sh.id, 'code', sh.code, 'name', sh.name)
        order by sh.starts_at)
      from public.shifts sh where sh.organization_id = p_org_id
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
