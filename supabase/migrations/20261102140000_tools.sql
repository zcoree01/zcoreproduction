-- Inventory part E: tool warehouse (D-035).
--   * tools.read / tools.manage (module inventory).
--   * tools: catalog (code, name, kind tool / insert, cutting edges of an
--     insert, home machine of a tool dedicated to one machine, minimum).
--   * tool_movements: ledger in pieces per tool and location (the stock
--     locations of D-031; a machine gets its own location on first issue).
--     Kinds: receipt, issue / return / transfer (out + in pairs), scrap,
--     consume (an insert taken on a tool change). Stock = sum, never below 0.
--   * machine_inserts: the insert in use per machine and insert type with the
--     cutting edges used (state, not stock).
--   * record_tool_change_with_tool: the worker picks the tool; for inserts
--     "new" takes one piece from the machine and starts at edge 1, "next
--     edge" turns the current insert (refused when all edges are used).
--     production_tool_changes gets tool_id, insert_action and edge_no; the old
--     free-text function stays for organizations without a tool catalog.

insert into public.permissions (key, module_key, description, default_roles) values
  ('tools.read', 'inventory', 'View tools and where they are',
    '{admin,director,head_of_production,warehouse}'),
  ('tools.manage', 'inventory', 'Manage the tool catalog and move tools',
    '{admin,head_of_production,warehouse}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.key in ('tools.read', 'tools.manage')
on conflict do nothing;

create table public.tools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  code text not null check (length(btrim(code)) between 1 and 40),
  name text not null check (length(btrim(name)) between 1 and 200),
  kind text not null check (kind in ('tool', 'insert')),
  -- Inserts: cutting edges of one insert.
  cutting_edges integer check (cutting_edges between 1 and 20),
  -- A tool dedicated to one machine stays there.
  home_machine_id uuid,
  min_stock integer check (min_stock >= 0),
  supplier text check (length(btrim(supplier)) between 1 and 200),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, home_machine_id)
    references public.machines (organization_id, id) on delete restrict,
  check ((kind = 'insert') = (cutting_edges is not null))
);

create unique index tools_code_key on public.tools (organization_id, lower(btrim(code)))
  where archived_at is null;

create trigger tools_set_updated_at before update on public.tools
  for each row execute function private.set_updated_at();
create trigger tools_audit after insert or update on public.tools
  for each row execute function private.audit_row_change();

create table public.tool_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  tool_id uuid not null,
  location_id uuid not null,
  kind text not null check (kind in (
    'receipt', 'issue_out', 'issue_in', 'return_out', 'return_in', 'transfer_out', 'transfer_in',
    'scrap', 'consume'
  )),
  quantity integer not null check (quantity <> 0),
  reason text check (length(btrim(reason)) between 1 and 500),
  tool_change_id uuid,
  idempotency_key text not null check (length(idempotency_key) between 1 and 100),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, tool_id)
    references public.tools (organization_id, id) on delete restrict,
  foreign key (organization_id, location_id)
    references public.stock_locations (organization_id, id) on delete restrict,
  foreign key (organization_id, tool_change_id)
    references public.production_tool_changes (organization_id, id) on delete restrict,
  check (sign(quantity) = case when kind in ('receipt', 'issue_in', 'return_in', 'transfer_in') then 1 else -1 end),
  check (kind <> 'scrap' or reason is not null)
);

create index tool_movements_tool_idx on public.tool_movements (organization_id, tool_id, location_id);

create trigger tool_movements_append_only before update on public.tool_movements
  for each row execute function private.prevent_stock_movement_update();

create view public.tool_balances with (security_invoker = true) as
select m.organization_id, m.tool_id, m.location_id, sum(m.quantity)::integer as quantity
from public.tool_movements m
group by m.organization_id, m.tool_id, m.location_id
having sum(m.quantity) <> 0;

create table public.machine_inserts (
  organization_id uuid not null,
  machine_id uuid not null,
  tool_id uuid not null,
  edges_used integer not null check (edges_used >= 1),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (machine_id, tool_id),
  foreign key (organization_id, machine_id)
    references public.machines (organization_id, id) on delete restrict,
  foreign key (organization_id, tool_id)
    references public.tools (organization_id, id) on delete restrict
);

alter table public.production_tool_changes
  add column tool_id uuid,
  add column insert_action text check (insert_action in ('new', 'next_edge')),
  add column edge_no integer check (edge_no >= 1),
  add constraint production_tool_changes_tool_fkey foreign key (organization_id, tool_id)
    references public.tools (organization_id, id) on delete restrict,
  add constraint production_tool_changes_insert_check
    check ((insert_action is null) = (edge_no is null));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Location of a machine (created on first use).
create function private.machine_location(p_org_id uuid, p_machine_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_machine public.machines;
begin
  select l.id into v_id from public.stock_locations l
  where l.organization_id = p_org_id and l.machine_id = p_machine_id and l.archived_at is null
  order by l.created_at
  limit 1;
  if v_id is not null then return v_id; end if;
  select * into v_machine from public.machines m
  where m.id = p_machine_id and m.organization_id = p_org_id;
  if v_machine.id is null then
    raise exception 'machine_not_found' using errcode = 'P0002';
  end if;
  insert into public.stock_locations (organization_id, kind, machine_id, code, name)
  values (p_org_id, 'machine', p_machine_id,
    left(regexp_replace(v_machine.code, '[^A-Za-z0-9._/-]', '-', 'g'), 20), v_machine.name)
  returning id into v_id;
  return v_id;
end;
$$;

create function private.assert_tool_not_negative(p_tool_id uuid, p_location_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select sum(m.quantity) from public.tool_movements m
      where m.tool_id = p_tool_id and m.location_id = p_location_id), 0) < 0 then
    raise exception 'negative_stock' using errcode = '23514';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Movements
-- ---------------------------------------------------------------------------
-- p_kind: receipt (to p_to), issue (p_from → machine p_machine_id), return
-- (machine location p_from → p_to), transfer (p_from → p_to), scrap (from
-- p_from, reason required).
create function public.move_tool(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_kind text,
  p_tool_id uuid,
  p_quantity integer,
  p_from uuid default null,
  p_to uuid default null,
  p_machine_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to uuid := p_to;
  v_reason text := nullif(btrim(p_reason), '');
  v_key text := p_idempotency_key::text;
begin
  perform private.assert_finished_access(p_org_id, 'tools.manage');
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.tool_movements m
    where m.organization_id = p_org_id and m.idempotency_key like v_key || '%'
  ) then
    return;
  end if;
  if not exists (
    select 1 from public.tools t
    where t.id = p_tool_id and t.organization_id = p_org_id and t.archived_at is null
  ) then
    raise exception 'tool_not_found' using errcode = 'P0002';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tool:' || p_tool_id::text, 0));

  if p_kind = 'issue' then
    v_to := private.machine_location(p_org_id, p_machine_id);
  end if;
  if p_kind in ('receipt', 'return', 'transfer', 'issue') then
    perform private.assert_stock_location(p_org_id, v_to);
  end if;
  if p_kind in ('issue', 'return', 'transfer', 'scrap') then
    perform private.assert_stock_location(p_org_id, p_from);
  end if;
  if p_kind in ('issue', 'return', 'transfer') and p_from = v_to then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  case p_kind
    when 'receipt' then
      insert into public.tool_movements (organization_id, tool_id, location_id, kind, quantity, reason, idempotency_key)
      values (p_org_id, p_tool_id, v_to, 'receipt', p_quantity, v_reason, v_key);
    when 'scrap' then
      if v_reason is null then
        raise exception 'reason_required' using errcode = '22023';
      end if;
      insert into public.tool_movements (organization_id, tool_id, location_id, kind, quantity, reason, idempotency_key)
      values (p_org_id, p_tool_id, p_from, 'scrap', -p_quantity, v_reason, v_key);
    when 'issue', 'return', 'transfer' then
      insert into public.tool_movements (organization_id, tool_id, location_id, kind, quantity, reason, idempotency_key)
      values
        (p_org_id, p_tool_id, p_from, p_kind || '_out', -p_quantity, v_reason, v_key || ':out'),
        (p_org_id, p_tool_id, v_to, p_kind || '_in', p_quantity, v_reason, v_key || ':in');
    else
      raise exception 'invalid_line' using errcode = '22023';
  end case;

  if p_kind <> 'receipt' then
    perform private.assert_tool_not_negative(p_tool_id, p_from);
  end if;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'tool.' || p_kind, 'tools', p_tool_id::text,
    jsonb_build_object('quantity', p_quantity, 'from', p_from, 'to', v_to, 'reason', v_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- Tool change with a tool of the catalog (floor)
-- ---------------------------------------------------------------------------
create function public.record_tool_change_with_tool(
  p_operation_id uuid,
  p_tool_id uuid,
  p_insert_action text,
  p_reason_id uuid,
  p_minutes numeric,
  p_notes text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_tool public.tools;
  v_employee uuid;
  v_id uuid;
  v_location uuid;
  v_state public.machine_inserts;
  v_edge integer;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select t.id into v_id from public.production_tool_changes t
  where t.idempotency_key = p_idempotency_key and t.operation_id = p_operation_id;
  if v_id is not null then
    return v_id;
  end if;

  v_employee := private.record_access(p_operation_id, true);
  select * into v_op from public.production_order_operations o where o.id = p_operation_id;
  select * into v_tool from public.tools t
  where t.id = p_tool_id and t.organization_id = v_op.organization_id and t.archived_at is null;
  if v_tool.id is null then
    raise exception 'tool_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.catalog_items c
    where c.id = p_reason_id and c.organization_id = v_op.organization_id
      and c.kind = 'tool_change_reason' and c.archived_at is null
  ) then
    raise exception 'tool_change_reason_required' using errcode = '22023';
  end if;
  if p_minutes is not null and (p_minutes <= 0 or p_minutes > 1440 or p_minutes <> round(p_minutes, 2)) then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  if (v_tool.kind = 'insert') <> (p_insert_action is not null)
    or p_insert_action not in ('new', 'next_edge') then
    raise exception 'insert_action_required' using errcode = '22023';
  end if;
  if v_tool.kind = 'insert' and v_op.machine_id is null then
    raise exception 'machine_assignment_missing' using errcode = '22023';
  end if;

  if v_tool.kind = 'insert' then
    perform pg_advisory_xact_lock(hashtextextended('tool:' || v_tool.id::text, 0));
    select * into v_state from public.machine_inserts s
    where s.machine_id = v_op.machine_id and s.tool_id = v_tool.id
    for update;
    if p_insert_action = 'next_edge' then
      if v_state.machine_id is null then
        raise exception 'no_insert_in_use' using errcode = '23514';
      end if;
      if v_state.edges_used >= v_tool.cutting_edges then
        raise exception 'no_edges_left' using errcode = '23514';
      end if;
      v_edge := v_state.edges_used + 1;
      update public.machine_inserts set edges_used = v_edge, updated_at = now()
        where machine_id = v_op.machine_id and tool_id = v_tool.id;
    else
      v_edge := 1;
      insert into public.machine_inserts (organization_id, machine_id, tool_id, edges_used)
      values (v_op.organization_id, v_op.machine_id, v_tool.id, 1)
      on conflict (machine_id, tool_id) do update
        set edges_used = 1, opened_at = now(), updated_at = now();
    end if;
  end if;

  insert into public.production_tool_changes (
    organization_id, order_id, operation_id, machine_id, employee_id, tool, insert_name, reason_id,
    duration_min, notes, idempotency_key, tool_id, insert_action, edge_no
  ) values (
    v_op.organization_id, v_op.order_id, p_operation_id, v_op.machine_id, v_employee,
    v_tool.code || ' ' || v_tool.name, null, p_reason_id, p_minutes, nullif(btrim(p_notes), ''),
    p_idempotency_key, v_tool.id, p_insert_action, v_edge
  )
  returning id into v_id;

  -- A new insert leaves the machine's stock.
  if p_insert_action = 'new' then
    v_location := private.machine_location(v_op.organization_id, v_op.machine_id);
    insert into public.tool_movements (
      organization_id, tool_id, location_id, kind, quantity, tool_change_id, idempotency_key
    ) values (
      v_op.organization_id, v_tool.id, v_location, 'consume', -1, v_id,
      'change:' || p_idempotency_key::text
    );
    perform private.assert_tool_not_negative(v_tool.id, v_location);
  end if;
  return v_id;
end;
$$;

-- Tools at the machine of an operation the caller sees (floor tool change).
create function public.floor_operation_tools(p_operation_id uuid)
returns table (
  tool_id uuid,
  code text,
  name text,
  kind text,
  cutting_edges integer,
  at_machine integer,
  edges_used integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
begin
  if not private.can_view_order_operation(p_operation_id) then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  select * into v_op from public.production_order_operations o where o.id = p_operation_id;
  return query
  select t.id, t.code, t.name, t.kind, t.cutting_edges,
    coalesce((select sum(m.quantity) from public.tool_movements m
      join public.stock_locations l on l.id = m.location_id
      where m.tool_id = t.id and l.machine_id = v_op.machine_id), 0)::integer,
    (select s.edges_used from public.machine_inserts s
      where s.tool_id = t.id and s.machine_id = v_op.machine_id)
  from public.tools t
  where t.organization_id = v_op.organization_id and t.archived_at is null
  order by t.code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke all on public.tools, public.tool_movements, public.tool_balances, public.machine_inserts
  from anon, authenticated;
grant select on public.tools, public.tool_movements, public.tool_balances, public.machine_inserts
  to authenticated;
grant insert (organization_id, code, name, kind, cutting_edges, home_machine_id, min_stock,
    supplier, notes),
  update (code, name, kind, cutting_edges, home_machine_id, min_stock, supplier, notes,
    archived_at)
  on public.tools to authenticated;

alter table public.tools enable row level security;
alter table public.tool_movements enable row level security;
alter table public.machine_inserts enable row level security;

create policy tools_select on public.tools
  for select to authenticated
  using (private.has_permission(organization_id, 'tools.read'));
create policy tools_insert on public.tools
  for insert to authenticated
  with check (private.has_permission(organization_id, 'tools.manage'));
create policy tools_update on public.tools
  for update to authenticated
  using (private.has_permission(organization_id, 'tools.manage'))
  with check (private.has_permission(organization_id, 'tools.manage'));
create policy tool_movements_select on public.tool_movements
  for select to authenticated
  using (private.has_permission(organization_id, 'tools.read'));
create policy machine_inserts_select on public.machine_inserts
  for select to authenticated
  using (private.has_permission(organization_id, 'tools.read'));

revoke execute on function
  private.machine_location(uuid, uuid),
  private.assert_tool_not_negative(uuid, uuid)
  from public;

revoke execute on function
  public.move_tool(uuid, uuid, text, uuid, integer, uuid, uuid, uuid, text),
  public.record_tool_change_with_tool(uuid, uuid, text, uuid, numeric, text, uuid),
  public.floor_operation_tools(uuid)
  from public, anon;
grant execute on function
  public.move_tool(uuid, uuid, text, uuid, integer, uuid, uuid, uuid, text),
  public.record_tool_change_with_tool(uuid, uuid, text, uuid, numeric, text, uuid),
  public.floor_operation_tools(uuid)
  to authenticated;
