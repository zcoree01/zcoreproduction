-- lock_guard stops only members of the locked organization (D-060).
-- Before, a change by an unlocked firm to its own directory entry failed when
-- any locked firm had that company as a customer: companies_sync_customers
-- updates those customer rows and lock_guard refused them. The rest of the
-- function is unchanged (copied from 20261110250000_problem_reports).

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
      'notification_reads', 'audit_log', 'support_access_requests',
      'problem_reports', 'problem_report_messages', 'problem_report_files', 'member_activity_days'
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
    -- Only members of the locked firm are stopped: writes the database makes
    -- for another firm (the directory syncing a company onto the customer rows
    -- of every firm that uses it) go through (D-060).
    v_locked := not private.is_platform_admin() and private.org_locked(v_org)
      and exists (
        select 1 from public.memberships m
        where m.organization_id = v_org and m.user_id = (select auth.uid())
      );
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
revoke all on function private.lock_guard() from public, anon;
