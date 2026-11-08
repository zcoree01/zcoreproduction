-- Organization lock (D-049). A firm that is locked (by hand, or automatically
-- after an unpaid month's due date) keeps viewing, the kiosk and the work
-- already in progress; everything else that writes is refused with
-- organization_locked (42501, so existing error mappers show "denied").
--
-- One BEFORE trigger on every tenant table covers both RLS writes and SECURITY
-- DEFINER RPCs. Default = deny; the rules below name what stays allowed.
-- Skipped for the service role (registration, kiosk, support entry, scripts)
-- and for the platform admin (billing of a locked firm). Tables added later
-- must attach lock_guard too.

create function private.lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid;
  v_allowed boolean;
  v_status_columns constant text[] := array['status', 'status_changed_at', 'updated_at'];
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

revoke all on function private.lock_guard() from public, anon;

do $$
declare
  v_table text;
begin
  for v_table in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'organization_id'
      and t.table_type = 'BASE TABLE'
    union
    select 'organizations'
  loop
    execute format(
      'create trigger lock_guard before insert or update or delete on public.%I '
      'for each row execute function private.lock_guard()',
      v_table
    );
  end loop;
end;
$$;

-- What a member of the organization sees about its billing (no amounts). The
-- warning before the lock is meant for those who manage the organization's
-- settings; everybody sees that it is locked.
create function public.my_billing_notice(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state record;
begin
  if not exists (select 1 from private.user_org_ids() as o (id) where o.id = p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  select * into v_state from private.org_lock_state(p_org_id);
  if v_state.state in ('warning', 'overdue')
    and not private.has_permission(p_org_id, 'org.settings.manage') then
    return jsonb_build_object('state', 'active', 'unpaid_period', null, 'lock_on', null,
      'reason', null, 'contact', '');
  end if;
  return jsonb_build_object(
    'state', v_state.state,
    'unpaid_period', v_state.unpaid_period,
    'lock_on', v_state.lock_on,
    'reason', v_state.reason,
    'contact', (select s.lock_contact from public.platform_settings s)
  );
end;
$$;

revoke all on function public.my_billing_notice(uuid) from public, anon;
grant execute on function public.my_billing_notice(uuid) to authenticated;
