-- lock_guard (D-049): machines.type_kind and location_kind are generated
-- columns, still null in NEW inside a BEFORE trigger, so a status-only update
-- looked like an edit and was refused on a locked organization. They are left
-- out of the comparison like the status columns.

create or replace function private.lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid;
  v_allowed boolean;
  v_status_columns constant text[] := array['status', 'status_changed_at', 'status_changed_by', 'updated_at', 'type_kind', 'location_kind'];
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return coalesce(new, old);
  end if;

  v_allowed := case
    -- Work in progress, attendance, kiosk, shipping of existing orders, own data.
    when tg_table_name = any (array[
      'production_reports', 'production_work_sessions', 'production_downtime_events',
      'production_tool_changes', 'production_order_status_history',
      'production_order_close_requests', 'production_order_operation_workers',
      'machine_inserts', 'tool_movements', 'attendance_sessions', 'attendance_alerts',
      'employee_kiosk_credentials', 'finished_goods_movements', 'delivery_notes',
      'delivery_note_lines', 'stock_order_consumption', 'stock_reservations', 'stock_lots',
      'notification_reads', 'audit_log', 'support_access_requests'
    ]) then true
    when tg_table_name = any (array[
      'production_orders', 'production_order_operations', 'attendance_kiosks', 'profiles'
    ]) then tg_op = 'UPDATE'
    when tg_table_name = 'machines' then
      tg_op = 'UPDATE' and (to_jsonb(new) - v_status_columns) = (to_jsonb(old) - v_status_columns)
    -- Material of an existing order: issue, remnant, return.
    when tg_table_name in ('stock_documents', 'stock_movements') then
      v_row ->> 'production_order_id' is not null
    else false
  end;
  if v_allowed then
    return coalesce(new, old);
  end if;

  v_org := case when tg_table_name = 'organizations'
    then (v_row ->> 'id')::uuid else (v_row ->> 'organization_id')::uuid end;
  -- Fast path: never billed and never locked by hand.
  if v_org is null or (
    not exists (select 1 from public.organization_billing b where b.organization_id = v_org)
    and not exists (select 1 from public.organization_packages p where p.organization_id = v_org)
  ) then
    return coalesce(new, old);
  end if;
  if private.is_platform_admin() or not private.org_locked(v_org) then
    return coalesce(new, old);
  end if;
  raise exception 'organization_locked' using errcode = '42501';
end;
$$;
