-- Performance (D-042). RLS policies called private.has_permission(organization_id, '<key>')
-- once per row. Every call is a separate SECURITY DEFINER function run (a five-table join),
-- and the per-row helper functions of the directory views (order_schedule,
-- operation_overlaps) ran their own queries under RLS again, so an order list of
-- 100 rows took hundreds of milliseconds on a few hundred rows of data.
--
-- 1. private.permitted_org_ids(key): the organizations in which the caller holds the
--    permission, with exactly the conditions of private.has_permission. A policy
--    `organization_id in (select private.permitted_org_ids(key))` is evaluated once per
--    statement (hashed subplan) instead of once per row. Same result for every row:
--    has_permission(x, k) is true exactly when x is in permitted_org_ids(k), and both
--    are false/null for a null x (policies never negate the check).
-- 2. All public policies are rewritten from the one form to the other, nothing else in
--    them changes (a permission computed from the row, catalog_items writes, stays).
-- 3. The view helpers order_schedule and operation_overlaps run as definer: they are
--    only reached through rows the caller can already see (the views are
--    security_invoker), compute derived numbers for that order / operation, and an
--    operation's machine belongs to one organization.
-- 4. Covering indexes for the foreign keys the advisor lists, and the
--    notification_reads policy reads auth.uid() once.

create function private.permitted_org_ids(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  join public.organizations o on o.id = m.organization_id and o.archived_at is null
  join public.profiles p on p.id = m.user_id and p.archived_at is null
  join public.roles r on r.id = m.role_id and r.archived_at is null
  join public.role_permissions rp on rp.role_id = r.id
  where m.user_id = (select auth.uid())
    and m.archived_at is null
    and rp.permission_key = p_permission
    and (not p.is_support or private.support_active(m.organization_id))
$$;

revoke all on function private.permitted_org_ids(text) from public;
grant execute on function private.permitted_org_ids(text) to authenticated, service_role;

do $$
declare
  v_pattern constant text := 'private\.has_permission\((id|organization_id), (''[a-z_.]+''::text)\)';
  v_replace constant text := '(\1 IN ( SELECT private.permitted_org_ids(\2) AS permitted_org_ids))';
  v_policy record;
  v_sql text;
begin
  for v_policy in
    select p.schemaname, p.tablename, p.policyname, p.qual, p.with_check
    from pg_policies p
    where p.schemaname = 'public'
      and (p.qual ~ 'private\.has_permission\(' or p.with_check ~ 'private\.has_permission\(')
  loop
    v_sql := format('alter policy %I on %I.%I', v_policy.policyname, v_policy.schemaname,
      v_policy.tablename);
    if v_policy.qual is not null then
      v_sql := v_sql || format(' using (%s)', regexp_replace(v_policy.qual, v_pattern, v_replace, 'g'));
    end if;
    if v_policy.with_check is not null then
      v_sql := v_sql || format(' with check (%s)',
        regexp_replace(v_policy.with_check, v_pattern, v_replace, 'g'));
    end if;
    execute v_sql;
  end loop;

  -- Left as they are: catalog_items writes, whose permission depends on the row's kind.
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and (p.qual ~ v_pattern or p.with_check ~ v_pattern)
  ) then
    raise exception 'a public policy still calls private.has_permission per row';
  end if;
end;
$$;

alter function private.order_schedule(uuid) security definer;
alter function private.operation_overlaps(uuid) security definer;

alter policy notification_reads_select on public.notification_reads
  using (user_id = (select auth.uid()) and organization_id in (select private.user_org_ids()));

create index if not exists absence_details_organization_id_absence_id_fk_idx on public.absence_details (organization_id, absence_id);
create index if not exists attendance_alerts_organization_id_session_id_fk_idx on public.attendance_alerts (organization_id, session_id);
create index if not exists attendance_corrections_organization_id_new_session_id_fk_idx on public.attendance_corrections (organization_id, new_session_id);
create index if not exists attendance_corrections_organization_id_session_id_fk_idx on public.attendance_corrections (organization_id, session_id);
create index if not exists companies_created_by_organization_id_fk_idx on public.companies (created_by_organization_id);
create index if not exists customers_organization_id_delivery_note_template_id_fk_idx on public.customers (organization_id, delivery_note_template_id);
create index if not exists delivery_note_lines_organization_id_delivery_note_id_fk_idx on public.delivery_note_lines (organization_id, delivery_note_id);
create index if not exists delivery_notes_organization_id_template_id_fk_idx on public.delivery_notes (organization_id, template_id);
create index if not exists employee_holiday_keys_organization_id_employee_id_fk_idx on public.employee_holiday_keys (organization_id, employee_id);
create index if not exists employee_kiosk_credentials_organization_id_employee_id_fk_idx on public.employee_kiosk_credentials (organization_id, employee_id);
create index if not exists employee_leave_years_organization_id_employee_id_fk_idx on public.employee_leave_years (organization_id, employee_id);
create index if not exists finished_goods_movements_organization_id_delivery_note_id_fk_id on public.finished_goods_movements (organization_id, delivery_note_id);
create index if not exists machine_downtimes_organization_id_reason_kind_reason_id_fk_idx on public.machine_downtimes (organization_id, reason_kind, reason_id);
create index if not exists machine_inserts_organization_id_machine_id_fk_idx on public.machine_inserts (organization_id, machine_id);
create index if not exists machine_inserts_organization_id_tool_id_fk_idx on public.machine_inserts (organization_id, tool_id);
create index if not exists production_tool_changes_organization_id_tool_id_fk_idx on public.production_tool_changes (organization_id, tool_id);
create index if not exists shift_crew_members_organization_id_crew_id_fk_idx on public.shift_crew_members (organization_id, crew_id);
create index if not exists shift_rotation_days_organization_id_rotation_id_fk_idx on public.shift_rotation_days (organization_id, rotation_id);
create index if not exists shift_rotation_days_organization_id_shift_id_fk_idx on public.shift_rotation_days (organization_id, shift_id);
create index if not exists stock_adjustment_lines_organization_id_item_id_fk_idx on public.stock_adjustment_lines (organization_id, item_id);
create index if not exists stock_adjustment_lines_organization_id_item_id_lot_id_fk_idx on public.stock_adjustment_lines (organization_id, item_id, lot_id);
create index if not exists stock_adjustment_lines_organization_id_location_id_fk_idx on public.stock_adjustment_lines (organization_id, location_id);
create index if not exists stock_count_lines_organization_id_item_id_fk_idx on public.stock_count_lines (organization_id, item_id);
create index if not exists stock_count_lines_organization_id_item_id_lot_id_fk_idx on public.stock_count_lines (organization_id, item_id, lot_id);
create index if not exists stock_count_lines_organization_id_location_id_fk_idx on public.stock_count_lines (organization_id, location_id);
create index if not exists stock_counts_organization_id_adjustment_document_id_fk_idx on public.stock_counts (organization_id, adjustment_document_id);
create index if not exists stock_counts_organization_id_item_id_fk_idx on public.stock_counts (organization_id, item_id);
create index if not exists stock_counts_organization_id_location_id_fk_idx on public.stock_counts (organization_id, location_id);
create index if not exists stock_items_organization_id_default_location_id_fk_idx on public.stock_items (organization_id, default_location_id);
create index if not exists stock_locations_organization_id_machine_id_fk_idx on public.stock_locations (organization_id, machine_id);
create index if not exists stock_lots_organization_id_owner_customer_id_fk_idx on public.stock_lots (organization_id, owner_customer_id);
create index if not exists stock_movements_organization_id_document_id_fk_idx on public.stock_movements (organization_id, document_id);
create index if not exists stock_order_consumption_organization_id_item_id_fk_idx on public.stock_order_consumption (organization_id, item_id);
create index if not exists stock_order_consumption_organization_id_order_id_fk_idx on public.stock_order_consumption (organization_id, order_id);
create index if not exists stock_reservations_organization_id_order_id_fk_idx on public.stock_reservations (organization_id, order_id);
create index if not exists tool_movements_organization_id_location_id_fk_idx on public.tool_movements (organization_id, location_id);
create index if not exists tool_movements_organization_id_tool_change_id_fk_idx on public.tool_movements (organization_id, tool_change_id);
create index if not exists tools_organization_id_home_machine_id_fk_idx on public.tools (organization_id, home_machine_id);
