-- Inventory part C: stock counts (D-033).
--   * stock_counts: a count of one location (a warehouse includes its
--     shelves), optionally of one item. Opening it snapshots the expected
--     stock per item / lot / location / piece size into stock_count_lines.
--   * The warehouse (inventory.move) enters the counted amount per line and
--     adds found material as new lines; then submits the count.
--   * inventory.adjust.approve posts it: differences (counted − expected at
--     opening; lines left uncounted change nothing) become one correction
--     document posted through the existing correction path (ledger,
--     negative-stock check, audit), or cancels it.
--   * Correction documents may now hold more lines (counts of a warehouse).

alter table public.stock_adjustment_lines drop constraint stock_adjustment_lines_line_no_check;
alter table public.stock_adjustment_lines
  add constraint stock_adjustment_lines_line_no_check check (line_no between 1 and 10000);
alter table public.stock_movements drop constraint stock_movements_line_no_check;
alter table public.stock_movements
  add constraint stock_movements_line_no_check check (line_no between 1 and 20000);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  number text not null,
  location_id uuid not null,
  -- Only this item (null: everything at the location).
  item_id uuid,
  status text not null default 'open'
    check (status in ('open', 'submitted', 'posted', 'cancelled')),
  notes text check (length(notes) <= 2000),
  idempotency_key uuid not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_by uuid,
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (length(btrim(decision_note)) between 1 and 500),
  adjustment_document_id uuid,
  unique (organization_id, id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, location_id)
    references public.stock_locations (organization_id, id) on delete restrict,
  foreign key (organization_id, item_id)
    references public.stock_items (organization_id, id) on delete restrict,
  foreign key (organization_id, adjustment_document_id)
    references public.stock_documents (organization_id, id) on delete restrict,
  check (status <> 'cancelled' or decision_note is not null)
);

create index stock_counts_status_idx on public.stock_counts (organization_id, status, created_at desc);

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  count_id uuid not null,
  item_id uuid not null,
  -- Null: found material without a known lot (a new lot on posting).
  lot_id uuid,
  location_id uuid not null,
  length_mm numeric(10, 1) check (length_mm > 0),
  width_mm numeric(10, 1) check (width_mm > 0),
  -- Snapshot at opening (0 for found lines).
  expected_pieces integer check (expected_pieces >= 0),
  expected_quantity numeric(18, 6) not null default 0 check (expected_quantity >= 0),
  -- Entered by the warehouse; null = not counted yet.
  counted_pieces integer check (counted_pieces >= 0),
  counted_quantity numeric(18, 6) check (counted_quantity >= 0),
  counted_by uuid,
  counted_at timestamptz,
  found boolean not null default false,
  unique (organization_id, id),
  foreign key (organization_id, count_id)
    references public.stock_counts (organization_id, id) on delete restrict,
  foreign key (organization_id, item_id)
    references public.stock_items (organization_id, id) on delete restrict,
  foreign key (organization_id, item_id, lot_id)
    references public.stock_lots (organization_id, item_id, id) on delete restrict,
  foreign key (organization_id, location_id)
    references public.stock_locations (organization_id, id) on delete restrict,
  check ((length_mm is null) = (expected_pieces is null)),
  check (width_mm is null or length_mm is not null),
  check (found or lot_id is not null)
);

create index stock_count_lines_count_idx on public.stock_count_lines (organization_id, count_id);
create unique index stock_count_lines_bucket_key
  on public.stock_count_lines (count_id, item_id, coalesce(lot_id::text, ''), location_id,
    coalesce(length_mm, 0), coalesce(width_mm, 0))
  where not found;

-- Locations a count covers: the location and, for a warehouse, its shelves.
create function private.count_locations(p_location_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id from public.stock_locations l
  where l.id = p_location_id or l.parent_id = p_location_id
$$;

-- ---------------------------------------------------------------------------
-- Open
-- ---------------------------------------------------------------------------
create function public.open_stock_count(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_location_id uuid,
  p_item_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_inventory_access(p_org_id, 'inventory.move');
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select c.id into v_id from public.stock_counts c
  where c.organization_id = p_org_id and c.idempotency_key = p_idempotency_key;
  if found then return v_id; end if;

  perform private.assert_stock_location(p_org_id, p_location_id);
  if p_item_id is not null and not exists (
    select 1 from public.stock_items i where i.id = p_item_id and i.organization_id = p_org_id
  ) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  insert into public.stock_counts (
    organization_id, number, location_id, item_id, notes, idempotency_key
  ) values (
    p_org_id, private.next_stock_number(p_org_id, 'IN', 'stock_count'), p_location_id,
    p_item_id, nullif(btrim(p_notes), ''), p_idempotency_key
  )
  returning id into v_id;

  insert into public.stock_count_lines (
    organization_id, count_id, item_id, lot_id, location_id, length_mm, width_mm,
    expected_pieces, expected_quantity
  )
  select p_org_id, v_id, b.item_id, b.lot_id, b.location_id, b.length_mm, b.width_mm,
    b.pieces, b.quantity
  from public.stock_balances b
  where b.organization_id = p_org_id
    and b.location_id in (select private.count_locations(p_location_id))
    and (p_item_id is null or b.item_id = p_item_id)
    and b.quantity > 0;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'stock.count_opened', 'stock_counts', v_id::text,
    jsonb_build_object('location_id', p_location_id, 'item_id', p_item_id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Counting (open counts only)
-- ---------------------------------------------------------------------------
create function private.open_count_for_update(p_count_id uuid)
returns public.stock_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.stock_counts;
begin
  select * into v_count from public.stock_counts c where c.id = p_count_id for update;
  if v_count.id is null or not private.has_permission(v_count.organization_id, 'inventory.read') then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_inventory_access(v_count.organization_id, 'inventory.move');
  if v_count.status <> 'open' then
    raise exception 'count_not_open' using errcode = '55000';
  end if;
  return v_count;
end;
$$;

-- p_counted: pieces (dimensioned items) or quantity (kg / pcs); null clears.
create function public.set_count_line(p_line_id uuid, p_counted numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.stock_count_lines;
  v_unit text;
begin
  select * into v_line from public.stock_count_lines l where l.id = p_line_id;
  if v_line.id is null then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  perform private.open_count_for_update(v_line.count_id);
  select i.base_unit into v_unit from public.stock_items i where i.id = v_line.item_id;
  if p_counted is not null and (p_counted < 0
    or (v_unit in ('mm', 'm2', 'pcs') and p_counted <> trunc(p_counted))) then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  update public.stock_count_lines set
    counted_pieces = case when v_unit in ('mm', 'm2') then p_counted::integer end,
    counted_quantity = case
      when p_counted is null then null
      when v_unit = 'mm' then p_counted * v_line.length_mm
      when v_unit = 'm2' then round(p_counted * v_line.length_mm * v_line.width_mm / 1000000, 6)
      else p_counted
    end,
    counted_by = case when p_counted is null then null else auth.uid() end,
    counted_at = case when p_counted is null then null else now() end
  where id = p_line_id;
end;
$$;

-- Found material: {item_id, lot_id (optional), location_id, length_mm,
-- width_mm, counted}.
create function public.add_count_line(p_count_id uuid, p_line jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.stock_counts;
  v_unit text;
  v_counted numeric := (p_line ->> 'counted')::numeric;
  v_length numeric := (p_line ->> 'length_mm')::numeric;
  v_width numeric := (p_line ->> 'width_mm')::numeric;
  v_quantity numeric;
  v_id uuid;
begin
  v_count := private.open_count_for_update(p_count_id);
  if (p_line ->> 'location_id')::uuid not in (select private.count_locations(v_count.location_id)) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if v_count.item_id is not null and (p_line ->> 'item_id')::uuid <> v_count.item_id then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_counted is null or v_counted <= 0 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;
  select i.base_unit into v_unit from public.stock_items i
  where i.id = (p_line ->> 'item_id')::uuid and i.organization_id = v_count.organization_id;
  if v_unit is null then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  v_quantity := private.stock_line_for_item(v_count.organization_id, (p_line ->> 'item_id')::uuid,
    case when v_unit in ('mm', 'm2') then v_counted::integer end, v_length, v_width,
    case when v_unit in ('mm', 'm2') then null else v_counted end, true);
  if v_unit in ('mm', 'm2', 'pcs') and v_counted <> trunc(v_counted) then
    raise exception 'invalid_line' using errcode = '22023';
  end if;
  if (p_line ->> 'lot_id') is not null and not exists (
    select 1 from public.stock_lots l
    where l.id = (p_line ->> 'lot_id')::uuid and l.item_id = (p_line ->> 'item_id')::uuid
  ) then
    raise exception 'lot_not_found' using errcode = 'P0002';
  end if;

  insert into public.stock_count_lines (
    organization_id, count_id, item_id, lot_id, location_id, length_mm, width_mm,
    expected_pieces, expected_quantity, counted_pieces, counted_quantity, counted_by,
    counted_at, found
  ) values (
    v_count.organization_id, p_count_id, (p_line ->> 'item_id')::uuid,
    (p_line ->> 'lot_id')::uuid, (p_line ->> 'location_id')::uuid, v_length, v_width,
    case when v_unit in ('mm', 'm2') then 0 end, 0,
    case when v_unit in ('mm', 'm2') then v_counted::integer end, v_quantity, auth.uid(), now(),
    true
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.submit_stock_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.stock_counts;
begin
  v_count := private.open_count_for_update(p_count_id);
  update public.stock_counts
    set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
    where id = p_count_id;
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id)
  values (v_count.organization_id, auth.uid(), 'stock.count_submitted', 'stock_counts',
    p_count_id::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Decision: post the differences or cancel
-- ---------------------------------------------------------------------------
create function public.decide_stock_count(p_count_id uuid, p_post boolean, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.stock_counts;
  v_note text := nullif(btrim(p_note), '');
  v_doc_id uuid;
  v_lines integer;
begin
  select * into v_count from public.stock_counts c where c.id = p_count_id for update;
  if v_count.id is null or not private.has_permission(v_count.organization_id, 'inventory.read') then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_inventory_access(v_count.organization_id, 'inventory.adjust.approve');
  if v_count.status not in ('open', 'submitted') or (p_post and v_count.status <> 'submitted') then
    raise exception 'count_not_submitted' using errcode = '55000';
  end if;
  if not p_post and v_note is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  if p_post then
    select count(*) into v_lines from public.stock_count_lines l
    where l.count_id = p_count_id and l.counted_quantity is not null
      and l.counted_quantity <> l.expected_quantity;

    if v_lines > 0 then
      insert into public.stock_documents (
        organization_id, kind, number, status, document_date, reason, idempotency_key
      ) values (
        v_count.organization_id, 'adjustment',
        private.next_stock_number(v_count.organization_id, 'KO', 'stock_adjustment'),
        'pending', current_date, 'Inventura ' || v_count.number, gen_random_uuid()
      )
      returning id into v_doc_id;

      insert into public.stock_adjustment_lines (
        organization_id, document_id, line_no, item_id, lot_id, location_id,
        length_mm, width_mm, pieces, quantity
      )
      select v_count.organization_id, v_doc_id,
        row_number() over (order by l.item_id, l.location_id, l.lot_id, l.length_mm),
        l.item_id, l.lot_id, l.location_id, l.length_mm, l.width_mm,
        case when l.length_mm is not null
          then l.counted_pieces - coalesce(l.expected_pieces, 0) end,
        case when l.length_mm is null then l.counted_quantity - l.expected_quantity end
      from public.stock_count_lines l
      where l.count_id = p_count_id and l.counted_quantity is not null
        and l.counted_quantity <> l.expected_quantity
        -- Pieces of one size: the difference is never zero pieces here.
        and (l.length_mm is null or l.counted_pieces <> coalesce(l.expected_pieces, 0));

      perform private.post_stock_adjustment(v_doc_id);
      update public.stock_documents
        set status = 'posted', decided_by = auth.uid(), decided_at = now()
        where id = v_doc_id;
    end if;
  end if;

  update public.stock_counts set
    status = case when p_post then 'posted' else 'cancelled' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
    adjustment_document_id = v_doc_id
  where id = p_count_id;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (v_count.organization_id, auth.uid(),
    case when p_post then 'stock.count_posted' else 'stock.count_cancelled' end,
    'stock_counts', p_count_id::text,
    jsonb_build_object('adjustment_document_id', v_doc_id, 'note', v_note));
  return v_doc_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke all on public.stock_counts, public.stock_count_lines from anon, authenticated;
grant select on public.stock_counts, public.stock_count_lines to authenticated;

alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;

create policy stock_counts_select on public.stock_counts
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read'));
create policy stock_count_lines_select on public.stock_count_lines
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read'));

revoke execute on function
  private.count_locations(uuid),
  private.open_count_for_update(uuid)
  from public;

revoke execute on function
  public.open_stock_count(uuid, uuid, uuid, uuid, text),
  public.set_count_line(uuid, numeric),
  public.add_count_line(uuid, jsonb),
  public.submit_stock_count(uuid),
  public.decide_stock_count(uuid, boolean, text)
  from public, anon;
grant execute on function
  public.open_stock_count(uuid, uuid, uuid, uuid, text),
  public.set_count_line(uuid, numeric),
  public.add_count_line(uuid, jsonb),
  public.submit_stock_count(uuid),
  public.decide_stock_count(uuid, boolean, text)
  to authenticated;
