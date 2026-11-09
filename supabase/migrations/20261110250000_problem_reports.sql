-- Problem reports (Zcore organization, part 3): every member of a firm other
-- than Zcore reports a problem (category, optional text, page, device, screen
-- shots); Zcore reads and answers. Members see only their own reports. A locked
-- firm can still report (lock_guard allows these tables); an archived firm
-- cannot (private.user_org_ids drops it).

-- ---------------------------------------------------------------------------
-- Permission: answer reports, change their state, schedule support sessions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module_key, description, default_roles) values
  ('platform.reports.manage', 'platform',
    'Zcore platform: answer problem reports and change their state',
    '{platform_admin,platform_technician}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.organizations o on o.id = r.organization_id and o.is_platform
join public.permissions p on p.key = 'platform.reports.manage' and r.key = any (p.default_roles)
where r.key in ('platform_admin', 'platform_technician')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  created_by uuid not null,
  category text not null check (category in ('broken', 'slow', 'howto', 'idea', 'billing', 'other')),
  description text check (description is null or length(description) <= 4000),
  page_path text check (page_path is null or length(page_path) <= 300),
  user_agent text check (user_agent is null or length(user_agent) <= 500),
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'waiting_user', 'resolved')),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_message_at timestamptz,
  check (category <> 'other' or length(btrim(coalesce(description, ''))) > 0),
  unique (organization_id, id),
  foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete restrict
);

create index problem_reports_author_idx
  on public.problem_reports (organization_id, created_by, created_at desc);
create index problem_reports_status_idx on public.problem_reports (status, created_at desc);

create table public.problem_report_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  report_id uuid not null,
  -- A member of the firm, or a Zcore user (then from_zcore).
  author_id uuid not null,
  from_zcore boolean not null default false,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (organization_id, report_id)
    references public.problem_reports (organization_id, id) on delete restrict
);

create index problem_report_messages_report_idx
  on public.problem_report_messages (report_id, created_at);

create table public.problem_report_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  report_id uuid not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (storage_path like organization_id::text || '/' || report_id::text || '/%'),
  foreign key (organization_id, report_id)
    references public.problem_reports (organization_id, id) on delete restrict
);

create index problem_report_files_report_idx on public.problem_report_files (report_id);

revoke all on public.problem_reports, public.problem_report_messages, public.problem_report_files
  from anon, authenticated;
grant select on public.problem_reports, public.problem_report_messages, public.problem_report_files
  to authenticated;

alter table public.problem_reports enable row level security;
alter table public.problem_report_messages enable row level security;
alter table public.problem_report_files enable row level security;

create policy problem_reports_select on public.problem_reports
  for select to authenticated
  using (
    created_by = (select auth.uid())
    and organization_id in (select private.user_org_ids())
  );

create policy problem_report_messages_select on public.problem_report_messages
  for select to authenticated
  using (
    organization_id in (select private.user_org_ids())
    and report_id in (select r.id from public.problem_reports r where r.created_by = (select auth.uid()))
  );

create policy problem_report_files_select on public.problem_report_files
  for select to authenticated
  using (
    organization_id in (select private.user_org_ids())
    and report_id in (select r.id from public.problem_reports r where r.created_by = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- lock_guard: attach to the new tables, and let them through while locked
-- (copy of the latest definition, 20261110140000, with the new tables added)
-- ---------------------------------------------------------------------------
create trigger lock_guard before insert or update or delete on public.problem_reports
  for each row execute function private.lock_guard();
create trigger lock_guard before insert or update or delete on public.problem_report_messages
  for each row execute function private.lock_guard();
create trigger lock_guard before insert or update or delete on public.problem_report_files
  for each row execute function private.lock_guard();

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

revoke all on function private.lock_guard() from public, anon;

-- ---------------------------------------------------------------------------
-- Storage: private bucket problem-report-files, path <org>/<report>/<file>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'problem-report-files', 'problem-report-files', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create function private.storage_report_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 2)::uuid
  end
$$;

-- Upload and read: only into / from a report the caller wrote, in a firm the
-- caller is currently a member of (Zcore reads through the server).
create function private.is_own_problem_report_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.problem_reports r
    where r.id = private.storage_report_id(p_name)
      and r.organization_id = private.storage_org_id(p_name)
      and r.created_by = (select auth.uid())
      and r.organization_id in (select private.user_org_ids())
  )
$$;

revoke all on function private.storage_report_id(text) from public, anon;
revoke all on function private.is_own_problem_report_file(text) from public, anon;
grant execute on function private.storage_report_id(text) to authenticated;
grant execute on function private.is_own_problem_report_file(text) to authenticated;

create policy problem_report_files_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'problem-report-files' and private.is_own_problem_report_file(name));
create policy problem_report_files_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'problem-report-files' and private.is_own_problem_report_file(name));

-- ---------------------------------------------------------------------------
-- Member RPCs
-- ---------------------------------------------------------------------------
create function public.submit_problem_report(
  p_org uuid, p_category text, p_description text, p_page_path text,
  p_user_agent text, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_path text := nullif(left(split_part(split_part(btrim(coalesce(p_page_path, '')), '?', 1), '#', 1), 300), '');
begin
  if v_uid is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = p_org)
    or exists (select 1 from public.organizations o where o.id = p_org and o.is_platform)
    or exists (select 1 from public.profiles p where p.id = v_uid and p.is_support) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;

  select r.id into v_id from public.problem_reports r
  where r.idempotency_key = p_idempotency_key and r.created_by = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  if p_category is null or p_category not in ('broken', 'slow', 'howto', 'idea', 'billing', 'other')
    or (v_description is not null and length(v_description) > 4000)
    or (p_category = 'other' and v_description is null) then
    raise exception 'invalid report' using errcode = '22023';
  end if;

  insert into public.problem_reports
    (organization_id, created_by, category, description, page_path, user_agent, idempotency_key)
  values
    (p_org, v_uid, p_category, v_description, v_path,
     nullif(left(btrim(coalesce(p_user_agent, '')), 500), ''), p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    -- The key belongs to somebody else's report: do not reveal it.
    raise exception 'invalid report' using errcode = '22023';
  end if;

  perform private.write_audit_as(p_org, 'problem_report.created', 'problem_reports', v_id::text,
    null, jsonb_build_object('category', p_category, 'page_path', v_path));
  return v_id;
end;
$$;

create function public.reply_problem_report(p_org uuid, p_report_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = p_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select r.status into v_status from public.problem_reports r
  where r.id = p_report_id and r.organization_id = p_org and r.created_by = v_uid
  for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if length(v_body) not between 1 and 4000 then
    raise exception 'invalid message' using errcode = '22023';
  end if;

  insert into public.problem_report_messages (organization_id, report_id, author_id, from_zcore, body)
  values (p_org, p_report_id, v_uid, false, v_body)
  returning id into v_id;

  update public.problem_reports
  set last_message_at = now(),
      updated_at = now(),
      status = case when status in ('waiting_user', 'resolved') then 'in_progress' else status end,
      resolved_at = case when status in ('waiting_user', 'resolved') then null else resolved_at end
  where id = p_report_id;

  if v_status in ('waiting_user', 'resolved') then
    perform private.write_audit_as(p_org, 'problem_report.status_changed', 'problem_reports',
      p_report_id::text, jsonb_build_object('status', v_status), jsonb_build_object('status', 'in_progress'));
  end if;
  return v_id;
end;
$$;

create function public.register_problem_report_file(
  p_org uuid, p_report_id uuid, p_path text, p_mime text, p_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = p_org)
    or not exists (
      select 1 from public.problem_reports r
      where r.id = p_report_id and r.organization_id = p_org and r.created_by = v_uid
    ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_path is null or p_path not like p_org::text || '/' || p_report_id::text || '/%'
    or p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp')
    or p_size is null or p_size not between 1 and 10485760 then
    raise exception 'invalid file' using errcode = '22023';
  end if;

  insert into public.problem_report_files
    (organization_id, report_id, storage_path, mime_type, size_bytes, created_by)
  values (p_org, p_report_id, p_path, p_mime, p_size, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Zcore RPCs
-- ---------------------------------------------------------------------------
create function public.platform_problem_reports(
  p_status text default null, p_category text default null, p_org uuid default null
)
returns table (
  id uuid, organization_id uuid, organization_name text, category text, status text,
  description text, created_at timestamptz, last_message_at timestamptz,
  author_name text, message_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_permission('platform.read');
  return query
  select r.id, r.organization_id, o.name, r.category, r.status, r.description, r.created_at,
    r.last_message_at, coalesce(p.full_name, p.username),
    (select count(*) from public.problem_report_messages m where m.report_id = r.id)
  from public.problem_reports r
  join public.organizations o on o.id = r.organization_id
  left join public.profiles p on p.id = r.created_by
  where (p_status is null or r.status = p_status)
    and (p_category is null or r.category = p_category)
    and (p_org is null or r.organization_id = p_org)
  order by coalesce(r.last_message_at, r.created_at) desc
  limit 500;
end;
$$;

create function public.platform_problem_report(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_platform_permission('platform.read');
  select jsonb_build_object(
    'report', to_jsonb(r),
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug),
    'author', jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'author_id', m.author_id, 'from_zcore', m.from_zcore, 'body', m.body,
        'created_at', m.created_at,
        'author_name', coalesce(ap.full_name, ap.username)) order by m.created_at)
      from public.problem_report_messages m
      left join public.profiles ap on ap.id = m.author_id
      where m.report_id = r.id), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.created_at)
      from public.problem_report_files f where f.report_id = r.id), '[]'::jsonb),
    -- Scheduled support sessions link here once support_access_requests
    -- carries problem_report_id.
    'access_requests', '[]'::jsonb
  )
  into v_result
  from public.problem_reports r
  join public.organizations o on o.id = r.organization_id
  left join public.profiles p on p.id = r.created_by
  where r.id = p_id;
  if v_result is null then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create function public.platform_reply_problem_report(
  p_id uuid, p_body text, p_status text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_report public.problem_reports;
  v_body text := btrim(coalesce(p_body, ''));
  v_status text;
  v_id uuid;
begin
  perform private.require_platform_permission('platform.reports.manage');
  select * into v_report from public.problem_reports r where r.id = p_id for update;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if length(v_body) not between 1 and 4000
    or (p_status is not null and p_status not in ('new', 'in_progress', 'waiting_user', 'resolved')) then
    raise exception 'invalid reply' using errcode = '22023';
  end if;
  -- A reply to a new report means it is being handled.
  v_status := coalesce(p_status, case when v_report.status = 'new' then 'in_progress' else v_report.status end);

  insert into public.problem_report_messages (organization_id, report_id, author_id, from_zcore, body)
  values (v_report.organization_id, p_id, v_uid, true, v_body)
  returning id into v_id;

  update public.problem_reports
  set last_message_at = now(),
      updated_at = now(),
      status = v_status,
      resolved_at = case when v_status = 'resolved' then coalesce(resolved_at, now()) else null end
  where id = p_id;

  if v_status is distinct from v_report.status then
    perform private.write_audit_as(v_report.organization_id, 'problem_report.status_changed',
      'problem_reports', p_id::text, jsonb_build_object('status', v_report.status),
      jsonb_build_object('status', v_status));
  end if;
  return v_id;
end;
$$;

create function public.platform_set_problem_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.problem_reports;
begin
  perform private.require_platform_permission('platform.reports.manage');
  if p_status is null or p_status not in ('new', 'in_progress', 'waiting_user', 'resolved') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select * into v_report from public.problem_reports r where r.id = p_id for update;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if v_report.status = p_status then
    return;
  end if;

  update public.problem_reports
  set status = p_status,
      updated_at = now(),
      resolved_at = case when p_status = 'resolved' then now() else null end
  where id = p_id;

  perform private.write_audit_as(v_report.organization_id, 'problem_report.status_changed',
    'problem_reports', p_id::text, jsonb_build_object('status', v_report.status),
    jsonb_build_object('status', p_status));
end;
$$;

revoke all on function public.submit_problem_report(uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.reply_problem_report(uuid, uuid, text) from public, anon;
revoke all on function public.register_problem_report_file(uuid, uuid, text, text, bigint) from public, anon;
revoke all on function public.platform_problem_reports(text, text, uuid) from public, anon;
revoke all on function public.platform_problem_report(uuid) from public, anon;
revoke all on function public.platform_reply_problem_report(uuid, text, text) from public, anon;
revoke all on function public.platform_set_problem_status(uuid, text) from public, anon;
grant execute on function public.submit_problem_report(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.reply_problem_report(uuid, uuid, text) to authenticated;
grant execute on function public.register_problem_report_file(uuid, uuid, text, text, bigint) to authenticated;
grant execute on function public.platform_problem_reports(text, text, uuid) to authenticated;
grant execute on function public.platform_problem_report(uuid) to authenticated;
grant execute on function public.platform_reply_problem_report(uuid, text, text) to authenticated;
grant execute on function public.platform_set_problem_status(uuid, text) to authenticated;
