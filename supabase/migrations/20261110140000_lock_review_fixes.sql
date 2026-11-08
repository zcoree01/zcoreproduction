-- Final review of D-049:
-- 1. A locked organization could still plan, edit order fields, re-plan
--    operations, activate kiosks and set PINs for others: production orders and
--    operations now allow only the columns work in progress changes (status and
--    the like), operation workers / kiosks are refused, kiosk credentials only
--    for the worker's own employee record.
-- 2. Planning is its own module: plan columns, external results and machine
--    downtimes need the planning module (it was reachable with production only).
-- 3. The lock state is computed once per transaction and organization instead
--    of for every row.
-- 4. A price change applies from the next month (platform time zone), so the
--    running month keeps the price it started with.

create function private.lock_changed(p_new jsonb, p_old jsonb, p_columns text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (select 1 from unnest(p_columns) as c (name) where p_new -> c.name is distinct from p_old -> c.name)
$$;

create or replace function private.lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid;
  v_allowed boolean;
  v_key text;
  v_cached text;
  v_locked boolean;
  -- Columns a status change or a report writes; generated columns are null in
  -- NEW inside a BEFORE trigger and are left out as well.
  v_machine_status constant text[] := array['status', 'status_changed_at', 'status_changed_by', 'updated_at', 'type_kind', 'location_kind'];
  v_order_edits constant text[] := array['customer_id', 'product_id', 'revision_id', 'unit', 'quantity',
    'due_date', 'priority', 'planned_start', 'planned_end', 'notes', 'customer_position',
    'piece_length_mm', 'kerf_mm', 'sheet_pieces_per_sheet'];
  v_operation_edits constant text[] := array['sequence', 'operation_type_id', 'description',
    'machine_type_id', 'machine_id', 'external_company', 'setup_time_min', 'cycle_time_s', 'notes',
    'planned_start', 'planned_end', 'plan_day', 'plan_position', 'plan_added_at', 'archived_at'];
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return coalesce(new, old);
  end if;
  v_org := case when tg_table_name = 'organizations'
    then (v_row ->> 'id')::uuid else (v_row ->> 'organization_id')::uuid end;

  -- Planning is its own module (sold in packages), with or without a lock.
  if v_org is not null
    and (tg_table_name = 'machine_downtimes'
      or (tg_table_name = 'production_order_operations' and tg_op = 'UPDATE'
        and private.lock_changed(v_new, v_old,
          array['plan_day', 'plan_position', 'plan_added_at', 'external_days', 'external_cost'])))
    and not private.module_enabled(v_org, 'planning')
    and not private.is_platform_admin() then
    raise exception 'module_disabled' using errcode = '42501';
  end if;

  v_allowed := case
    -- Work in progress, attendance, shipping of existing orders, own data.
    when tg_table_name = any (array[
      'production_reports', 'production_work_sessions', 'production_downtime_events',
      'production_tool_changes', 'production_order_status_history',
      'production_order_close_requests', 'machine_inserts', 'tool_movements',
      'attendance_sessions', 'attendance_alerts', 'finished_goods_movements', 'delivery_notes',
      'delivery_note_lines', 'stock_order_consumption', 'stock_reservations', 'stock_lots',
      'notification_reads', 'audit_log', 'support_access_requests'
    ]) then true
    when tg_table_name = 'profiles' then tg_op = 'UPDATE'
    -- A worker's own PIN (the kiosk itself writes through the service role).
    when tg_table_name = 'employee_kiosk_credentials' then
      tg_op <> 'DELETE' and private.is_own_employee((v_row ->> 'employee_id')::uuid)
    when tg_table_name = 'production_orders' then
      tg_op = 'UPDATE' and not private.lock_changed(v_new, v_old, v_order_edits)
    when tg_table_name = 'production_order_operations' then
      tg_op = 'UPDATE' and not private.lock_changed(v_new, v_old, v_operation_edits)
    when tg_table_name = 'machines' then
      tg_op = 'UPDATE' and (v_new - v_machine_status) = (v_old - v_machine_status)
    -- Material of an existing order: issue, remnant, return.
    when tg_table_name in ('stock_documents', 'stock_movements') then
      v_row ->> 'production_order_id' is not null
    else false
  end;
  if v_allowed or v_org is null then
    return coalesce(new, old);
  end if;
  -- Fast path: never billed and never locked by hand.
  if not exists (select 1 from public.organization_billing b where b.organization_id = v_org)
    and not exists (select 1 from public.organization_packages p where p.organization_id = v_org) then
    return coalesce(new, old);
  end if;

  -- Once per transaction and organization (bulk writes call this per row).
  v_key := 'zcore.lock_' || replace(v_org::text, '-', '');
  v_cached := nullif(current_setting(v_key, true), '');
  if v_cached is null then
    v_locked := not private.is_platform_admin() and private.org_locked(v_org);
    perform set_config(v_key, v_locked::text, true);
  else
    v_locked := v_cached::boolean;
  end if;
  if v_locked then
    raise exception 'organization_locked' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.lock_changed(jsonb, jsonb, text[]) from public, anon;
revoke all on function private.lock_guard() from public, anon;

-- The platform's own month (prices are not per firm).
create function private.platform_month()
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'Europe/Sarajevo')::date
$$;

revoke all on function private.platform_month() from public, anon;
grant execute on function private.platform_month() to authenticated, service_role;

create or replace function public.platform_save_package(
  p_id uuid, p_name text, p_monthly_price numeric, p_modules text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_this_month date := private.platform_month();
  -- A new package is priced from now; a change applies from the next month.
  v_price_from date;
  v_before jsonb;
  v_org uuid;
begin
  perform private.require_platform_admin();
  if p_name is null or length(btrim(p_name)) not between 1 and 80
    or p_monthly_price is null or p_monthly_price < 0 or p_monthly_price <> round(p_monthly_price, 2) then
    raise exception 'invalid package' using errcode = '22023';
  end if;
  perform private.assert_module_set(coalesce(p_modules, '{}'));

  if v_id is null then
    insert into public.billing_packages (name) values (btrim(p_name)) returning id into v_id;
    v_price_from := v_this_month;
  else
    select jsonb_build_object('name', p.name,
        'monthly_price', private.package_price_on(p.id, v_this_month),
        'modules', (select jsonb_agg(pm.module_key order by pm.module_key)
                    from public.billing_package_modules pm where pm.package_id = p.id))
      into v_before
    from public.billing_packages p where p.id = v_id;
    if v_before is null then
      raise exception 'package not found' using errcode = 'P0002';
    end if;
    update public.billing_packages set name = btrim(p_name) where id = v_id;
    v_price_from := (v_this_month + interval '1 month')::date;
  end if;

  delete from public.billing_package_modules where package_id = v_id;
  insert into public.billing_package_modules (package_id, module_key)
  select v_id, k from unnest(p_modules) as k group by k;

  if private.package_price_on(v_id, v_price_from) is distinct from p_monthly_price then
    insert into public.billing_package_prices (package_id, valid_from, monthly_price)
    values (v_id, v_price_from, p_monthly_price)
    on conflict (package_id, valid_from) do update set monthly_price = excluded.monthly_price;
  end if;

  for v_org in
    select o.id from public.organizations o
    where private.org_package_on(o.id, date_trunc('month', private.org_today(o.id))::date) = v_id
  loop
    perform private.sync_package_modules(v_org);
  end loop;

  perform private.billing_audit(private.platform_org_id(),
    case when p_id is null then 'billing.package_created' else 'billing.package_updated' end,
    v_id::text, v_before,
    jsonb_build_object('name', btrim(p_name), 'monthly_price', p_monthly_price,
      'price_from', v_price_from, 'modules', to_jsonb(p_modules)));
  return v_id;
end;
$$;

-- Current price and, when a change is pending, the next month's price.
create or replace function public.platform_billing_packages()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_this_month date := private.platform_month();
  v_next_month date := (private.platform_month() + interval '1 month')::date;
begin
  perform private.require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'monthly_price', private.package_price_on(p.id, v_this_month),
      'next_monthly_price', nullif(private.package_price_on(p.id, v_next_month),
        private.package_price_on(p.id, v_this_month)),
      'next_from', v_next_month,
      'modules', coalesce((
        select jsonb_agg(pm.module_key order by pm.module_key)
        from public.billing_package_modules pm where pm.package_id = p.id
      ), '[]'::jsonb),
      'archived', p.archived_at is not null,
      'organization_count', (
        select count(*)::integer from public.organizations o
        where private.org_package_on(o.id, date_trunc('month', private.org_today(o.id))::date) = p.id
      )
    ) order by p.archived_at nulls first, p.name)
    from public.billing_packages p
  ), '[]'::jsonb);
end;
$$;
