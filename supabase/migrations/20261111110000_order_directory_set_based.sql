-- Speed (D-056). public.production_order_directory called four definer
-- functions and three subqueries for every order (~0.6 ms per order), also
-- for the exact count of the list, so the order list grew with the number of
-- orders (measured: ~95 ms for the page + ~95 ms for the count at 146 orders).
--
-- Now one function computes the same facts for all orders of an organization
-- in a few aggregates, once per statement. The view keeps its columns, their
-- types and its meaning; the per-order functions stay for single orders
-- (set_order_status, close requests, reports, floor).
--
-- Also: reports of one operation were found by operation_id alone, but the
-- only index started with organization_id (a sequential scan per operation).

create index production_reports_operation_only_idx
  on public.production_reports (operation_id)
  where voided_at is null;

-- Same rules as private.order_schedule, private.order_progress,
-- private.order_good_quantity and private.order_completion_allowed, for every
-- order of p_org_id. Definer like those: reached only through the view, whose
-- rows are limited by RLS on production_orders.
create function private.order_directory_facts(p_org_id uuid)
returns table (
  order_id uuid,
  planned_seconds numeric,
  remaining_seconds numeric,
  days_to_due integer,
  slack_days integer,
  computed_priority smallint,
  effective_priority smallint,
  started boolean,
  due_warning text,
  due_warning_days integer,
  machine_ids uuid[],
  operation_count integer,
  operations_done integer,
  good_quantity numeric,
  completion_allowed boolean,
  close_request_pending boolean,
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
  with org as (
    select
      o.timezone,
      o.settings,
      coalesce((o.settings ->> 'work_hours_per_day')::numeric, 8) as hours_per_day,
      coalesce(o.settings -> 'priority_thresholds', '[0, 3, 7, 10]'::jsonb) as thresholds,
      coalesce(o.settings -> 'due_warning_days', '[10, 7, 3]'::jsonb) as warning_days
    from public.organizations o
    where o.id = p_org_id
  ),
  reported as (
    select
      rp.operation_id,
      coalesce(sum(rp.good_quantity), 0) as good,
      coalesce(sum(rp.scrap_quantity), 0) as scrap
    from public.production_reports rp
    where rp.organization_id = p_org_id and rp.voided_at is null
    group by rp.operation_id
  ),
  ops as (
    select
      op.order_id,
      op.sequence,
      op.status,
      op.machine_id,
      coalesce(op.setup_time_min, 0) * 60 + coalesce(op.cycle_time_s, 0) * r.quantity as seconds,
      t.code,
      t.name,
      t.is_external,
      m.code as machine_code,
      coalesce(rep.good, 0) as good,
      case
        when op.status = 'done' then 1::numeric
        when t.is_external and op.status = 'in_progress' then 0.5
        else least(1, (coalesce(rep.good, 0) + coalesce(rep.scrap, 0)) / nullif(r.quantity, 0))
      end as fraction
    from public.production_order_operations op
    join public.production_orders r on r.id = op.order_id
    join public.operation_types t on t.id = op.operation_type_id
    left join public.machines m on m.id = op.machine_id
    left join reported rep on rep.operation_id = op.id
    where op.organization_id = p_org_id and op.archived_at is null
  ),
  per_order as (
    select
      ops.order_id,
      coalesce(sum(ops.seconds), 0) as planned,
      coalesce(sum(ops.seconds) filter (where ops.status <> 'done'), 0) as remaining,
      coalesce(bool_or(ops.status in ('in_progress', 'paused', 'done')), false) as op_started,
      coalesce(array_agg(distinct ops.machine_id) filter (where ops.machine_id is not null), '{}')
        as machine_ids,
      count(*)::integer as operation_count,
      (count(*) filter (where ops.status = 'done'))::integer as operations_done,
      bool_and(ops.status = 'done') as all_done,
      avg(ops.fraction) as fraction,
      -- Good pieces of the order = good pieces of its last operation.
      (array_agg(ops.good order by ops.sequence desc))[1] as last_good,
      -- The first operation that is not done.
      (array_agg(ops.code order by ops.sequence) filter (where ops.status <> 'done'))[1] as cur_code,
      (array_agg(ops.name order by ops.sequence) filter (where ops.status <> 'done'))[1] as cur_name,
      (array_agg(ops.machine_code order by ops.sequence) filter (where ops.status <> 'done'))[1]
        as cur_machine,
      (array_agg(ops.is_external order by ops.sequence) filter (where ops.status <> 'done'))[1]
        as cur_external,
      (array_agg(ops.status order by ops.sequence) filter (where ops.status <> 'done'))[1]
        as cur_status
    from ops
    group by ops.order_id
  ),
  closes as (
    select
      cr.order_id,
      bool_or(cr.status = 'pending') as pending,
      bool_or(cr.status = 'approved') as approved
    from public.production_order_close_requests cr
    where cr.organization_id = p_org_id
    group by cr.order_id
  ),
  calc as (
    select
      r.id,
      r.status,
      r.priority,
      r.quantity,
      org.settings,
      org.thresholds,
      org.warning_days,
      coalesce(po.planned, 0) as planned,
      coalesce(po.remaining, 0) as remaining,
      coalesce(po.op_started, false) or r.status in ('in_progress', 'paused', 'quality_check')
        as started,
      r.due_date - (now() at time zone org.timezone)::date as days_to_due,
      org.hours_per_day,
      po.machine_ids,
      po.operation_count,
      po.operations_done,
      po.all_done,
      po.fraction,
      po.last_good,
      po.cur_code,
      po.cur_name,
      po.cur_machine,
      po.cur_external,
      po.cur_status,
      coalesce(cl.pending, false) as close_pending,
      coalesce(cl.approved, false) as close_approved
    from public.production_orders r
    cross join org
    left join per_order po on po.order_id = r.id
    left join closes cl on cl.order_id = r.id
    where r.organization_id = p_org_id
  ),
  slack as (
    select calc.*,
      calc.days_to_due - ceil(calc.remaining / (3600 * calc.hours_per_day))::integer as slack_days
    from calc
  ),
  prio as (
    select slack.*,
      (case
        when slack.slack_days <= (slack.thresholds ->> 0)::integer then 1
        when slack.slack_days <= (slack.thresholds ->> 1)::integer then 2
        when slack.slack_days <= (slack.thresholds ->> 2)::integer then 3
        when slack.slack_days <= (slack.thresholds ->> 3)::integer then 4
        else 5
      end)::smallint as computed_priority,
      (
        select min((d #>> '{}')::integer)
        from jsonb_array_elements(slack.warning_days) as d
        where slack.days_to_due <= (d #>> '{}')::integer
      ) as warning_level
    from slack
  )
  select
    prio.id,
    prio.planned,
    prio.remaining,
    prio.days_to_due,
    prio.slack_days,
    prio.computed_priority,
    coalesce(
      prio.priority,
      case when prio.settings ->> 'priority_mode' = 'automatic' then prio.computed_priority else 3 end
    )::smallint,
    prio.started,
    case
      when prio.status in ('completed', 'cancelled', 'archived') then null
      when prio.days_to_due < 0 then 'overdue'
      when prio.slack_days < 0 then 'behind'
      when not prio.started and prio.warning_level is not null then 'due_soon'
    end,
    case
      when prio.status not in ('completed', 'cancelled', 'archived')
        and prio.days_to_due >= 0 and prio.slack_days >= 0 and not prio.started
        then prio.warning_level
    end,
    coalesce(prio.machine_ids, '{}'),
    coalesce(prio.operation_count, 0),
    coalesce(prio.operations_done, 0),
    coalesce(prio.last_good, 0),
    prio.close_approved
      or (
        coalesce(prio.operation_count, 0) > 0
        and prio.all_done
        and coalesce(prio.last_good, 0) >= prio.quantity
      ),
    prio.close_pending,
    case
      when prio.status = 'completed' then 100
      else coalesce(floor(100 * prio.fraction)::integer, 0)
    end,
    prio.cur_code,
    prio.cur_name,
    prio.cur_machine,
    prio.cur_external,
    prio.cur_status
  from prio
$$;

revoke execute on function private.order_directory_facts(uuid) from public;
grant execute on function private.order_directory_facts(uuid) to authenticated, service_role;

-- Same columns as before. The organizations come from the orders the caller
-- may read (RLS), so the facts are computed once per organization.
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
  f.planned_seconds,
  f.remaining_seconds,
  f.days_to_due,
  f.slack_days,
  f.computed_priority,
  f.effective_priority,
  f.started,
  f.due_warning,
  f.due_warning_days,
  f.machine_ids,
  f.operation_count,
  f.operations_done,
  f.good_quantity,
  f.completion_allowed,
  f.close_request_pending,
  f.progress_percent,
  f.current_operation_code,
  f.current_operation_name,
  f.current_machine_code,
  f.current_operation_external,
  f.current_operation_status
from (select distinct o.organization_id from public.production_orders o) orgs
cross join lateral private.order_directory_facts(orgs.organization_id) f
join public.production_orders r on r.id = f.order_id and r.organization_id = orgs.organization_id
left join public.customers c on c.id = r.customer_id and c.organization_id = r.organization_id
left join public.products p on p.id = r.product_id and p.organization_id = r.organization_id
left join public.product_revisions rv on rv.id = r.revision_id and rv.organization_id = r.organization_id;
