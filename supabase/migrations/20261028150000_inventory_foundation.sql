-- Inventory, part A: material warehouse foundation (D-031).
--   * Module 'inventory' (Magacin) with four permissions:
--       inventory.read            stock, movements, lots and certificates
--       inventory.items.manage    stock items and locations
--       inventory.move            receipts, transfers, proposing corrections
--       inventory.adjust.approve  approving corrections (and later stock counts)
--   * stock_locations: warehouse → shelf, or a place next to a machine.
--   * stock_items: one article per grade + shape + dimension ("C45 Ø50").
--     The grade comes from the existing materials catalog (D-015). Base unit
--     follows the shape: bars, tubes and profiles in mm, sheets and plates in
--     m², other items in kg or pieces.
--   * stock_lots: every receipt line is a lot (optional heat number,
--     certificates, owner customer for customer-supplied material).
--   * stock_movements: the ledger and the only way stock changes. Dimensioned
--     items carry signed piece counts per piece size (bar length, sheet
--     length × width); quantity (base unit), theoretical mass and net value
--     are signed and stored. Balances are sums (views), never updated.
--   * stock_documents group the movements of one business action and carry
--     the idempotency key; each movement has its own key as well.
--   * Writes only through SECURITY DEFINER functions that check permissions,
--     lock the items, forbid negative stock and write the audit log.
--   * Value: moving weighted average per item over own lots (customer lots
--     have no value). Outgoing movements are valued at the current average,
--     so the average itself is derived from the ledger.
--   * product_revisions.stock_item_id links products to stock items; the
--     column starts empty and is filled on the pairing screen.

-- ---------------------------------------------------------------------------
-- Module and permissions
-- ---------------------------------------------------------------------------
insert into public.modules (key, name) values ('inventory', 'Magacin');

insert into public.org_modules (organization_id, module_key, enabled, enabled_at)
select m.organization_id, 'inventory', true, now()
from public.org_modules m
where m.module_key = 'production' and m.enabled
on conflict do nothing;

insert into public.permissions (key, module_key, description, default_roles) values
  ('inventory.read', 'inventory', 'View stock, movements, lots and certificates',
    '{admin,director,head_of_production,warehouse}'),
  ('inventory.items.manage', 'inventory', 'Manage stock items and storage locations',
    '{admin,head_of_production,warehouse}'),
  ('inventory.move', 'inventory', 'Post receipts and transfers, propose stock corrections',
    '{admin,head_of_production,warehouse}'),
  ('inventory.adjust.approve', 'inventory', 'Approve stock corrections and stock counts',
    '{admin,director,head_of_production}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.module_key = 'inventory'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------
create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind text not null check (kind in ('warehouse', 'shelf', 'machine')),
  -- Shelves belong to a warehouse; warehouses and machine places are top level.
  parent_id uuid,
  machine_id uuid,
  code text not null check (code ~ '^[A-Za-z0-9._/-]{1,20}$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, parent_id)
    references public.stock_locations (organization_id, id) on delete restrict,
  foreign key (organization_id, machine_id)
    references public.machines (organization_id, id) on delete restrict,
  check ((kind = 'shelf') = (parent_id is not null)),
  check ((kind = 'machine') = (machine_id is not null))
);

create unique index stock_locations_code_key
  on public.stock_locations (organization_id, lower(code))
  where archived_at is null;
create index stock_locations_parent_idx on public.stock_locations (organization_id, parent_id);

create function private.guard_stock_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.stock_locations p
    where p.id = new.parent_id and p.organization_id = new.organization_id
      and p.kind = 'warehouse'
  ) then
    raise exception 'shelf_needs_warehouse' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'location kind cannot change' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger stock_locations_guard before insert or update on public.stock_locations
  for each row execute function private.guard_stock_location();
create trigger stock_locations_set_updated_at before update on public.stock_locations
  for each row execute function private.set_updated_at();
create trigger stock_locations_audit after insert or update on public.stock_locations
  for each row execute function private.audit_row_change();

-- One warehouse to start with, for every organization (and new ones).
create function private.seed_default_stock_location(p_org_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.stock_locations (organization_id, kind, code, name)
  select p_org_id, 'warehouse', 'M1', 'Magacin'
  where not exists (select 1 from public.stock_locations l where l.organization_id = p_org_id)
$$;

revoke execute on function private.seed_default_stock_location(uuid) from public;

create function private.seed_organization_stock_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_default_stock_location(new.id);
  return null;
end;
$$;

create trigger organizations_seed_stock_location after insert on public.organizations
  for each row execute function private.seed_organization_stock_location();

select private.seed_default_stock_location(o.id) from public.organizations o;

-- ---------------------------------------------------------------------------
-- Stock items
-- ---------------------------------------------------------------------------
create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  code text not null check (length(btrim(code)) between 1 and 40),
  name text not null check (length(btrim(name)) between 1 and 200),
  -- Grade (C45, S235, AlMg3 …) from the materials catalog; density comes from it.
  material_id uuid,
  shape text not null check (shape in (
    'round_bar', 'hex_bar', 'square_bar', 'flat_bar', 'tube', 'profile', 'sheet', 'plate', 'other'
  )),
  -- Round bar Ø, hexagon across flats, tube outer Ø.
  diameter_mm numeric(10, 3) check (diameter_mm > 0),
  -- Square bar side, flat bar width.
  width_mm numeric(10, 3) check (width_mm > 0),
  -- Flat bar thickness, tube wall, sheet / plate thickness.
  thickness_mm numeric(10, 3) check (thickness_mm > 0),
  -- Profiles: designation such as "HEA 100" or "L 50x50x5".
  profile_label text check (length(btrim(profile_label)) between 1 and 60),
  base_unit text not null check (base_unit in ('mm', 'm2', 'kg', 'pcs')),
  -- Proposed length of a new bar (mm); every received piece states its own.
  standard_length_mm numeric(10, 1) check (standard_length_mm > 0),
  -- Proposed sheet / plate size (mm).
  standard_width_mm numeric(10, 1) check (standard_width_mm > 0),
  -- kg per metre from the supplier's table; overrides the calculated mass
  -- (required for profiles).
  mass_per_m_kg numeric(12, 4) check (mass_per_m_kg > 0),
  supplier text check (length(btrim(supplier)) between 1 and 200),
  -- In the base unit.
  min_stock numeric(18, 6) check (min_stock >= 0),
  default_location_id uuid,
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, material_id)
    references public.materials (organization_id, id) on delete restrict,
  foreign key (organization_id, default_location_id)
    references public.stock_locations (organization_id, id) on delete restrict,
  constraint stock_items_dimensions_check check (case shape
    when 'round_bar' then diameter_mm is not null and width_mm is null and thickness_mm is null
    when 'hex_bar' then diameter_mm is not null and width_mm is null and thickness_mm is null
    when 'square_bar' then width_mm is not null and diameter_mm is null and thickness_mm is null
    when 'flat_bar' then width_mm is not null and thickness_mm is not null and diameter_mm is null
    when 'tube' then diameter_mm is not null and thickness_mm is not null and width_mm is null
      and thickness_mm * 2 < diameter_mm
    when 'sheet' then thickness_mm is not null and diameter_mm is null and width_mm is null
    when 'plate' then thickness_mm is not null and diameter_mm is null and width_mm is null
    else diameter_mm is null and width_mm is null and thickness_mm is null
  end),
  constraint stock_items_unit_check check (case
    when shape in ('round_bar', 'hex_bar', 'square_bar', 'flat_bar', 'tube', 'profile')
      then base_unit = 'mm'
    when shape in ('sheet', 'plate') then base_unit = 'm2'
    else base_unit in ('kg', 'pcs')
  end),
  check (shape = 'profile' or profile_label is null),
  check (shape <> 'profile' or (profile_label is not null and mass_per_m_kg is not null)),
  check (base_unit = 'mm' or mass_per_m_kg is null),
  check (base_unit = 'mm' or standard_length_mm is null or shape in ('sheet', 'plate')),
  check (shape in ('sheet', 'plate') or standard_width_mm is null)
);

create unique index stock_items_code_key
  on public.stock_items (organization_id, lower(btrim(code)))
  where archived_at is null;
create index stock_items_material_idx on public.stock_items (organization_id, material_id);

create trigger stock_items_set_updated_at before update on public.stock_items
  for each row execute function private.set_updated_at();
create trigger stock_items_audit after insert or update on public.stock_items
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Lots and certificates
-- ---------------------------------------------------------------------------
create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  item_id uuid not null,
  -- Internal number printed on labels (L26-00001).
  lot_number text not null,
  heat_number text check (length(btrim(heat_number)) between 1 and 60),
  supplier text check (length(btrim(supplier)) between 1 and 200),
  delivery_note text check (length(btrim(delivery_note)) between 1 and 60),
  -- Customer-supplied material: no value, belongs to this customer.
  owner_customer_id uuid,
  received_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, item_id, id),
  unique (organization_id, lot_number),
  foreign key (organization_id, item_id)
    references public.stock_items (organization_id, id) on delete restrict,
  foreign key (organization_id, owner_customer_id)
    references public.customers (organization_id, id) on delete restrict
);

create index stock_lots_item_idx on public.stock_lots (organization_id, item_id);
create index stock_lots_heat_idx on public.stock_lots (organization_id, lower(heat_number));

create table public.stock_lot_certificates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  lot_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  mime_type text not null check (mime_type in (
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp'
  )),
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (organization_id, lot_id)
    references public.stock_lots (organization_id, id) on delete restrict,
  check (storage_path like organization_id::text || '/' || lot_id::text || '/%')
);

create index stock_lot_certificates_lot_idx
  on public.stock_lot_certificates (organization_id, lot_id);

create trigger stock_lot_certificates_audit after insert or update on public.stock_lot_certificates
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Documents, correction lines and the movement ledger
-- ---------------------------------------------------------------------------
create table public.stock_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind text not null check (kind in ('receipt', 'transfer', 'adjustment')),
  number text not null,
  -- Only corrections wait for approval.
  status text not null check (status in ('posted', 'pending', 'rejected')),
  document_date date not null,
  supplier text check (length(btrim(supplier)) between 1 and 200),
  delivery_note text check (length(btrim(delivery_note)) between 1 and 60),
  reason text check (length(btrim(reason)) between 1 and 500),
  notes text check (length(notes) <= 2000),
  idempotency_key uuid not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (length(btrim(decision_note)) between 1 and 500),
  unique (organization_id, id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  check (kind = 'adjustment' or status = 'posted'),
  check (kind <> 'adjustment' or reason is not null),
  check (status <> 'rejected' or decision_note is not null)
);

create index stock_documents_kind_idx
  on public.stock_documents (organization_id, kind, status, created_at desc);

-- Proposed correction lines; posted as movements on approval.
create table public.stock_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  line_no integer not null check (line_no between 1 and 200),
  item_id uuid not null,
  -- Null: a found piece without a lot; approval creates one.
  lot_id uuid,
  location_id uuid not null,
  length_mm numeric(10, 1) check (length_mm > 0),
  width_mm numeric(10, 1) check (width_mm > 0),
  pieces integer check (pieces <> 0),
  quantity numeric(18, 6) check (quantity <> 0),
  unique (document_id, line_no),
  foreign key (organization_id, document_id)
    references public.stock_documents (organization_id, id) on delete restrict,
  foreign key (organization_id, item_id)
    references public.stock_items (organization_id, id) on delete restrict,
  foreign key (organization_id, item_id, lot_id)
    references public.stock_lots (organization_id, item_id, id) on delete restrict,
  foreign key (organization_id, location_id)
    references public.stock_locations (organization_id, id) on delete restrict,
  check ((pieces is null) = (length_mm is null)),
  check ((pieces is null) <> (quantity is null)),
  check (width_mm is null or length_mm is not null)
);

create index stock_adjustment_lines_doc_idx
  on public.stock_adjustment_lines (organization_id, document_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  document_id uuid not null,
  line_no integer not null check (line_no between 1 and 400),
  kind text not null check (kind in ('receipt', 'transfer_out', 'transfer_in', 'adjustment')),
  item_id uuid not null,
  lot_id uuid not null,
  location_id uuid not null,
  -- Piece size of dimensioned items (bar length; sheet length × width).
  length_mm numeric(10, 1) check (length_mm > 0),
  width_mm numeric(10, 1) check (width_mm > 0),
  -- Signed number of pieces of that size.
  pieces integer check (pieces <> 0),
  -- Signed, in the item's base unit (mm, m², kg, pcs).
  quantity numeric(18, 6) not null check (quantity <> 0),
  -- Signed theoretical mass; null when it cannot be derived (pieces without mass).
  mass_kg numeric(16, 4),
  -- Signed net value in the organization's currency (KM).
  value numeric(16, 4) not null default 0,
  -- Receipts: what the invoice says, for the record.
  invoice_kg numeric(14, 3) check (invoice_kg > 0),
  unit_price numeric(14, 4) check (unit_price >= 0),
  price_unit text check (price_unit in ('kg', 'm', 'm2', 'piece')),
  price_includes_vat boolean,
  idempotency_key text not null check (length(idempotency_key) between 1 and 100),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (document_id, line_no),
  foreign key (organization_id, document_id)
    references public.stock_documents (organization_id, id) on delete restrict,
  foreign key (organization_id, item_id, lot_id)
    references public.stock_lots (organization_id, item_id, id) on delete restrict,
  foreign key (organization_id, location_id)
    references public.stock_locations (organization_id, id) on delete restrict,
  check ((pieces is null) = (length_mm is null)),
  check (width_mm is null or length_mm is not null),
  check (sign(quantity) = sign(coalesce(pieces, quantity)::numeric)),
  check (kind = 'receipt' or (unit_price is null and price_unit is null and invoice_kg is null))
);

create index stock_movements_item_idx
  on public.stock_movements (organization_id, item_id, created_at desc);
create index stock_movements_bucket_idx
  on public.stock_movements (organization_id, item_id, lot_id, location_id);
create index stock_movements_location_idx on public.stock_movements (organization_id, location_id);

-- The ledger is append-only.
create function private.prevent_stock_movement_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'stock movements are append-only' using errcode = '55000';
end;
$$;

create trigger stock_movements_append_only before update on public.stock_movements
  for each row execute function private.prevent_stock_movement_update();

-- Shape, unit, dimensions and grade of an item with movements cannot change:
-- stored quantities and masses depend on them.
create function private.guard_stock_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.shape, new.base_unit, new.diameter_mm, new.width_mm, new.thickness_mm,
      new.mass_per_m_kg, new.material_id)
    is distinct from
     (old.shape, old.base_unit, old.diameter_mm, old.width_mm, old.thickness_mm,
      old.mass_per_m_kg, old.material_id)
    and exists (select 1 from public.stock_movements m where m.item_id = old.id) then
    raise exception 'item_has_movements' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger stock_items_guard before update on public.stock_items
  for each row execute function private.guard_stock_item();

-- ---------------------------------------------------------------------------
-- Balances (derived; RLS of the movements applies)
-- ---------------------------------------------------------------------------
create view public.stock_balances with (security_invoker = true) as
select
  m.organization_id,
  m.item_id,
  m.lot_id,
  m.location_id,
  m.length_mm,
  m.width_mm,
  sum(m.pieces)::integer as pieces,
  sum(m.quantity) as quantity,
  sum(m.mass_kg) as mass_kg,
  sum(m.value) as value
from public.stock_movements m
group by m.organization_id, m.item_id, m.lot_id, m.location_id, m.length_mm, m.width_mm
having sum(m.quantity) <> 0;

-- Per item: total stock and own stock (without customer-supplied lots) with
-- its value; average unit cost = own_value / own_quantity.
create view public.stock_item_totals with (security_invoker = true) as
select
  m.organization_id,
  m.item_id,
  sum(m.quantity) as quantity,
  sum(m.mass_kg) as mass_kg,
  coalesce(sum(m.quantity) filter (where l.owner_customer_id is null), 0) as own_quantity,
  coalesce(sum(m.mass_kg) filter (where l.owner_customer_id is null), 0) as own_mass_kg,
  coalesce(sum(m.value) filter (where l.owner_customer_id is null), 0) as own_value
from public.stock_movements m
join public.stock_lots l on l.id = m.lot_id
group by m.organization_id, m.item_id;

-- ---------------------------------------------------------------------------
-- Calculation helpers (mirrored in src/modules/inventory/rules.ts)
-- ---------------------------------------------------------------------------

-- kg per base unit: per mm for bars / tubes / profiles, per m² for sheets and
-- plates, 1 for kg, null for pieces or when the density is unknown.
-- Cross-sections use the same constants as the product blank weight (D-015).
create function private.stock_item_kg_per_unit(p_item_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item public.stock_items;
  v_density numeric;
  v_area numeric;
begin
  select * into v_item from public.stock_items i where i.id = p_item_id;
  if v_item.base_unit = 'kg' then return 1; end if;
  if v_item.base_unit = 'pcs' then return null; end if;
  if v_item.base_unit = 'mm' and v_item.mass_per_m_kg is not null then
    return v_item.mass_per_m_kg / 1000;
  end if;

  select coalesce(m.density_kg_dm3, g.density_kg_dm3) into v_density
  from public.materials m
  join public.material_groups g on g.id = m.group_id
  where m.id = v_item.material_id;
  if v_density is null then return null; end if;

  -- kg/m² = thickness (mm) × density (kg/dm³)
  if v_item.base_unit = 'm2' then return v_item.thickness_mm * v_density; end if;

  v_area := case v_item.shape
    when 'round_bar' then 3.14159265358979 / 4 * v_item.diameter_mm * v_item.diameter_mm
    when 'hex_bar' then 0.866025403784439 * v_item.diameter_mm * v_item.diameter_mm
    when 'square_bar' then v_item.width_mm * v_item.width_mm
    when 'flat_bar' then v_item.width_mm * v_item.thickness_mm
    when 'tube' then 3.14159265358979 * v_item.thickness_mm
      * (v_item.diameter_mm - v_item.thickness_mm)
  end;
  -- mm² × 1 mm = mm³; 10⁶ mm³ = 1 dm³
  return v_area * v_density / 1000000;
end;
$$;

-- Quantity in the base unit of one line: pieces × length (mm), pieces ×
-- length × width / 10⁶ (m²), or the quantity itself (kg, pcs).
create function private.stock_line_quantity(
  p_base_unit text,
  p_pieces integer,
  p_length_mm numeric,
  p_width_mm numeric,
  p_quantity numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_base_unit
    when 'mm' then p_pieces * p_length_mm
    when 'm2' then round(p_pieces * p_length_mm * p_width_mm / 1000000, 6)
    else p_quantity
  end
$$;

-- Average net cost per base unit of own stock; with no own stock the cost of
-- the latest own receipt, else 0.
create function private.stock_unit_cost(p_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select t.own_value / nullif(t.own_quantity, 0)
     from public.stock_item_totals t
     where t.item_id = p_item_id and t.own_quantity > 0),
    (select m.value / m.quantity
     from public.stock_movements m
     join public.stock_lots l on l.id = m.lot_id
     where m.item_id = p_item_id and m.kind = 'receipt' and l.owner_customer_id is null
     order by m.created_at desc, m.line_no desc
     limit 1),
    0
  )
$$;

create function private.inventory_vat_rate(p_org_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case when o.settings -> 'inventory' ->> 'vat_rate' ~ '^\d+(\.\d+)?$'
      then (o.settings -> 'inventory' ->> 'vat_rate')::numeric end,
    17)
  from public.organizations o
  where o.id = p_org_id
$$;

-- Serializes writes per item so the negative-stock check sees every
-- concurrent movement.
create function private.lock_stock_items(p_org_id uuid, p_item_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in select distinct unnest(p_item_ids) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('stock:' || p_org_id::text || ':' || v_id::text, 0));
  end loop;
end;
$$;

-- Raises negative_stock when a bucket touched by the document is below zero.
create function private.assert_document_not_negative(p_document_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (
    select 1
    from (select distinct d.item_id, d.lot_id, d.location_id, d.length_mm, d.width_mm
          from public.stock_movements d where d.document_id = p_document_id) touched
    join public.stock_movements m
      on m.item_id = touched.item_id and m.lot_id = touched.lot_id
     and m.location_id = touched.location_id
     and m.length_mm is not distinct from touched.length_mm
     and m.width_mm is not distinct from touched.width_mm
    group by touched.item_id, touched.lot_id, touched.location_id, touched.length_mm, touched.width_mm
    having sum(m.quantity) < 0 or coalesce(sum(m.pieces), 0) < 0
  ) then
    raise exception 'negative_stock' using errcode = '23514';
  end if;
end;
$$;

create function private.assert_inventory_access(p_org_id uuid, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission(p_org_id, p_permission) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not private.module_enabled(p_org_id, 'inventory') then
    raise exception 'module_disabled' using errcode = '42501';
  end if;
end;
$$;

create function private.next_stock_number(p_org_id uuid, p_prefix text, p_scope text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select p_prefix || to_char(now(), 'YY') || '-'
    || lpad(private.next_counter(p_org_id, p_scope || ':' || to_char(now(), 'YYYY'))::text, 5, '0')
$$;

-- Item of the organization for a movement line; validates the piece size
-- against the base unit and returns the line quantity.
create function private.stock_line_for_item(
  p_org_id uuid,
  p_item_id uuid,
  p_pieces integer,
  p_length_mm numeric,
  p_width_mm numeric,
  p_quantity numeric,
  p_allow_archived boolean default false
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item public.stock_items;
begin
  select * into v_item from public.stock_items i
  where i.id = p_item_id and i.organization_id = p_org_id
    and (p_allow_archived or i.archived_at is null);
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  if v_item.base_unit = 'mm' then
    if p_pieces is null or p_pieces = 0 or p_length_mm is null or p_length_mm <= 0
      or p_width_mm is not null then
      raise exception 'invalid_line' using errcode = '22023';
    end if;
  elsif v_item.base_unit = 'm2' then
    if p_pieces is null or p_pieces = 0 or p_length_mm is null or p_length_mm <= 0
      or p_width_mm is null or p_width_mm <= 0 then
      raise exception 'invalid_line' using errcode = '22023';
    end if;
  elsif p_pieces is not null or p_length_mm is not null or p_width_mm is not null
    or p_quantity is null or p_quantity = 0
    or (v_item.base_unit = 'pcs' and p_quantity <> trunc(p_quantity)) then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  return private.stock_line_quantity(v_item.base_unit, p_pieces, p_length_mm, p_width_mm, p_quantity);
end;
$$;

create function private.assert_stock_location(p_org_id uuid, p_location_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.stock_locations l
    where l.id = p_location_id and l.organization_id = p_org_id and l.archived_at is null
  ) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Receipt
-- ---------------------------------------------------------------------------
-- p_header: {document_date, supplier, delivery_note, notes, price_includes_vat}
-- p_lines:  [{item_id, location_id, pieces, length_mm, width_mm, quantity,
--             heat_number, owner_customer_id, unit_price, price_unit, invoice_kg}]
-- Value: unit_price × basis (kg: invoice kg or theoretical mass; m; m²;
-- piece), net of VAT when prices include it; customer material has no value.
create function public.post_stock_receipt(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_header jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_id uuid;
  v_line jsonb;
  v_no integer;
  v_item public.stock_items;
  v_quantity numeric;
  v_kg_per_unit numeric;
  v_mass numeric;
  v_pieces integer;
  v_length numeric;
  v_width numeric;
  v_owner uuid;
  v_price numeric;
  v_price_unit text;
  v_invoice_kg numeric;
  v_basis numeric;
  v_value numeric;
  v_vat boolean := coalesce((p_header ->> 'price_includes_vat')::boolean, false);
  v_vat_rate numeric := private.inventory_vat_rate(p_org_id);
  v_lot_id uuid;
  v_supplier text := nullif(btrim(p_header ->> 'supplier'), '');
  v_delivery_note text := nullif(btrim(p_header ->> 'delivery_note'), '');
  v_total_value numeric := 0;
begin
  perform private.assert_inventory_access(p_org_id, 'inventory.move');
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;

  select d.id into v_doc_id from public.stock_documents d
  where d.organization_id = p_org_id and d.idempotency_key = p_idempotency_key;
  if found then return v_doc_id; end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  perform private.lock_stock_items(p_org_id,
    array(select (l ->> 'item_id')::uuid from jsonb_array_elements(p_lines) l));

  insert into public.stock_documents (
    organization_id, kind, number, status, document_date, supplier, delivery_note, notes,
    idempotency_key
  ) values (
    p_org_id, 'receipt', private.next_stock_number(p_org_id, 'PR', 'stock_receipt'), 'posted',
    coalesce((p_header ->> 'document_date')::date, current_date), v_supplier, v_delivery_note,
    nullif(btrim(p_header ->> 'notes'), ''), p_idempotency_key
  )
  returning id into v_doc_id;

  for v_line, v_no in select e.value, e.ordinality from jsonb_array_elements(p_lines) with ordinality e loop
    v_pieces := (v_line ->> 'pieces')::integer;
    v_length := (v_line ->> 'length_mm')::numeric;
    v_width := (v_line ->> 'width_mm')::numeric;
    if coalesce(v_pieces, 1) <= 0 or coalesce((v_line ->> 'quantity')::numeric, 1) <= 0 then
      raise exception 'invalid_line' using errcode = '22023';
    end if;
    v_quantity := private.stock_line_for_item(p_org_id, (v_line ->> 'item_id')::uuid,
      v_pieces, v_length, v_width, (v_line ->> 'quantity')::numeric);
    select * into v_item from public.stock_items i where i.id = (v_line ->> 'item_id')::uuid;
    perform private.assert_stock_location(p_org_id, (v_line ->> 'location_id')::uuid);

    v_owner := (v_line ->> 'owner_customer_id')::uuid;
    if v_owner is not null and not exists (
      select 1 from public.customers c where c.id = v_owner and c.organization_id = p_org_id
    ) then
      raise exception 'customer_not_found' using errcode = 'P0002';
    end if;

    v_kg_per_unit := private.stock_item_kg_per_unit(v_item.id);
    v_mass := round(v_quantity * v_kg_per_unit, 4);
    v_price := (v_line ->> 'unit_price')::numeric;
    v_price_unit := v_line ->> 'price_unit';
    v_invoice_kg := (v_line ->> 'invoice_kg')::numeric;

    if v_owner is not null then
      v_price := null; v_price_unit := null; v_invoice_kg := null; v_value := 0;
    else
      if v_price is null or v_price < 0 or v_price_unit is null then
        raise exception 'price_required' using errcode = '22023';
      end if;
      v_basis := case v_price_unit
        when 'kg' then coalesce(v_invoice_kg, v_mass)
        when 'm' then case when v_item.base_unit = 'mm' then v_quantity / 1000 end
        when 'm2' then case when v_item.base_unit = 'm2' then v_quantity end
        when 'piece' then case
          when v_item.base_unit in ('mm', 'm2') then v_pieces
          when v_item.base_unit = 'pcs' then v_quantity end
      end;
      if v_basis is null then
        raise exception 'price_unit_invalid' using errcode = '22023';
      end if;
      v_value := round(v_price * v_basis, 4);
      if v_vat then v_value := round(v_value * 100 / (100 + v_vat_rate), 4); end if;
    end if;

    insert into public.stock_lots (
      organization_id, item_id, lot_number, heat_number, supplier, delivery_note, owner_customer_id
    ) values (
      p_org_id, v_item.id, private.next_stock_number(p_org_id, 'L', 'stock_lot'),
      nullif(btrim(v_line ->> 'heat_number'), ''), v_supplier, v_delivery_note, v_owner
    )
    returning id into v_lot_id;

    insert into public.stock_movements (
      organization_id, document_id, line_no, kind, item_id, lot_id, location_id,
      length_mm, width_mm, pieces, quantity, mass_kg, value,
      invoice_kg, unit_price, price_unit, price_includes_vat, idempotency_key
    ) values (
      p_org_id, v_doc_id, v_no, 'receipt', v_item.id, v_lot_id, (v_line ->> 'location_id')::uuid,
      v_length, v_width, v_pieces, v_quantity, v_mass, v_value,
      v_invoice_kg, v_price, v_price_unit, case when v_owner is null then v_vat end,
      p_idempotency_key::text || ':' || v_no
    );
    v_total_value := v_total_value + v_value;
  end loop;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'stock.receipt', 'stock_documents', v_doc_id::text,
    jsonb_build_object('lines', jsonb_array_length(p_lines), 'value', v_total_value,
      'supplier', v_supplier, 'delivery_note', v_delivery_note));

  return v_doc_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transfer between locations
-- ---------------------------------------------------------------------------
-- p_lines: [{item_id, lot_id, from_location_id, to_location_id, pieces,
--            length_mm, width_mm, quantity}] (positive amounts)
create function public.post_stock_transfer(
  p_org_id uuid,
  p_idempotency_key uuid,
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
  v_quantity numeric;
  v_item_id uuid;
  v_lot public.stock_lots;
  v_unit_cost numeric;
  v_value numeric;
  v_mass numeric;
  v_pieces integer;
  v_from uuid;
  v_to uuid;
begin
  perform private.assert_inventory_access(p_org_id, 'inventory.move');
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;

  select d.id into v_doc_id from public.stock_documents d
  where d.organization_id = p_org_id and d.idempotency_key = p_idempotency_key;
  if found then return v_doc_id; end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  perform private.lock_stock_items(p_org_id,
    array(select (l ->> 'item_id')::uuid from jsonb_array_elements(p_lines) l));

  insert into public.stock_documents (
    organization_id, kind, number, status, document_date, notes, idempotency_key
  ) values (
    p_org_id, 'transfer', private.next_stock_number(p_org_id, 'PN', 'stock_transfer'), 'posted',
    current_date, nullif(btrim(p_notes), ''), p_idempotency_key
  )
  returning id into v_doc_id;

  for v_line in select e.value from jsonb_array_elements(p_lines) e loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_pieces := (v_line ->> 'pieces')::integer;
    v_from := (v_line ->> 'from_location_id')::uuid;
    v_to := (v_line ->> 'to_location_id')::uuid;
    if coalesce(v_pieces, 1) <= 0 or coalesce((v_line ->> 'quantity')::numeric, 1) <= 0
      or v_from = v_to then
      raise exception 'invalid_line' using errcode = '22023';
    end if;
    v_quantity := private.stock_line_for_item(p_org_id, v_item_id, v_pieces,
      (v_line ->> 'length_mm')::numeric, (v_line ->> 'width_mm')::numeric,
      (v_line ->> 'quantity')::numeric, true);
    perform private.assert_stock_location(p_org_id, v_to);

    select * into v_lot from public.stock_lots l
    where l.id = (v_line ->> 'lot_id')::uuid and l.organization_id = p_org_id
      and l.item_id = v_item_id;
    if not found then
      raise exception 'lot_not_found' using errcode = 'P0002';
    end if;

    v_unit_cost := case when v_lot.owner_customer_id is null
      then private.stock_unit_cost(v_item_id) else 0 end;
    v_value := round(v_quantity * v_unit_cost, 4);
    v_mass := round(v_quantity * private.stock_item_kg_per_unit(v_item_id), 4);

    v_no := v_no + 1;
    insert into public.stock_movements (
      organization_id, document_id, line_no, kind, item_id, lot_id, location_id,
      length_mm, width_mm, pieces, quantity, mass_kg, value, idempotency_key
    ) values (
      p_org_id, v_doc_id, v_no, 'transfer_out', v_item_id, v_lot.id, v_from,
      (v_line ->> 'length_mm')::numeric, (v_line ->> 'width_mm')::numeric, -v_pieces,
      -v_quantity, -v_mass, -v_value, p_idempotency_key::text || ':' || v_no
    );
    v_no := v_no + 1;
    insert into public.stock_movements (
      organization_id, document_id, line_no, kind, item_id, lot_id, location_id,
      length_mm, width_mm, pieces, quantity, mass_kg, value, idempotency_key
    ) values (
      p_org_id, v_doc_id, v_no, 'transfer_in', v_item_id, v_lot.id, v_to,
      (v_line ->> 'length_mm')::numeric, (v_line ->> 'width_mm')::numeric, v_pieces,
      v_quantity, v_mass, v_value, p_idempotency_key::text || ':' || v_no
    );
  end loop;

  perform private.assert_document_not_negative(v_doc_id);

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'stock.transfer', 'stock_documents', v_doc_id::text,
    jsonb_build_object('lines', jsonb_array_length(p_lines)));

  return v_doc_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Corrections: proposed by inventory.move, posted by inventory.adjust.approve
-- ---------------------------------------------------------------------------
create function private.post_stock_adjustment(p_document_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_doc public.stock_documents;
  v_line public.stock_adjustment_lines;
  v_quantity numeric;
  v_lot_id uuid;
  v_owner uuid;
  v_unit_cost numeric;
begin
  select * into v_doc from public.stock_documents d where d.id = p_document_id;

  perform private.lock_stock_items(v_doc.organization_id,
    array(select l.item_id from public.stock_adjustment_lines l where l.document_id = p_document_id));

  for v_line in
    select * from public.stock_adjustment_lines l where l.document_id = p_document_id
    order by l.line_no
  loop
    perform private.assert_stock_location(v_doc.organization_id, v_line.location_id);
    v_quantity := private.stock_line_for_item(v_doc.organization_id, v_line.item_id,
      v_line.pieces, v_line.length_mm, v_line.width_mm, v_line.quantity, true);

    v_lot_id := v_line.lot_id;
    if v_lot_id is null then
      if v_quantity < 0 then
        raise exception 'lot_not_found' using errcode = 'P0002';
      end if;
      insert into public.stock_lots (organization_id, item_id, lot_number)
      values (v_doc.organization_id, v_line.item_id,
        private.next_stock_number(v_doc.organization_id, 'L', 'stock_lot'))
      returning id into v_lot_id;
    end if;
    select l.owner_customer_id into v_owner from public.stock_lots l where l.id = v_lot_id;

    v_unit_cost := case when v_owner is null
      then private.stock_unit_cost(v_line.item_id) else 0 end;

    insert into public.stock_movements (
      organization_id, document_id, line_no, kind, item_id, lot_id, location_id,
      length_mm, width_mm, pieces, quantity, mass_kg, value, idempotency_key
    ) values (
      v_doc.organization_id, p_document_id, v_line.line_no, 'adjustment', v_line.item_id,
      v_lot_id, v_line.location_id, v_line.length_mm, v_line.width_mm, v_line.pieces,
      v_quantity, round(v_quantity * private.stock_item_kg_per_unit(v_line.item_id), 4),
      round(v_quantity * v_unit_cost, 4), v_doc.idempotency_key::text || ':' || v_line.line_no
    );
  end loop;

  perform private.assert_document_not_negative(p_document_id);
end;
$$;

-- p_lines: [{item_id, lot_id, location_id, pieces, length_mm, width_mm,
--            quantity}] with signed amounts (+ found, − missing).
-- p_post: post at once (requires inventory.adjust.approve).
create function public.request_stock_adjustment(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_reason text,
  p_lines jsonb,
  p_post boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_id uuid;
  v_line jsonb;
  v_no integer;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_post then
    perform private.assert_inventory_access(p_org_id, 'inventory.adjust.approve');
  elsif private.has_permission(p_org_id, 'inventory.adjust.approve') then
    perform private.assert_inventory_access(p_org_id, 'inventory.adjust.approve');
  else
    perform private.assert_inventory_access(p_org_id, 'inventory.move');
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;

  select d.id into v_doc_id from public.stock_documents d
  where d.organization_id = p_org_id and d.idempotency_key = p_idempotency_key;
  if found then return v_doc_id; end if;

  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  insert into public.stock_documents (
    organization_id, kind, number, status, document_date, reason, idempotency_key
  ) values (
    p_org_id, 'adjustment', private.next_stock_number(p_org_id, 'KO', 'stock_adjustment'),
    'pending', current_date, v_reason, p_idempotency_key
  )
  returning id into v_doc_id;

  for v_line, v_no in select e.value, e.ordinality from jsonb_array_elements(p_lines) with ordinality e loop
    -- Validates item, unit and piece size now; posting validates again.
    perform private.stock_line_for_item(p_org_id, (v_line ->> 'item_id')::uuid,
      (v_line ->> 'pieces')::integer, (v_line ->> 'length_mm')::numeric,
      (v_line ->> 'width_mm')::numeric, (v_line ->> 'quantity')::numeric, true);
    perform private.assert_stock_location(p_org_id, (v_line ->> 'location_id')::uuid);
    if (v_line ->> 'lot_id') is not null and not exists (
      select 1 from public.stock_lots l
      where l.id = (v_line ->> 'lot_id')::uuid and l.organization_id = p_org_id
        and l.item_id = (v_line ->> 'item_id')::uuid
    ) then
      raise exception 'lot_not_found' using errcode = 'P0002';
    end if;

    insert into public.stock_adjustment_lines (
      organization_id, document_id, line_no, item_id, lot_id, location_id,
      length_mm, width_mm, pieces, quantity
    ) values (
      p_org_id, v_doc_id, v_no, (v_line ->> 'item_id')::uuid, (v_line ->> 'lot_id')::uuid,
      (v_line ->> 'location_id')::uuid, (v_line ->> 'length_mm')::numeric,
      (v_line ->> 'width_mm')::numeric, (v_line ->> 'pieces')::integer,
      case when (v_line ->> 'pieces') is null then (v_line ->> 'quantity')::numeric end
    );
  end loop;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'stock.adjustment_requested', 'stock_documents', v_doc_id::text,
    jsonb_build_object('reason', v_reason, 'lines', jsonb_array_length(p_lines)));

  if p_post then
    perform private.post_stock_adjustment(v_doc_id);
    update public.stock_documents
      set status = 'posted', decided_by = auth.uid(), decided_at = now()
      where id = v_doc_id;
    insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
    values (p_org_id, auth.uid(), 'stock.adjustment_posted', 'stock_documents', v_doc_id::text,
      jsonb_build_object('direct', true));
  end if;

  return v_doc_id;
end;
$$;

create function public.decide_stock_adjustment(
  p_document_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.stock_documents;
  v_note text := nullif(btrim(p_note), '');
begin
  select * into v_doc from public.stock_documents d
  where d.id = p_document_id and d.kind = 'adjustment'
  for update;
  if not found or not private.has_permission(v_doc.organization_id, 'inventory.read') then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_inventory_access(v_doc.organization_id, 'inventory.adjust.approve');
  if v_doc.status <> 'pending' then
    raise exception 'already_decided' using errcode = '55000';
  end if;
  if not p_approve and v_note is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  if p_approve then
    perform private.post_stock_adjustment(p_document_id);
  end if;

  update public.stock_documents
    set status = case when p_approve then 'posted' else 'rejected' end,
        decided_by = auth.uid(), decided_at = now(), decision_note = v_note
    where id = p_document_id;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (v_doc.organization_id, auth.uid(),
    case when p_approve then 'stock.adjustment_posted' else 'stock.adjustment_rejected' end,
    'stock_documents', p_document_id::text, jsonb_build_object('note', v_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- Product revisions → stock items
-- ---------------------------------------------------------------------------
alter table public.product_revisions
  add column stock_item_id uuid,
  add constraint product_revisions_stock_item_fkey foreign key (organization_id, stock_item_id)
    references public.stock_items (organization_id, id) on delete restrict;
create index product_revisions_stock_item_idx
  on public.product_revisions (organization_id, stock_item_id);

-- ---------------------------------------------------------------------------
-- Storage: private bucket for material certificates (3.1)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stock-certificates', 'stock-certificates', false, 20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy stock_certificates_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'stock-certificates'
    and private.has_permission(private.storage_org_id(name), 'inventory.read')
  );

create policy stock_certificates_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'stock-certificates'
    and private.has_permission(private.storage_org_id(name), 'inventory.move')
  );

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke all on public.stock_locations, public.stock_items, public.stock_lots,
  public.stock_lot_certificates, public.stock_documents, public.stock_adjustment_lines,
  public.stock_movements, public.stock_balances, public.stock_item_totals
  from anon, authenticated;

grant select on public.stock_locations, public.stock_items, public.stock_lots,
  public.stock_lot_certificates, public.stock_documents, public.stock_adjustment_lines,
  public.stock_movements, public.stock_balances, public.stock_item_totals
  to authenticated;

grant insert (organization_id, kind, parent_id, machine_id, code, name),
  update (parent_id, machine_id, code, name, archived_at)
  on public.stock_locations to authenticated;
grant insert (organization_id, code, name, material_id, shape, diameter_mm, width_mm, thickness_mm,
    profile_label, base_unit, standard_length_mm, standard_width_mm, mass_per_m_kg, supplier,
    min_stock, default_location_id, notes),
  update (code, name, material_id, shape, diameter_mm, width_mm, thickness_mm, profile_label,
    base_unit, standard_length_mm, standard_width_mm, mass_per_m_kg, supplier, min_stock,
    default_location_id, notes, archived_at)
  on public.stock_items to authenticated;
grant insert (organization_id, lot_id, storage_path, file_name, mime_type, size_bytes),
  update (archived_at)
  on public.stock_lot_certificates to authenticated;
grant update (stock_item_id) on public.product_revisions to authenticated;

alter table public.stock_locations enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_lots enable row level security;
alter table public.stock_lot_certificates enable row level security;
alter table public.stock_documents enable row level security;
alter table public.stock_adjustment_lines enable row level security;
alter table public.stock_movements enable row level security;

-- Locations and items are also visible to products.manage (pairing screen).
create policy stock_locations_select on public.stock_locations
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read')
    or private.has_permission(organization_id, 'products.manage'));
create policy stock_locations_insert on public.stock_locations
  for insert to authenticated
  with check (private.has_permission(organization_id, 'inventory.items.manage'));
create policy stock_locations_update on public.stock_locations
  for update to authenticated
  using (private.has_permission(organization_id, 'inventory.items.manage'))
  with check (private.has_permission(organization_id, 'inventory.items.manage'));

create policy stock_items_select on public.stock_items
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read')
    or private.has_permission(organization_id, 'products.manage'));
create policy stock_items_insert on public.stock_items
  for insert to authenticated
  with check (private.has_permission(organization_id, 'inventory.items.manage'));
create policy stock_items_update on public.stock_items
  for update to authenticated
  using (private.has_permission(organization_id, 'inventory.items.manage'))
  with check (private.has_permission(organization_id, 'inventory.items.manage'));

create policy stock_lots_select on public.stock_lots
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read'));

create policy stock_lot_certificates_select on public.stock_lot_certificates
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read'));
create policy stock_lot_certificates_insert on public.stock_lot_certificates
  for insert to authenticated
  with check (private.has_permission(organization_id, 'inventory.move'));
create policy stock_lot_certificates_update on public.stock_lot_certificates
  for update to authenticated
  using (private.has_permission(organization_id, 'inventory.move'))
  with check (private.has_permission(organization_id, 'inventory.move'));

create policy stock_documents_select on public.stock_documents
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read'));
create policy stock_adjustment_lines_select on public.stock_adjustment_lines
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read'));
create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (private.has_permission(organization_id, 'inventory.read'));

revoke execute on function
  private.guard_stock_location(),
  private.seed_organization_stock_location(),
  private.prevent_stock_movement_update(),
  private.guard_stock_item(),
  private.stock_item_kg_per_unit(uuid),
  private.stock_line_quantity(text, integer, numeric, numeric, numeric),
  private.stock_unit_cost(uuid),
  private.inventory_vat_rate(uuid),
  private.lock_stock_items(uuid, uuid[]),
  private.assert_document_not_negative(uuid),
  private.assert_inventory_access(uuid, text),
  private.next_stock_number(uuid, text, text),
  private.stock_line_for_item(uuid, uuid, integer, numeric, numeric, numeric, boolean),
  private.assert_stock_location(uuid, uuid),
  private.post_stock_adjustment(uuid)
  from public;

revoke execute on function
  public.post_stock_receipt(uuid, uuid, jsonb, jsonb),
  public.post_stock_transfer(uuid, uuid, jsonb, text),
  public.request_stock_adjustment(uuid, uuid, text, jsonb, boolean),
  public.decide_stock_adjustment(uuid, boolean, text)
  from public, anon;
grant execute on function
  public.post_stock_receipt(uuid, uuid, jsonb, jsonb),
  public.post_stock_transfer(uuid, uuid, jsonb, text),
  public.request_stock_adjustment(uuid, uuid, text, jsonb, boolean),
  public.decide_stock_adjustment(uuid, boolean, text)
  to authenticated;
