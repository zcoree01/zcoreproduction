-- Inventory part B: material of production orders (D-032).
--   * production_orders.stock_item_id (taken from the revision when the order
--     is created or copied) and sheet_pieces_per_sheet (override of the
--     estimate for sheets / plates). "Treba rezanje" on order creation adds
--     a cutting operation as the first one or archives the routing's.
--   * Requirement (private.order_material_requirement): bars = quantity ×
--     (cut length + kerf), with pieces per bar and bars needed; sheets =
--     sheets needed × sheet area (pieces per sheet estimated by area or set
--     on the order), else quantity × piece area.
--   * stock_reservations: one open reservation per order for the full
--     requirement, kept in sync by a trigger when the order is released,
--     changed, sent back to draft, completed or cancelled. Remaining =
--     reservation − issued; coverage per order shows the shortage (FIFO by
--     due date over own stock plus the order customer's stock).
--   * New ledger kinds on production orders: issue (out), remnant (the
--     offcut of a bar / sheet cut in the warehouse, back into stock as its
--     own piece; own material only) and return (back from production).
--     Customer material may only be issued to orders of that customer.
--   * stock_order_consumption: consumed quantity confirmed by the warehouse,
--     separate from issued; proposal = (good + scrap of the first operation)
--     × material per piece.
--   * floor_order_material: what was issued to the order of an operation the
--     caller sees (operators).

-- ---------------------------------------------------------------------------
-- Orders: stock item and pieces per sheet
-- ---------------------------------------------------------------------------
alter table public.production_orders
  add column stock_item_id uuid,
  add column sheet_pieces_per_sheet integer check (sheet_pieces_per_sheet between 1 and 100000),
  add constraint production_orders_stock_item_fkey foreign key (organization_id, stock_item_id)
    references public.stock_items (organization_id, id) on delete restrict;

create index production_orders_stock_item_idx
  on public.production_orders (organization_id, stock_item_id);

grant insert (stock_item_id, sheet_pieces_per_sheet),
  update (stock_item_id, sheet_pieces_per_sheet)
  on public.production_orders to authenticated;

-- New and copied orders take the stock item of their revision.
create function private.default_order_stock_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stock_item_id is null then
    select r.stock_item_id into new.stock_item_id
    from public.product_revisions r
    where r.id = new.revision_id and r.organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

create trigger production_orders_default_stock_item before insert on public.production_orders
  for each row execute function private.default_order_stock_item();

-- ---------------------------------------------------------------------------
-- Ledger: movements on production orders
-- ---------------------------------------------------------------------------
alter table public.stock_documents drop constraint stock_documents_kind_check;
alter table public.stock_documents
  add constraint stock_documents_kind_check
    check (kind in ('receipt', 'transfer', 'adjustment', 'issue', 'return')),
  add column production_order_id uuid,
  add constraint stock_documents_order_fkey foreign key (organization_id, production_order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  add constraint stock_documents_order_check
    check ((kind in ('issue', 'return')) = (production_order_id is not null));

create index stock_documents_order_idx
  on public.stock_documents (organization_id, production_order_id);

alter table public.stock_movements drop constraint stock_movements_kind_check;
alter table public.stock_movements
  add constraint stock_movements_kind_check check (kind in (
    'receipt', 'transfer_out', 'transfer_in', 'adjustment', 'issue', 'remnant', 'return'
  )),
  add column production_order_id uuid,
  -- Issue of bars / sheets cut in the warehouse: pieces cut from each one.
  add column cut_pieces integer check (cut_pieces > 0),
  add constraint stock_movements_order_fkey foreign key (organization_id, production_order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  add constraint stock_movements_order_check
    check ((kind in ('issue', 'remnant', 'return')) = (production_order_id is not null)),
  add constraint stock_movements_cut_check check (kind = 'issue' or cut_pieces is null);

create index stock_movements_order_idx
  on public.stock_movements (organization_id, production_order_id, item_id)
  where production_order_id is not null;

-- The stock item of an order is fixed once material was issued to it.
create function private.guard_order_stock_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stock_item_id is distinct from old.stock_item_id and exists (
    select 1 from public.stock_movements m where m.production_order_id = old.id
  ) then
    raise exception 'order_material_issued' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger production_orders_guard_stock_item
  before update of stock_item_id on public.production_orders
  for each row execute function private.guard_order_stock_item();

-- ---------------------------------------------------------------------------
-- Requirement (mirrored in src/modules/inventory/order-rules.ts)
-- ---------------------------------------------------------------------------
-- quantity:        to reserve, in the item's base unit
-- per_piece:       material per piece (mm, or m² for sheets)
-- piece_width:     sheets: the other side of the piece (mm)
-- unit_length / unit_width: bar length / sheet size used for the count
-- pieces_per_unit: pieces per bar / sheet (sheets: the order's override wins)
-- units_needed:    bars / sheets for the ordered quantity
create function private.order_material_requirement(p_order_id uuid)
returns table (
  quantity numeric,
  per_piece numeric,
  piece_width numeric,
  unit_length numeric,
  unit_width numeric,
  pieces_per_unit integer,
  estimated boolean,
  units_needed integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_item public.stock_items;
  v_revision public.product_revisions;
  v_kerf numeric;
  v_width numeric;
  v_area numeric;
  v_per_unit integer;
begin
  select * into v_order from public.production_orders o where o.id = p_order_id;
  if v_order.id is null or v_order.stock_item_id is null or v_order.piece_length_mm is null
    or v_order.unit not in ('pcs', 'set') then
    return;
  end if;
  select * into v_item from public.stock_items i where i.id = v_order.stock_item_id;
  v_kerf := coalesce(v_order.kerf_mm, 0);

  if v_item.base_unit = 'mm' then
    per_piece := v_order.piece_length_mm + v_kerf;
    unit_length := coalesce(v_order.bar_length_mm, v_item.standard_length_mm);
    if unit_length is not null then
      v_per_unit := floor((unit_length - coalesce(v_order.bar_remnant_mm, 0)) / per_piece);
      if v_per_unit > 0 then
        pieces_per_unit := v_per_unit;
        units_needed := ceil(v_order.quantity / v_per_unit);
      end if;
    end if;
    estimated := false;
    quantity := v_order.quantity * per_piece;
    return next;
  elsif v_item.base_unit = 'm2' then
    select * into v_revision from public.product_revisions r where r.id = v_order.revision_id;
    -- The sheet thickness is one side of the rectangular blank; the other is the width.
    v_width := case
      when v_revision.blank_thickness_mm = v_item.thickness_mm then v_revision.blank_width_mm
      when v_revision.blank_width_mm = v_item.thickness_mm then v_revision.blank_thickness_mm
      else v_revision.blank_width_mm
    end;
    if v_width is null then return; end if;
    piece_width := v_width;
    per_piece := round((v_order.piece_length_mm + v_kerf) * (v_width + v_kerf) / 1000000, 6);
    unit_length := v_item.standard_length_mm;
    unit_width := v_item.standard_width_mm;
    if unit_length is not null and unit_width is not null then
      v_area := unit_length * unit_width / 1000000;
      v_per_unit := coalesce(v_order.sheet_pieces_per_sheet, floor(v_area / per_piece)::integer);
      estimated := v_order.sheet_pieces_per_sheet is null;
      if v_per_unit > 0 then
        pieces_per_unit := v_per_unit;
        units_needed := ceil(v_order.quantity / v_per_unit);
        quantity := round(units_needed * v_area, 6);
      end if;
    end if;
    quantity := coalesce(quantity, round(v_order.quantity * per_piece, 6));
    return next;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reservations
-- ---------------------------------------------------------------------------
create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  order_id uuid not null,
  item_id uuid not null,
  -- Full requirement in the item's base unit.
  quantity numeric(18, 6) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text check (release_reason in (
    'completed', 'cancelled', 'archived', 'draft', 'item_changed', 'no_requirement'
  )),
  unique (organization_id, id),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, item_id)
    references public.stock_items (organization_id, id) on delete restrict,
  check ((released_at is null) = (release_reason is null))
);

create unique index stock_reservations_open_key
  on public.stock_reservations (order_id) where released_at is null;
create index stock_reservations_item_idx
  on public.stock_reservations (organization_id, item_id) where released_at is null;

create trigger stock_reservations_set_updated_at before update on public.stock_reservations
  for each row execute function private.set_updated_at();

-- Keeps the order's reservation equal to its requirement while it is open.
create function private.sync_order_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity numeric;
  v_reason text;
begin
  if new.status in ('draft', 'completed', 'cancelled', 'archived') or new.stock_item_id is null then
    v_reason := case
      when new.status in ('draft', 'completed', 'cancelled', 'archived') then new.status
      else 'item_changed'
    end;
    update public.stock_reservations
      set released_at = now(), release_reason = v_reason
      where order_id = new.id and released_at is null;
    return null;
  end if;

  select r.quantity into v_quantity from private.order_material_requirement(new.id) r;
  if v_quantity is null or v_quantity <= 0 then
    update public.stock_reservations
      set released_at = now(), release_reason = 'no_requirement'
      where order_id = new.id and released_at is null;
    return null;
  end if;

  update public.stock_reservations
    set released_at = now(), release_reason = 'item_changed'
    where order_id = new.id and released_at is null and item_id <> new.stock_item_id;

  insert into public.stock_reservations (organization_id, order_id, item_id, quantity)
  values (new.organization_id, new.id, new.stock_item_id, v_quantity)
  on conflict (order_id) where released_at is null
  do update set quantity = excluded.quantity
  where public.stock_reservations.quantity is distinct from excluded.quantity;
  return null;
end;
$$;

create trigger production_orders_sync_reservation
  after update of status, quantity, piece_length_mm, kerf_mm, bar_length_mm, bar_remnant_mm,
    stock_item_id, sheet_pieces_per_sheet, revision_id
  on public.production_orders
  for each row execute function private.sync_order_reservation();

-- Open orders take the stock item of their revision (fires the reservation
-- trigger for released ones).
update public.production_orders o
set stock_item_id = r.stock_item_id
from public.product_revisions r
where r.id = o.revision_id and o.stock_item_id is null and r.stock_item_id is not null
  and o.status not in ('completed', 'cancelled', 'archived');

-- ---------------------------------------------------------------------------
-- Derived views (RLS of the underlying tables applies)
-- ---------------------------------------------------------------------------
-- Per order and item: issued (net of offcuts put back) and returned.
create view public.stock_order_issued with (security_invoker = true) as
select
  m.organization_id,
  m.production_order_id as order_id,
  m.item_id,
  coalesce(-sum(m.quantity) filter (where m.kind in ('issue', 'remnant')), 0) as issued,
  coalesce(sum(m.quantity) filter (where m.kind = 'return'), 0) as returned,
  coalesce(-sum(m.mass_kg) filter (where m.kind in ('issue', 'remnant')), 0) as issued_mass_kg,
  coalesce(-sum(m.value) filter (where m.kind in ('issue', 'remnant')), 0) as issued_value,
  coalesce(sum(m.value) filter (where m.kind = 'return'), 0) as returned_value
from public.stock_movements m
where m.production_order_id is not null
group by m.organization_id, m.production_order_id, m.item_id;

-- Stock per item and owner (null = own material).
create view public.stock_item_owner_totals with (security_invoker = true) as
select m.organization_id, m.item_id, l.owner_customer_id, sum(m.quantity) as quantity
from public.stock_movements m
join public.stock_lots l on l.id = m.lot_id
group by m.organization_id, m.item_id, l.owner_customer_id;

-- Open reservations with what is still to issue, and the shortage: orders are
-- served by due date (then release time) from own stock plus the stock of the
-- order's customer.
create view public.stock_order_coverage with (security_invoker = true) as
with open_reservations as (
  select
    r.organization_id,
    r.id as reservation_id,
    r.order_id,
    r.item_id,
    r.quantity,
    r.created_at,
    o.customer_id,
    o.due_date,
    coalesce(i.issued, 0) as issued,
    greatest(r.quantity - coalesce(i.issued, 0), 0) as remaining
  from public.stock_reservations r
  join public.production_orders o on o.id = r.order_id
  left join public.stock_order_issued i on i.order_id = r.order_id and i.item_id = r.item_id
  where r.released_at is null
),
ranked as (
  select
    x.*,
    coalesce(sum(x.remaining) over (
      partition by x.item_id order by x.due_date, x.created_at, x.reservation_id
      rows between unbounded preceding and 1 preceding
    ), 0) as claimed_before
  from open_reservations x
)
select
  x.organization_id,
  x.reservation_id,
  x.order_id,
  x.item_id,
  x.quantity,
  x.issued,
  x.remaining,
  pool.quantity as pool_quantity,
  greatest(x.remaining - greatest(pool.quantity - x.claimed_before, 0), 0) as shortage
from ranked x
cross join lateral (
  select coalesce(sum(t.quantity), 0) as quantity
  from public.stock_item_owner_totals t
  where t.item_id = x.item_id
    and (t.owner_customer_id is null or t.owner_customer_id = x.customer_id)
) pool;

-- Reserved (still to issue) per item.
create view public.stock_item_reserved with (security_invoker = true) as
select c.organization_id, c.item_id, sum(c.remaining) as reserved
from public.stock_order_coverage c
group by c.organization_id, c.item_id;

-- ---------------------------------------------------------------------------
-- Consumption confirmed by the warehouse
-- ---------------------------------------------------------------------------
create table public.stock_order_consumption (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  order_id uuid not null,
  item_id uuid not null,
  quantity numeric(18, 6) not null check (quantity >= 0),
  -- The proposal at the time of confirmation, for the record.
  proposed_quantity numeric(18, 6) check (proposed_quantity >= 0),
  note text check (length(btrim(note)) between 1 and 500),
  confirmed_by uuid default auth.uid(),
  confirmed_at timestamptz not null default now(),
  unique (order_id, item_id),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, item_id)
    references public.stock_items (organization_id, id) on delete restrict
);

create trigger stock_order_consumption_audit after insert or update on public.stock_order_consumption
  for each row execute function private.audit_row_change();

-- (good + scrap) of the first operation × material per piece.
create function private.order_consumption_proposal(p_order_id uuid)
returns table (pieces numeric, quantity numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with first_op as (
    select o.id from public.production_order_operations o
    where o.order_id = p_order_id and o.archived_at is null
    order by o.sequence
    limit 1
  ),
  reported as (
    select coalesce(sum(r.good_quantity + r.scrap_quantity), 0) as pieces
    from public.production_reports r
    where r.operation_id = (select id from first_op) and r.voided_at is null
  )
  select reported.pieces, round(reported.pieces * req.per_piece, 6)
  from reported
  cross join private.order_material_requirement(p_order_id) req
$$;

-- ---------------------------------------------------------------------------
-- Helpers for issues and returns
-- ---------------------------------------------------------------------------
-- Order of the organization that may receive material (released, not closed).
create function private.order_for_material(p_org_id uuid, p_order_id uuid, p_allow_closed boolean)
returns public.production_orders
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
begin
  select * into v_order from public.production_orders o
  where o.id = p_order_id and o.organization_id = p_org_id;
  if v_order.id is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_order.status = 'draft' or v_order.status = 'archived'
    or (not p_allow_closed and v_order.status in ('completed', 'cancelled')) then
    raise exception 'order_not_open' using errcode = '55000';
  end if;
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Issue to an order
-- ---------------------------------------------------------------------------
-- p_lines: [{item_id, lot_id, location_id, pieces, length_mm, width_mm,
--   quantity, cut_pieces, offcut_length_mm, offcut_width_mm,
--   offcut_location_id}]. Each line takes pieces of one size from one lot and
-- location. A bar / sheet cut in the warehouse puts its offcut (one per
-- piece taken, own material only) back into stock as a remnant.
create function public.post_stock_issue(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_order_id uuid,
  p_lines jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_id uuid;
  v_order public.production_orders;
  v_line jsonb;
  v_no integer := 0;
  v_item public.stock_items;
  v_lot public.stock_lots;
  v_quantity numeric;
  v_unit_cost numeric;
  v_kg numeric;
  v_pieces integer;
  v_length numeric;
  v_width numeric;
  v_off_length numeric;
  v_off_width numeric;
  v_off_location uuid;
  v_off_quantity numeric;
begin
  perform private.assert_inventory_access(p_org_id, 'inventory.move');
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;

  select d.id into v_doc_id from public.stock_documents d
  where d.organization_id = p_org_id and d.idempotency_key = p_idempotency_key;
  if found then return v_doc_id; end if;

  v_order := private.order_for_material(p_org_id, p_order_id, false);
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  perform private.lock_stock_items(p_org_id,
    array(select (l ->> 'item_id')::uuid from jsonb_array_elements(p_lines) l));

  insert into public.stock_documents (
    organization_id, kind, number, status, document_date, notes, idempotency_key,
    production_order_id
  ) values (
    p_org_id, 'issue', private.next_stock_number(p_org_id, 'IZ', 'stock_issue'), 'posted',
    current_date, nullif(btrim(p_notes), ''), p_idempotency_key, p_order_id
  )
  returning id into v_doc_id;

  for v_line in select e.value from jsonb_array_elements(p_lines) e loop
    v_pieces := (v_line ->> 'pieces')::integer;
    v_length := (v_line ->> 'length_mm')::numeric;
    v_width := (v_line ->> 'width_mm')::numeric;
    if coalesce(v_pieces, 1) <= 0 or coalesce((v_line ->> 'quantity')::numeric, 1) <= 0 then
      raise exception 'invalid_line' using errcode = '22023';
    end if;
    v_quantity := private.stock_line_for_item(p_org_id, (v_line ->> 'item_id')::uuid,
      v_pieces, v_length, v_width, (v_line ->> 'quantity')::numeric, true);
    select * into v_item from public.stock_items i where i.id = (v_line ->> 'item_id')::uuid;

    select * into v_lot from public.stock_lots l
    where l.id = (v_line ->> 'lot_id')::uuid and l.organization_id = p_org_id
      and l.item_id = v_item.id;
    if v_lot.id is null then
      raise exception 'lot_not_found' using errcode = 'P0002';
    end if;
    if v_lot.owner_customer_id is not null
      and v_lot.owner_customer_id is distinct from v_order.customer_id then
      raise exception 'customer_material' using errcode = '23514';
    end if;

    v_unit_cost := case when v_lot.owner_customer_id is null
      then private.stock_unit_cost(v_item.id) else 0 end;
    v_kg := private.stock_item_kg_per_unit(v_item.id);

    v_no := v_no + 1;
    insert into public.stock_movements (
      organization_id, document_id, line_no, kind, item_id, lot_id, location_id,
      length_mm, width_mm, pieces, quantity, mass_kg, value, cut_pieces, production_order_id,
      idempotency_key
    ) values (
      p_org_id, v_doc_id, v_no, 'issue', v_item.id, v_lot.id, (v_line ->> 'location_id')::uuid,
      v_length, v_width, -v_pieces, -v_quantity, -round(v_quantity * v_kg, 4),
      -round(v_quantity * v_unit_cost, 4), (v_line ->> 'cut_pieces')::integer, p_order_id,
      p_idempotency_key::text || ':' || v_no
    );

    v_off_length := (v_line ->> 'offcut_length_mm')::numeric;
    v_off_width := (v_line ->> 'offcut_width_mm')::numeric;
    if v_off_length is not null then
      if v_lot.owner_customer_id is not null then
        raise exception 'offcut_own_material_only' using errcode = '23514';
      end if;
      if v_item.base_unit = 'mm' and (v_off_length <= 0 or v_off_length >= v_length
          or v_off_width is not null)
        or v_item.base_unit = 'm2' and (v_off_width is null or v_off_length <= 0
          or v_off_width <= 0 or v_off_length > v_length or v_off_width > v_width
          or (v_off_length = v_length and v_off_width = v_width))
        or v_item.base_unit not in ('mm', 'm2') then
        raise exception 'invalid_offcut' using errcode = '22023';
      end if;
      v_off_location := coalesce((v_line ->> 'offcut_location_id')::uuid,
        (v_line ->> 'location_id')::uuid);
      perform private.assert_stock_location(p_org_id, v_off_location);
      v_off_quantity := private.stock_line_quantity(v_item.base_unit, v_pieces, v_off_length,
        v_off_width, null);

      v_no := v_no + 1;
      insert into public.stock_movements (
        organization_id, document_id, line_no, kind, item_id, lot_id, location_id,
        length_mm, width_mm, pieces, quantity, mass_kg, value, production_order_id,
        idempotency_key
      ) values (
        p_org_id, v_doc_id, v_no, 'remnant', v_item.id, v_lot.id, v_off_location,
        v_off_length, v_off_width, v_pieces, v_off_quantity, round(v_off_quantity * v_kg, 4),
        round(v_off_quantity * v_unit_cost, 4), p_order_id, p_idempotency_key::text || ':' || v_no
      );
    end if;
  end loop;

  perform private.assert_document_not_negative(v_doc_id);

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'stock.issue', 'stock_documents', v_doc_id::text,
    jsonb_build_object('order_id', p_order_id, 'lines', jsonb_array_length(p_lines)));

  return v_doc_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Return from production
-- ---------------------------------------------------------------------------
-- p_lines: [{item_id, lot_id, location_id, pieces, length_mm, width_mm,
--   quantity}]; the lot must have been issued to this order.
create function public.post_stock_return(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_order_id uuid,
  p_lines jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_id uuid;
  v_line jsonb;
  v_no integer := 0;
  v_lot public.stock_lots;
  v_item_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
begin
  perform private.assert_inventory_access(p_org_id, 'inventory.move');
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;

  select d.id into v_doc_id from public.stock_documents d
  where d.organization_id = p_org_id and d.idempotency_key = p_idempotency_key;
  if found then return v_doc_id; end if;

  perform private.order_for_material(p_org_id, p_order_id, true);
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  perform private.lock_stock_items(p_org_id,
    array(select (l ->> 'item_id')::uuid from jsonb_array_elements(p_lines) l));

  insert into public.stock_documents (
    organization_id, kind, number, status, document_date, notes, idempotency_key,
    production_order_id
  ) values (
    p_org_id, 'return', private.next_stock_number(p_org_id, 'PV', 'stock_return'), 'posted',
    current_date, nullif(btrim(p_notes), ''), p_idempotency_key, p_order_id
  )
  returning id into v_doc_id;

  for v_line in select e.value from jsonb_array_elements(p_lines) e loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    if coalesce((v_line ->> 'pieces')::integer, 1) <= 0
      or coalesce((v_line ->> 'quantity')::numeric, 1) <= 0 then
      raise exception 'invalid_line' using errcode = '22023';
    end if;
    v_quantity := private.stock_line_for_item(p_org_id, v_item_id,
      (v_line ->> 'pieces')::integer, (v_line ->> 'length_mm')::numeric,
      (v_line ->> 'width_mm')::numeric, (v_line ->> 'quantity')::numeric, true);
    perform private.assert_stock_location(p_org_id, (v_line ->> 'location_id')::uuid);

    select * into v_lot from public.stock_lots l
    where l.id = (v_line ->> 'lot_id')::uuid and l.organization_id = p_org_id
      and l.item_id = v_item_id;
    if v_lot.id is null or not exists (
      select 1 from public.stock_movements m
      where m.production_order_id = p_order_id and m.lot_id = v_lot.id and m.kind = 'issue'
    ) then
      raise exception 'lot_not_issued' using errcode = '23514';
    end if;

    v_unit_cost := case when v_lot.owner_customer_id is null
      then private.stock_unit_cost(v_item_id) else 0 end;

    v_no := v_no + 1;
    insert into public.stock_movements (
      organization_id, document_id, line_no, kind, item_id, lot_id, location_id,
      length_mm, width_mm, pieces, quantity, mass_kg, value, production_order_id,
      idempotency_key
    ) values (
      p_org_id, v_doc_id, v_no, 'return', v_item_id, v_lot.id, (v_line ->> 'location_id')::uuid,
      (v_line ->> 'length_mm')::numeric, (v_line ->> 'width_mm')::numeric,
      (v_line ->> 'pieces')::integer, v_quantity,
      round(v_quantity * private.stock_item_kg_per_unit(v_item_id), 4),
      round(v_quantity * v_unit_cost, 4), p_order_id, p_idempotency_key::text || ':' || v_no
    );
  end loop;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'stock.return', 'stock_documents', v_doc_id::text,
    jsonb_build_object('order_id', p_order_id, 'lines', jsonb_array_length(p_lines)));

  return v_doc_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Consumption
-- ---------------------------------------------------------------------------
create function public.confirm_order_consumption(
  p_order_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_proposal numeric;
begin
  select * into v_order from public.production_orders o where o.id = p_order_id;
  if v_order.id is null
    or not exists (select 1 from private.user_org_ids() as x (id) where x.id = v_order.organization_id) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_inventory_access(v_order.organization_id, 'inventory.move');
  perform private.order_for_material(v_order.organization_id, p_order_id, true);
  if p_quantity is null or p_quantity < 0 or p_quantity <> round(p_quantity, 6) then
    raise exception 'invalid_line' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.stock_items i
    where i.id = p_item_id and i.organization_id = v_order.organization_id
  ) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  select p.quantity into v_proposal from private.order_consumption_proposal(p_order_id) p;

  insert into public.stock_order_consumption (
    organization_id, order_id, item_id, quantity, proposed_quantity, note
  ) values (
    v_order.organization_id, p_order_id, p_item_id, p_quantity, v_proposal,
    nullif(btrim(p_note), '')
  )
  on conflict (order_id, item_id) do update
    set quantity = excluded.quantity, proposed_quantity = excluded.proposed_quantity,
      note = excluded.note, confirmed_by = auth.uid(), confirmed_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Material plan of an order (requirement + consumption proposal)
-- ---------------------------------------------------------------------------
create function public.order_material_plan(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_req record;
  v_proposal record;
begin
  select o.organization_id into v_org_id from public.production_orders o where o.id = p_order_id;
  if v_org_id is null or not (private.has_permission(v_org_id, 'orders.read')
    or private.has_permission(v_org_id, 'inventory.read')) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  select * into v_req from private.order_material_requirement(p_order_id);
  select * into v_proposal from private.order_consumption_proposal(p_order_id);
  return jsonb_build_object(
    'quantity', v_req.quantity,
    'per_piece', v_req.per_piece,
    'piece_width', v_req.piece_width,
    'unit_length', v_req.unit_length,
    'unit_width', v_req.unit_width,
    'pieces_per_unit', v_req.pieces_per_unit,
    'estimated', v_req.estimated,
    'units_needed', v_req.units_needed,
    'reported_pieces', v_proposal.pieces,
    'proposed_consumption', v_proposal.quantity
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- "Treba rezanje": cutting as the first operation of a draft order
-- ---------------------------------------------------------------------------
create function private.apply_order_cutting(p_order_id uuid, p_needs boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_type uuid;
begin
  select * into v_order from public.production_orders o where o.id = p_order_id for update;
  if v_order.id is null or not private.has_permission(v_order.organization_id, 'orders.manage') then
    raise exception 'missing permission orders.manage' using errcode = '42501';
  end if;
  if v_order.status <> 'draft' then
    raise exception 'order_not_draft' using errcode = '55000';
  end if;

  if p_needs and not exists (
    select 1 from public.production_order_operations o
    join public.operation_types t on t.id = o.operation_type_id
    where o.order_id = p_order_id and o.archived_at is null and t.is_cutting
  ) then
    select t.id into v_type from public.operation_types t
    where t.organization_id = v_order.organization_id and t.is_cutting and t.archived_at is null
    order by t.name
    limit 1;
    if v_type is null then
      raise exception 'no_cutting_operation_type' using errcode = '22023';
    end if;
    set constraints public.production_order_operations_sequence_key deferred;
    update public.production_order_operations set sequence = sequence + 1
      where order_id = p_order_id;
    insert into public.production_order_operations (
      organization_id, order_id, sequence, operation_type_id
    ) values (v_order.organization_id, p_order_id, 1, v_type);
    set constraints public.production_order_operations_sequence_key immediate;
  elsif not p_needs then
    update public.production_order_operations o set archived_at = now()
    from public.operation_types t
    where t.id = o.operation_type_id and o.order_id = p_order_id and o.archived_at is null
      and t.is_cutting;
  end if;
end;
$$;

create function public.set_order_cutting(p_order_id uuid, p_needs boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select o.organization_id into v_org_id from public.production_orders o where o.id = p_order_id;
  if v_org_id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(v_org_id);
  perform private.apply_order_cutting(p_order_id, p_needs);
end;
$$;

-- Same as before (D-016), plus stock_item_id, sheet_pieces_per_sheet and
-- needs_cutting (null: keep the routing as it is).
create or replace function public.create_production_order(p_org_id uuid, p_order jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product public.products;
  v_revision public.product_revisions;
  v_id uuid;
begin
  perform private.require_orders_manage(p_org_id);

  select * into v_product from public.products p
  where p.id = (p_order ->> 'product_id')::uuid and p.organization_id = p_org_id
    and p.archived_at is null;
  if v_product.id is null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  select * into v_revision from public.product_revisions r
  where r.product_id = v_product.id
    and (r.id = (p_order ->> 'revision_id')::uuid
      or (p_order ->> 'revision_id' is null and r.is_current));
  if v_revision.id is null then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;

  insert into public.production_orders (
    organization_id, customer_id, product_id, revision_id, unit, quantity, due_date, priority,
    planned_start, planned_end, notes, piece_length_mm, kerf_mm, bar_length_mm, bar_remnant_mm,
    stock_item_id, sheet_pieces_per_sheet,
    -- Overwritten by private.assign_order_number().
    order_number, order_year, order_sequence
  ) values (
    p_org_id, (p_order ->> 'customer_id')::uuid, v_product.id, v_revision.id, v_product.unit,
    (p_order ->> 'quantity')::numeric, (p_order ->> 'due_date')::date,
    (p_order ->> 'priority')::smallint, (p_order ->> 'planned_start')::date,
    (p_order ->> 'planned_end')::date, p_order ->> 'notes',
    coalesce((p_order ->> 'piece_length_mm')::numeric, v_revision.cut_length_mm),
    coalesce((p_order ->> 'kerf_mm')::numeric, v_revision.kerf_mm),
    (p_order ->> 'bar_length_mm')::numeric, (p_order ->> 'bar_remnant_mm')::numeric,
    coalesce((p_order ->> 'stock_item_id')::uuid, v_revision.stock_item_id),
    (p_order ->> 'sheet_pieces_per_sheet')::integer,
    '-', 2000, 1
  )
  returning id into v_id;

  perform private.snapshot_routing(p_org_id, v_id, v_revision.id);
  perform private.snapshot_drawings(p_org_id, v_id, v_revision.id);
  if p_order ? 'needs_cutting' and jsonb_typeof(p_order -> 'needs_cutting') = 'boolean' then
    perform private.apply_order_cutting(v_id, (p_order ->> 'needs_cutting')::boolean);
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Floor: material of the order of an operation the caller sees
-- ---------------------------------------------------------------------------
create function public.floor_order_material(p_operation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_item public.stock_items;
begin
  if not private.can_view_order_operation(p_operation_id) then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  select o.order_id into v_order_id from public.production_order_operations o where o.id = p_operation_id;
  select i.* into v_item
  from public.production_orders r
  join public.stock_items i on i.id = r.stock_item_id
  where r.id = v_order_id;
  if v_item.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'item_code', v_item.code,
    'item_name', v_item.name,
    'base_unit', v_item.base_unit,
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lot_number', l.lot_number,
        'heat_number', l.heat_number,
        'length_mm', g.length_mm,
        'width_mm', g.width_mm,
        'pieces', g.pieces,
        'quantity', g.quantity
      ) order by l.lot_number, g.length_mm desc)
      from (
        select m.lot_id, m.length_mm, m.width_mm,
          -sum(m.pieces) filter (where m.kind = 'issue') as pieces,
          -sum(m.quantity) filter (where m.kind = 'issue') as quantity
        from public.stock_movements m
        where m.production_order_id = v_order_id and m.kind = 'issue'
        group by m.lot_id, m.length_mm, m.width_mm
      ) g
      join public.stock_lots l on l.id = g.lot_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke all on public.stock_reservations, public.stock_order_consumption,
  public.stock_order_issued, public.stock_item_owner_totals, public.stock_order_coverage,
  public.stock_item_reserved
  from anon, authenticated;
grant select on public.stock_reservations, public.stock_order_consumption,
  public.stock_order_issued, public.stock_item_owner_totals, public.stock_order_coverage,
  public.stock_item_reserved
  to authenticated;

alter table public.stock_reservations enable row level security;
alter table public.stock_order_consumption enable row level security;

create policy stock_reservations_select on public.stock_reservations
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read'));
create policy stock_order_consumption_select on public.stock_order_consumption
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read'));

revoke execute on function
  private.default_order_stock_item(),
  private.guard_order_stock_item(),
  private.order_material_requirement(uuid),
  private.sync_order_reservation(),
  private.order_consumption_proposal(uuid),
  private.order_for_material(uuid, uuid, boolean),
  private.apply_order_cutting(uuid, boolean)
  from public;
-- create_production_order / set_order_cutting run as the caller.
grant execute on function private.apply_order_cutting(uuid, boolean) to authenticated;

revoke execute on function
  public.post_stock_issue(uuid, uuid, uuid, jsonb, text),
  public.post_stock_return(uuid, uuid, uuid, jsonb, text),
  public.confirm_order_consumption(uuid, uuid, numeric, text),
  public.order_material_plan(uuid),
  public.set_order_cutting(uuid, boolean),
  public.floor_order_material(uuid)
  from public, anon;
grant execute on function
  public.post_stock_issue(uuid, uuid, uuid, jsonb, text),
  public.post_stock_return(uuid, uuid, uuid, jsonb, text),
  public.confirm_order_consumption(uuid, uuid, numeric, text),
  public.order_material_plan(uuid),
  public.set_order_cutting(uuid, boolean),
  public.floor_order_material(uuid)
  to authenticated;
