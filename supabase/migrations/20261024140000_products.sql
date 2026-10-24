-- Phase 2: products / parts with revisions, routings (operations) and
-- attachments. Module `production`. Access model (D-014):
--   products.read    admin, director, head_of_production, warehouse
--   products.manage  admin, director, head_of_production (+ operation types,
--                    product types, material shapes)
-- Operators get read access to products later, through their production orders.
--
-- Revisions: every revision is a row; exactly one is current per product.
-- Only the current revision (of a non-archived product) can be changed, older
-- ones are history. An older revision can be made current again.
-- Cycle times are stored in seconds (exact for minute input with 2 decimals);
-- the display unit is per organization (organizations.settings.cycle_time_unit)
-- with an optional override per machine (machines.cycle_time_unit).

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module_key, description, default_roles) values
  ('products.read', 'production', 'View products, revisions, operations and attachments',
    '{admin,director,head_of_production,warehouse}'),
  ('products.manage', 'production',
    'Create, edit, copy and archive products; manage operation types, product types and material shapes',
    '{admin,director,head_of_production}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.key in ('products.read', 'products.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Catalog kinds and settings for cycle-time units
-- ---------------------------------------------------------------------------
alter table public.catalog_items drop constraint catalog_items_kind_check;
alter table public.catalog_items add constraint catalog_items_kind_check
  check (kind in (
    'machine_type', 'location', 'department', 'job_title', 'skill',
    'product_type', 'material_shape'
  ));

create or replace function private.catalog_manage_permission(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('machine_type', 'location') then 'machines.manage'
    when p_kind in ('department', 'job_title', 'skill') then 'employees.manage'
    when p_kind in ('product_type', 'material_shape') then 'products.manage'
  end
$$;

alter table public.organizations add constraint organizations_cycle_time_unit_check
  check (coalesce(settings ->> 'cycle_time_unit', 'min') in ('min', 's'));

-- null = organization default.
alter table public.machines add column cycle_time_unit text
  check (cycle_time_unit in ('min', 's'));

grant insert (cycle_time_unit), update (cycle_time_unit) on public.machines to authenticated;

create or replace view public.machine_directory
with (security_invoker = true)
as
select
  m.id,
  m.organization_id,
  m.code,
  m.name,
  m.type_id,
  t.name as type_name,
  m.manufacturer,
  m.model,
  m.location_id,
  l.name as location_name,
  m.status,
  m.status_changed_at,
  m.notes,
  m.created_at,
  m.archived_at,
  m.cycle_time_unit
from public.machines m
left join public.catalog_items t on t.id = m.type_id and t.organization_id = m.organization_id
left join public.catalog_items l on l.id = m.location_id and l.organization_id = m.organization_id;

-- ---------------------------------------------------------------------------
-- Operation types (catalog with abbreviation)
-- ---------------------------------------------------------------------------
create table public.operation_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 100),
  -- Abbreviation shown on routings and orders, e.g. BU = Brušenje unutrašnje.
  code text not null check (code ~ '^[A-Z0-9ČĆĐŠŽ-]{1,10}$'),
  -- Done by another company: no machine, setup or cycle time.
  is_external boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id)
);

comment on table public.operation_types is
  'Per-organization operation catalog (name + abbreviation, internal or external).';

create unique index operation_types_name_key
  on public.operation_types (organization_id, lower(btrim(name)))
  where archived_at is null;
create unique index operation_types_code_key
  on public.operation_types (organization_id, code)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- Products and revisions
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Part number as given by the customer; unique among non-archived products.
  part_number text not null check (length(btrim(part_number)) between 1 and 100),
  name text not null check (length(btrim(name)) between 1 and 200),
  -- Free text until the customers module exists.
  customer_name text check (customer_name is null or length(btrim(customer_name)) between 1 and 200),
  product_type_id uuid,
  product_type_kind text generated always as ('product_type') stored,
  unit text not null default 'pcs' check (unit in ('pcs', 'kg', 'm', 'm2', 'set')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, product_type_kind, product_type_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict
);

create unique index products_part_number_key
  on public.products (organization_id, lower(btrim(part_number)))
  where archived_at is null;
create index products_type_idx
  on public.products (organization_id, product_type_kind, product_type_id);

create table public.product_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  revision text not null check (revision ~ '^[A-Za-z0-9.-]{1,10}$'),
  is_current boolean not null default false,
  drawing_number text check (drawing_number is null or length(btrim(drawing_number)) between 1 and 100),
  description text check (description is null or length(description) <= 2000),
  -- Material grade as text (S235, C45, AlMg3) until the material warehouse exists.
  material_grade text check (material_grade is null or length(btrim(material_grade)) between 1 and 100),
  material_shape_id uuid,
  material_shape_kind text generated always as ('material_shape') stored,
  -- Raw blank: round (diameter, width, height) or prismatic (width, height, thickness).
  blank_geometry text check (blank_geometry in ('round', 'prismatic')),
  blank_diameter_mm numeric(10, 3) check (blank_diameter_mm > 0),
  blank_width_mm numeric(10, 3) check (blank_width_mm > 0),
  blank_height_mm numeric(10, 3) check (blank_height_mm > 0),
  blank_thickness_mm numeric(10, 3) check (blank_thickness_mm > 0),
  -- Cut length per piece (one piece per cut) and saw kerf, for material calculation.
  cut_length_mm numeric(10, 3) check (cut_length_mm > 0),
  kerf_mm numeric(8, 3) check (kerf_mm >= 0),
  net_mass_kg numeric(12, 4) check (net_mass_kg > 0),
  -- No FK (like audit_log.actor_id): history must outlive users.
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, product_id)
    references public.products (organization_id, id) on delete restrict,
  foreign key (organization_id, material_shape_kind, material_shape_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict,
  constraint product_revisions_blank_check check (
    (blank_geometry is null
      and num_nonnulls(blank_diameter_mm, blank_width_mm, blank_height_mm, blank_thickness_mm) = 0)
    or (blank_geometry = 'round' and blank_thickness_mm is null)
    or (blank_geometry = 'prismatic' and blank_diameter_mm is null)
  )
);

create unique index product_revisions_revision_key
  on public.product_revisions (product_id, upper(revision));
create unique index product_revisions_current_key
  on public.product_revisions (product_id)
  where is_current;
create index product_revisions_product_idx on public.product_revisions (organization_id, product_id);
create index product_revisions_shape_idx
  on public.product_revisions (organization_id, material_shape_kind, material_shape_id);

-- ---------------------------------------------------------------------------
-- Operations (routing of a revision)
-- ---------------------------------------------------------------------------
create table public.product_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  revision_id uuid not null,
  -- 10, 20, 30 …; archived operations keep their number.
  sequence integer not null check (sequence between 1 and 9999),
  operation_type_id uuid not null,
  description text check (description is null or length(btrim(description)) between 1 and 200),
  machine_type_id uuid,
  machine_type_kind text generated always as ('machine_type') stored,
  machine_id uuid,
  -- External operations only: who does it.
  external_company text
    check (external_company is null or length(btrim(external_company)) between 1 and 200),
  setup_time_min numeric(10, 2) check (setup_time_min >= 0),
  cycle_time_s numeric(12, 3) check (cycle_time_s > 0),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  -- Deferrable so move_product_operation can swap two numbers.
  constraint product_operations_sequence_key unique (revision_id, sequence)
    deferrable initially immediate,
  constraint product_operations_machine_check check (num_nonnulls(machine_type_id, machine_id) <= 1),
  foreign key (organization_id, revision_id)
    references public.product_revisions (organization_id, id) on delete restrict,
  foreign key (organization_id, operation_type_id)
    references public.operation_types (organization_id, id) on delete restrict,
  foreign key (organization_id, machine_type_kind, machine_type_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict,
  foreign key (organization_id, machine_id)
    references public.machines (organization_id, id) on delete restrict
);

create index product_operations_revision_idx on public.product_operations (organization_id, revision_id);
create index product_operations_type_idx on public.product_operations (organization_id, operation_type_id);
create index product_operations_machine_type_idx
  on public.product_operations (organization_id, machine_type_kind, machine_type_id);
create index product_operations_machine_idx on public.product_operations (organization_id, machine_id);

-- ---------------------------------------------------------------------------
-- Attachments (files in the private bucket product-files)
-- ---------------------------------------------------------------------------
create table public.product_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  revision_id uuid not null,
  kind text not null check (kind in ('main_drawing', 'machine_drawing', 'image', 'other')),
  -- Machine drawings (CNC dimensions) belong to a main drawing of the same revision.
  main_drawing_id uuid,
  -- Optional: the operation a machine drawing is for.
  operation_id uuid,
  title text check (title is null or length(btrim(title)) between 1 and 200),
  file_name text not null check (length(file_name) between 1 and 255),
  -- <organization_id>/<product_id>/<uuid>.<ext>; revision copies share the file.
  storage_path text not null
    check (length(storage_path) <= 500 and storage_path like organization_id::text || '/%'),
  content_type text not null
    check (content_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  unique (revision_id, storage_path),
  constraint product_attachments_main_drawing_check
    check ((kind = 'machine_drawing') = (main_drawing_id is not null)),
  constraint product_attachments_operation_check
    check (operation_id is null or kind = 'machine_drawing'),
  foreign key (organization_id, revision_id)
    references public.product_revisions (organization_id, id) on delete restrict,
  foreign key (organization_id, main_drawing_id)
    references public.product_attachments (organization_id, id) on delete restrict,
  foreign key (organization_id, operation_id)
    references public.product_operations (organization_id, id) on delete restrict
);

create index product_attachments_revision_idx on public.product_attachments (organization_id, revision_id);
create index product_attachments_main_drawing_idx
  on public.product_attachments (organization_id, main_drawing_id);
create index product_attachments_operation_idx on public.product_attachments (organization_id, operation_id);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
-- Only the current revision of a non-archived product can be changed. Flipping
-- is_current is allowed on any revision, as long as nothing else changes.
create function private.guard_product_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_id is distinct from old.product_id
    or new.organization_id is distinct from old.organization_id
    or new.revision is distinct from old.revision then
    raise exception 'revision identity cannot change' using errcode = '55000';
  end if;
  if new.is_current is distinct from old.is_current then
    -- Generated columns are not computed yet in BEFORE triggers (null in NEW).
    if (to_jsonb(new) - '{is_current,updated_at,material_shape_kind}'::text[])
      <> (to_jsonb(old) - '{is_current,updated_at,material_shape_kind}'::text[]) then
      raise exception 'change the current revision separately' using errcode = '55000';
    end if;
  elsif not old.is_current then
    raise exception 'revision is not current' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger product_revisions_guard before update on public.product_revisions
  for each row execute function private.guard_product_revision();

-- SECURITY DEFINER: decides on rows the caller may not be able to read.
create function private.assert_revision_editable(p_org_id uuid, p_revision_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.product_revisions r
    join public.products p on p.id = r.product_id and p.organization_id = r.organization_id
    where r.id = p_revision_id
      and r.organization_id = p_org_id
      and r.is_current
      and p.archived_at is null
  ) then
    raise exception 'revision is not current' using errcode = '55000';
  end if;
end;
$$;

create function private.check_product_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_external boolean;
begin
  if tg_op = 'UPDATE' and new.revision_id is distinct from old.revision_id then
    raise exception 'operation cannot move to another revision' using errcode = '55000';
  end if;
  perform private.assert_revision_editable(new.organization_id, new.revision_id);

  select t.is_external into v_external
  from public.operation_types t
  where t.id = new.operation_type_id and t.organization_id = new.organization_id;

  if v_external then
    if num_nonnulls(new.machine_type_id, new.machine_id, new.setup_time_min, new.cycle_time_s) > 0 then
      raise exception 'external operations have no machine, setup or cycle time'
        using errcode = '23514';
    end if;
  elsif new.external_company is not null then
    raise exception 'only external operations have an external company' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger product_operations_check before insert or update on public.product_operations
  for each row execute function private.check_product_operation();

create function private.check_product_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.revision_id is distinct from old.revision_id then
    raise exception 'attachment cannot move to another revision' using errcode = '55000';
  end if;
  perform private.assert_revision_editable(new.organization_id, new.revision_id);

  if new.main_drawing_id is not null and not exists (
    select 1 from public.product_attachments a
    where a.id = new.main_drawing_id
      and a.revision_id = new.revision_id
      and a.kind = 'main_drawing'
  ) then
    raise exception 'main drawing must be a main drawing of the same revision' using errcode = '23514';
  end if;

  if new.operation_id is not null and not exists (
    select 1 from public.product_operations o
    where o.id = new.operation_id and o.revision_id = new.revision_id
  ) then
    raise exception 'operation must belong to the same revision' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger product_attachments_check before insert or update on public.product_attachments
  for each row execute function private.check_product_attachment();

create trigger operation_types_set_updated_at before update on public.operation_types
  for each row execute function private.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function private.set_updated_at();
create trigger product_revisions_set_updated_at before update on public.product_revisions
  for each row execute function private.set_updated_at();
create trigger product_operations_set_updated_at before update on public.product_operations
  for each row execute function private.set_updated_at();
create trigger product_attachments_set_updated_at before update on public.product_attachments
  for each row execute function private.set_updated_at();

create trigger operation_types_audit after insert or update on public.operation_types
  for each row execute function private.audit_row_change();
create trigger products_audit after insert or update on public.products
  for each row execute function private.audit_row_change();
create trigger product_revisions_audit after insert or update on public.product_revisions
  for each row execute function private.audit_row_change();
create trigger product_operations_audit after insert or update on public.product_operations
  for each row execute function private.audit_row_change();
create trigger product_attachments_audit after insert or update on public.product_attachments
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY INVOKER: RLS applies; the explicit permission checks only
-- produce clear errors). Product fields arrive as JSON objects:
--   p_product  {part_number, name, customer_name, product_type_id, unit}
--   p_revision {revision, drawing_number, description, material_grade,
--               material_shape_id, blank_geometry, blank_diameter_mm,
--               blank_width_mm, blank_height_mm, blank_thickness_mm,
--               cut_length_mm, kerf_mm, net_mass_kg}
-- ---------------------------------------------------------------------------
create function private.require_products_manage(p_org_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'products.manage') then
    raise exception 'missing permission products.manage' using errcode = '42501';
  end if;
end;
$$;

-- Organization of a non-archived product the caller can see, locked for the
-- rest of the transaction (serializes revision changes per product).
create function private.lock_product(p_product_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select p.organization_id into v_org_id
  from public.products p
  where p.id = p_product_id and p.archived_at is null
  for update;
  if v_org_id is null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  perform private.require_products_manage(v_org_id);
  return v_org_id;
end;
$$;

-- Copies operations (and optionally attachments) of one revision into another.
create function private.copy_revision_content(
  p_org_id uuid,
  p_source_revision_id uuid,
  p_target_revision_id uuid,
  p_with_attachments boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_op record;
  v_att record;
  v_new_id uuid;
  v_ops jsonb := '{}'::jsonb;
  v_atts jsonb := '{}'::jsonb;
begin
  for v_op in
    select * from public.product_operations o
    where o.revision_id = p_source_revision_id and o.archived_at is null
    order by o.sequence
  loop
    insert into public.product_operations (
      organization_id, revision_id, sequence, operation_type_id, description,
      machine_type_id, machine_id, external_company, setup_time_min, cycle_time_s, notes
    ) values (
      p_org_id, p_target_revision_id, v_op.sequence, v_op.operation_type_id, v_op.description,
      v_op.machine_type_id, v_op.machine_id, v_op.external_company, v_op.setup_time_min,
      v_op.cycle_time_s, v_op.notes
    )
    returning id into v_new_id;
    v_ops := v_ops || jsonb_build_object(v_op.id::text, v_new_id);
  end loop;

  if not p_with_attachments then
    return;
  end if;

  -- Main drawings and other files first, then machine drawings (they point to a main drawing).
  for v_att in
    select * from public.product_attachments a
    where a.revision_id = p_source_revision_id
      and a.archived_at is null
      and (a.kind <> 'machine_drawing' or exists (
        select 1 from public.product_attachments m
        where m.id = a.main_drawing_id and m.archived_at is null
      ))
    order by (a.kind = 'machine_drawing'), a.created_at
  loop
    insert into public.product_attachments (
      organization_id, revision_id, kind, main_drawing_id, operation_id, title,
      file_name, storage_path, content_type, size_bytes
    ) values (
      p_org_id, p_target_revision_id, v_att.kind,
      (v_atts ->> v_att.main_drawing_id::text)::uuid,
      (v_ops ->> v_att.operation_id::text)::uuid,
      v_att.title, v_att.file_name, v_att.storage_path, v_att.content_type, v_att.size_bytes
    )
    returning id into v_new_id;
    v_atts := v_atts || jsonb_build_object(v_att.id::text, v_new_id);
  end loop;
end;
$$;

create function private.insert_product_revision(
  p_org_id uuid,
  p_product_id uuid,
  p_revision jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.product_revisions (
    organization_id, product_id, revision, is_current, drawing_number, description,
    material_grade, material_shape_id, blank_geometry, blank_diameter_mm, blank_width_mm,
    blank_height_mm, blank_thickness_mm, cut_length_mm, kerf_mm, net_mass_kg
  ) values (
    p_org_id, p_product_id, btrim(p_revision ->> 'revision'), true,
    p_revision ->> 'drawing_number', p_revision ->> 'description',
    p_revision ->> 'material_grade', (p_revision ->> 'material_shape_id')::uuid,
    p_revision ->> 'blank_geometry', (p_revision ->> 'blank_diameter_mm')::numeric,
    (p_revision ->> 'blank_width_mm')::numeric, (p_revision ->> 'blank_height_mm')::numeric,
    (p_revision ->> 'blank_thickness_mm')::numeric, (p_revision ->> 'cut_length_mm')::numeric,
    (p_revision ->> 'kerf_mm')::numeric, (p_revision ->> 'net_mass_kg')::numeric
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Product with its first (current) revision.
create function public.create_product(p_org_id uuid, p_product jsonb, p_revision jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_products_manage(p_org_id);

  insert into public.products (organization_id, part_number, name, customer_name, product_type_id, unit)
  values (
    p_org_id, btrim(p_product ->> 'part_number'), btrim(p_product ->> 'name'),
    p_product ->> 'customer_name', (p_product ->> 'product_type_id')::uuid,
    coalesce(p_product ->> 'unit', 'pcs')
  )
  returning id into v_id;

  perform private.insert_product_revision(p_org_id, v_id, p_revision);
  return v_id;
end;
$$;

-- Product fields and the current revision's fields (not the revision label).
create function public.update_product(p_product_id uuid, p_product jsonb, p_revision jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid := private.lock_product(p_product_id);
begin
  update public.products set
    part_number = btrim(p_product ->> 'part_number'),
    name = btrim(p_product ->> 'name'),
    customer_name = p_product ->> 'customer_name',
    product_type_id = (p_product ->> 'product_type_id')::uuid,
    unit = coalesce(p_product ->> 'unit', 'pcs')
  where id = p_product_id and organization_id = v_org_id;

  update public.product_revisions set
    drawing_number = p_revision ->> 'drawing_number',
    description = p_revision ->> 'description',
    material_grade = p_revision ->> 'material_grade',
    material_shape_id = (p_revision ->> 'material_shape_id')::uuid,
    blank_geometry = p_revision ->> 'blank_geometry',
    blank_diameter_mm = (p_revision ->> 'blank_diameter_mm')::numeric,
    blank_width_mm = (p_revision ->> 'blank_width_mm')::numeric,
    blank_height_mm = (p_revision ->> 'blank_height_mm')::numeric,
    blank_thickness_mm = (p_revision ->> 'blank_thickness_mm')::numeric,
    cut_length_mm = (p_revision ->> 'cut_length_mm')::numeric,
    kerf_mm = (p_revision ->> 'kerf_mm')::numeric,
    net_mass_kg = (p_revision ->> 'net_mass_kg')::numeric
  where product_id = p_product_id and organization_id = v_org_id and is_current;

  if not found then
    raise exception 'current revision not found' using errcode = 'P0002';
  end if;
  return p_product_id;
end;
$$;

-- New revision copied from p_source_revision_id (default: the current one),
-- including operations and attachments; it becomes the current revision.
create function public.create_product_revision(
  p_product_id uuid,
  p_revision text,
  p_source_revision_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid := private.lock_product(p_product_id);
  v_source public.product_revisions;
  v_new_id uuid;
begin
  select * into v_source
  from public.product_revisions r
  where r.product_id = p_product_id
    and r.organization_id = v_org_id
    and (r.id = p_source_revision_id or (p_source_revision_id is null and r.is_current));
  if v_source.id is null then
    raise exception 'source revision not found' using errcode = 'P0002';
  end if;

  update public.product_revisions set is_current = false
  where product_id = p_product_id and is_current;

  v_new_id := private.insert_product_revision(
    v_org_id, p_product_id,
    (to_jsonb(v_source) - 'revision') || jsonb_build_object('revision', p_revision)
  );
  perform private.copy_revision_content(v_org_id, v_source.id, v_new_id, true);

  perform public.write_audit(
    v_org_id, 'products.revision_created', 'products', p_product_id::text,
    jsonb_build_object('revision', v_source.revision),
    jsonb_build_object('revision', btrim(p_revision), 'revision_id', v_new_id)
  );
  return v_new_id;
end;
$$;

-- New product (new part number) from a revision: product and revision fields
-- plus operations, no attachments; starts at p_revision.
create function public.copy_product(
  p_source_revision_id uuid,
  p_part_number text,
  p_name text,
  p_revision text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.product_revisions;
  v_product public.products;
  v_new_product_id uuid;
  v_new_revision_id uuid;
begin
  select * into v_source from public.product_revisions r where r.id = p_source_revision_id;
  if v_source.id is null then
    raise exception 'source revision not found' using errcode = 'P0002';
  end if;
  perform private.require_products_manage(v_source.organization_id);
  select * into v_product from public.products p where p.id = v_source.product_id;

  insert into public.products (organization_id, part_number, name, customer_name, product_type_id, unit)
  values (
    v_source.organization_id, btrim(p_part_number), btrim(p_name), v_product.customer_name,
    v_product.product_type_id, v_product.unit
  )
  returning id into v_new_product_id;

  v_new_revision_id := private.insert_product_revision(
    v_source.organization_id, v_new_product_id,
    (to_jsonb(v_source) - 'revision') || jsonb_build_object('revision', p_revision)
  );
  perform private.copy_revision_content(
    v_source.organization_id, v_source.id, v_new_revision_id, false
  );

  perform public.write_audit(
    v_source.organization_id, 'products.copied', 'products', v_new_product_id::text,
    jsonb_build_object(
      'product_id', v_product.id, 'part_number', v_product.part_number,
      'revision', v_source.revision
    ),
    jsonb_build_object('part_number', btrim(p_part_number), 'revision', btrim(p_revision))
  );
  return v_new_product_id;
end;
$$;

-- Makes an older revision current again (e.g. a change was withdrawn).
create function public.set_current_revision(p_revision_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_org_id uuid;
  v_previous text;
  v_target text;
begin
  select r.product_id, r.revision into v_product_id, v_target
  from public.product_revisions r where r.id = p_revision_id;
  if v_product_id is null then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;
  v_org_id := private.lock_product(v_product_id);

  select r.revision into v_previous
  from public.product_revisions r where r.product_id = v_product_id and r.is_current;
  if v_previous = v_target then
    return;
  end if;

  update public.product_revisions set is_current = false
  where product_id = v_product_id and is_current;
  update public.product_revisions set is_current = true where id = p_revision_id;

  perform public.write_audit(
    v_org_id, 'products.revision_restored', 'products', v_product_id::text,
    jsonb_build_object('revision', v_previous), jsonb_build_object('revision', v_target)
  );
end;
$$;

-- Swaps an operation with its previous (-1) or next (+1) non-archived neighbour.
create function public.move_product_operation(p_operation_id uuid, p_direction integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_op public.product_operations;
  v_other public.product_operations;
begin
  if p_direction not in (-1, 1) then
    raise exception 'direction must be -1 or 1' using errcode = '22023';
  end if;
  select * into v_op from public.product_operations o
  where o.id = p_operation_id and o.archived_at is null;
  if v_op.id is null then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  perform private.require_products_manage(v_op.organization_id);

  select * into v_other from public.product_operations o
  where o.revision_id = v_op.revision_id
    and o.archived_at is null
    and case when p_direction < 0 then o.sequence < v_op.sequence else o.sequence > v_op.sequence end
  order by case when p_direction < 0 then -o.sequence else o.sequence end
  limit 1;
  if v_other.id is null then
    return;
  end if;

  set constraints public.product_operations_sequence_key deferred;
  update public.product_operations set sequence = v_other.sequence where id = v_op.id;
  update public.product_operations set sequence = v_op.sequence where id = v_other.id;
  set constraints public.product_operations_sequence_key immediate;
end;
$$;

-- Audit entries of a product, its revisions, operations and attachments.
-- SECURITY DEFINER: audit_log itself needs audit.read; here products.read is enough.
create function public.product_history(p_product_id uuid, p_limit integer default 200)
returns table (
  id bigint,
  created_at timestamptz,
  actor_id uuid,
  actor_username text,
  action text,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with product as (
    select p.id, p.organization_id
    from public.products p
    where p.id = p_product_id
      and private.has_permission(p.organization_id, 'products.read')
  ),
  revisions as (
    select r.id from public.product_revisions r join product on r.product_id = product.id
  ),
  entities as (
    select product.id::text as id from product
    union all select r.id::text from revisions r
    union all select o.id::text from public.product_operations o join revisions r on r.id = o.revision_id
    union all select a.id::text from public.product_attachments a join revisions r on r.id = a.revision_id
  )
  select a.id, a.created_at, a.actor_id, pf.username, a.action, a.entity_type, a.entity_id,
    a.before, a.after
  from public.audit_log a
  join product on a.organization_id = product.organization_id
  left join public.profiles pf on pf.id = a.actor_id and pf.organization_id = a.organization_id
  where a.entity_type in ('products', 'product_revisions', 'product_operations', 'product_attachments')
    and a.entity_id in (select e.id from entities e)
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

-- ---------------------------------------------------------------------------
-- List view (security_invoker): product + current revision
-- ---------------------------------------------------------------------------
create view public.product_directory
with (security_invoker = true)
as
select
  p.id,
  p.organization_id,
  p.part_number,
  p.name,
  p.customer_name,
  p.product_type_id,
  t.name as product_type_name,
  p.unit,
  p.created_at,
  p.archived_at,
  r.id as revision_id,
  r.revision,
  r.drawing_number,
  r.material_grade,
  r.material_shape_id,
  s.name as material_shape_name,
  (
    select count(*)::integer from public.product_operations o
    where o.revision_id = r.id and o.archived_at is null
  ) as operation_count
from public.products p
left join public.product_revisions r on r.product_id = p.id and r.is_current
left join public.catalog_items t on t.id = p.product_type_id and t.organization_id = p.organization_id
left join public.catalog_items s on s.id = r.material_shape_id and s.organization_id = r.organization_id;

comment on view public.product_directory is
  'Products with their current revision for list screens (security_invoker).';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on
  public.operation_types, public.products, public.product_revisions,
  public.product_operations, public.product_attachments, public.product_directory
from anon, authenticated;

grant select on
  public.operation_types, public.products, public.product_revisions,
  public.product_operations, public.product_attachments, public.product_directory
to authenticated;

grant insert (organization_id, name, code, is_external), update (name, code, is_external, archived_at)
  on public.operation_types to authenticated;
grant insert (organization_id, part_number, name, customer_name, product_type_id, unit),
  update (part_number, name, customer_name, product_type_id, unit, archived_at)
  on public.products to authenticated;
grant insert (organization_id, product_id, revision, is_current, drawing_number, description,
    material_grade, material_shape_id, blank_geometry, blank_diameter_mm, blank_width_mm,
    blank_height_mm, blank_thickness_mm, cut_length_mm, kerf_mm, net_mass_kg),
  update (is_current, drawing_number, description, material_grade, material_shape_id,
    blank_geometry, blank_diameter_mm, blank_width_mm, blank_height_mm, blank_thickness_mm,
    cut_length_mm, kerf_mm, net_mass_kg)
  on public.product_revisions to authenticated;
grant insert (organization_id, revision_id, sequence, operation_type_id, description,
    machine_type_id, machine_id, external_company, setup_time_min, cycle_time_s, notes),
  update (sequence, operation_type_id, description, machine_type_id, machine_id,
    external_company, setup_time_min, cycle_time_s, notes, archived_at)
  on public.product_operations to authenticated;
grant insert (organization_id, revision_id, kind, main_drawing_id, operation_id, title,
    file_name, storage_path, content_type, size_bytes),
  update (title, archived_at)
  on public.product_attachments to authenticated;

revoke execute on function private.assert_revision_editable(uuid, uuid) from public;
revoke execute on function private.require_products_manage(uuid) from public;
revoke execute on function private.lock_product(uuid) from public;
revoke execute on function private.copy_revision_content(uuid, uuid, uuid, boolean) from public;
revoke execute on function private.insert_product_revision(uuid, uuid, jsonb) from public;
grant execute on function private.assert_revision_editable(uuid, uuid) to authenticated;
grant execute on function private.require_products_manage(uuid) to authenticated;
grant execute on function private.lock_product(uuid) to authenticated;
grant execute on function private.copy_revision_content(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function private.insert_product_revision(uuid, uuid, jsonb) to authenticated;

revoke execute on function public.create_product(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.update_product(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.create_product_revision(uuid, text, uuid) from public, anon;
revoke execute on function public.copy_product(uuid, text, text, text) from public, anon;
revoke execute on function public.set_current_revision(uuid) from public, anon;
revoke execute on function public.move_product_operation(uuid, integer) from public, anon;
revoke execute on function public.product_history(uuid, integer) from public, anon;
grant execute on function public.create_product(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.update_product(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.create_product_revision(uuid, text, uuid) to authenticated;
grant execute on function public.copy_product(uuid, text, text, text) to authenticated;
grant execute on function public.set_current_revision(uuid) to authenticated;
grant execute on function public.move_product_operation(uuid, integer) to authenticated;
grant execute on function public.product_history(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.operation_types enable row level security;
alter table public.products enable row level security;
alter table public.product_revisions enable row level security;
alter table public.product_operations enable row level security;
alter table public.product_attachments enable row level security;

-- operation_types: names are shown wherever operations appear → every member reads them.
create policy operation_types_select on public.operation_types
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));
create policy operation_types_insert on public.operation_types
  for insert to authenticated
  with check (private.has_permission(organization_id, 'products.manage'));
create policy operation_types_update on public.operation_types
  for update to authenticated
  using (private.has_permission(organization_id, 'products.manage'))
  with check (private.has_permission(organization_id, 'products.manage'));

create policy products_select on public.products
  for select to authenticated
  using (private.has_permission(organization_id, 'products.read'));
create policy products_insert on public.products
  for insert to authenticated
  with check (private.has_permission(organization_id, 'products.manage'));
create policy products_update on public.products
  for update to authenticated
  using (private.has_permission(organization_id, 'products.manage'))
  with check (private.has_permission(organization_id, 'products.manage'));

create policy product_revisions_select on public.product_revisions
  for select to authenticated
  using (private.has_permission(organization_id, 'products.read'));
create policy product_revisions_insert on public.product_revisions
  for insert to authenticated
  with check (private.has_permission(organization_id, 'products.manage'));
create policy product_revisions_update on public.product_revisions
  for update to authenticated
  using (private.has_permission(organization_id, 'products.manage'))
  with check (private.has_permission(organization_id, 'products.manage'));

create policy product_operations_select on public.product_operations
  for select to authenticated
  using (private.has_permission(organization_id, 'products.read'));
create policy product_operations_insert on public.product_operations
  for insert to authenticated
  with check (private.has_permission(organization_id, 'products.manage'));
create policy product_operations_update on public.product_operations
  for update to authenticated
  using (private.has_permission(organization_id, 'products.manage'))
  with check (private.has_permission(organization_id, 'products.manage'));

create policy product_attachments_select on public.product_attachments
  for select to authenticated
  using (private.has_permission(organization_id, 'products.read'));
create policy product_attachments_insert on public.product_attachments
  for insert to authenticated
  with check (private.has_permission(organization_id, 'products.manage'));
create policy product_attachments_update on public.product_attachments
  for update to authenticated
  using (private.has_permission(organization_id, 'products.manage'))
  with check (private.has_permission(organization_id, 'products.manage'));

-- ---------------------------------------------------------------------------
-- Storage: private bucket for drawings and images
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-files', 'product-files', false, 20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Organization id from the first path segment, or null when it is not a uuid.
create function private.storage_org_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end
$$;

revoke execute on function private.storage_org_id(text) from public;
grant execute on function private.storage_org_id(text) to authenticated;

-- No update/delete policies: files are immutable; attachments are archived.
create policy product_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-files'
    and private.has_permission(private.storage_org_id(name), 'products.read')
  );

create policy product_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-files'
    and private.has_permission(private.storage_org_id(name), 'products.manage')
  );
