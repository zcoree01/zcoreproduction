-- Products v2 (D-015): customers, materials with density, raw blank shapes
-- with computed weight, optional revision labels, inspection planning and
-- routing order maintained by the database.
--
--   customers.read    admin, director, head_of_production, warehouse
--   customers.manage  admin, director, head_of_production
--   materials are managed with products.manage
--
-- Data migrations: products.customer_name → customers; revision
-- material_grade → materials; blank 'prismatic' → 'rectangular';
-- blank_height_mm → cut_length_mm (when no length was set). The columns
-- customer_name, material_grade, material_shape_id and blank_height_mm are
-- dropped afterwards.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module_key, description, default_roles) values
  ('customers.read', 'production', 'View customers and their products',
    '{admin,director,head_of_production,warehouse}'),
  ('customers.manage', 'production', 'Create, edit and archive customers',
    '{admin,director,head_of_production}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.key in ('customers.read', 'customers.manage')
on conflict do nothing;

-- Views and functions below are recreated for the new columns.
drop view public.product_directory;
drop function public.move_product_operation(uuid, integer);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  tax_id text check (tax_id is null or length(btrim(tax_id)) between 1 and 50),
  address text check (address is null or length(btrim(address)) between 1 and 300),
  city text check (city is null or length(btrim(city)) between 1 and 100),
  country text check (country is null or length(btrim(country)) between 1 and 100),
  contact_person text check (contact_person is null or length(btrim(contact_person)) between 1 and 200),
  phone text check (phone is null or length(btrim(phone)) between 1 and 50),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id)
);

create unique index customers_name_key
  on public.customers (organization_id, lower(btrim(name)))
  where archived_at is null;

create trigger customers_set_updated_at before update on public.customers
  for each row execute function private.set_updated_at();
create trigger customers_audit after insert or update on public.customers
  for each row execute function private.audit_row_change();

alter table public.products
  add column customer_id uuid,
  add constraint products_customer_fkey foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete restrict;
create index products_customer_idx on public.products (organization_id, customer_id);

insert into public.customers (organization_id, name)
select distinct on (p.organization_id, lower(btrim(p.customer_name)))
  p.organization_id, btrim(p.customer_name)
from public.products p
where p.customer_name is not null
order by p.organization_id, lower(btrim(p.customer_name)), p.created_at;

update public.products p set customer_id = c.id
from public.customers c
where c.organization_id = p.organization_id
  and c.archived_at is null
  and lower(btrim(c.name)) = lower(btrim(p.customer_name));

alter table public.products drop column customer_name;

-- ---------------------------------------------------------------------------
-- Materials: group (default density) → designation (optional own density)
-- ---------------------------------------------------------------------------
create table public.material_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 100),
  -- kg/dm³ (= g/cm³).
  density_kg_dm3 numeric(8, 4) check (density_kg_dm3 > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id)
);

create unique index material_groups_name_key
  on public.material_groups (organization_id, lower(btrim(name)))
  where archived_at is null;

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  group_id uuid not null,
  -- e.g. "1.4301 (AISI 304)", "C45", "EN AW-6082".
  designation text not null check (length(btrim(designation)) between 1 and 100),
  -- Overrides the group density when set.
  density_kg_dm3 numeric(8, 4) check (density_kg_dm3 > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, group_id)
    references public.material_groups (organization_id, id) on delete restrict
);

create unique index materials_designation_key
  on public.materials (organization_id, lower(btrim(designation)))
  where archived_at is null;
create index materials_group_idx on public.materials (organization_id, group_id);

create trigger material_groups_set_updated_at before update on public.material_groups
  for each row execute function private.set_updated_at();
create trigger materials_set_updated_at before update on public.materials
  for each row execute function private.set_updated_at();
create trigger material_groups_audit after insert or update on public.material_groups
  for each row execute function private.audit_row_change();
create trigger materials_audit after insert or update on public.materials
  for each row execute function private.audit_row_change();

-- Starter list (densities in kg/dm³ from common material data sheets; each
-- organization can correct them). Adds only groups/designations that are missing.
create function private.seed_default_materials(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_group_id uuid;
begin
  for v_row in
    select * from (values
      ('Čelik', 7.85::numeric, 'S235JR', null::numeric),
      ('Čelik', 7.85, 'S355J2', null),
      ('Čelik', 7.85, 'C45', null),
      ('Čelik', 7.85, '42CrMo4', null),
      ('Čelik', 7.85, '16MnCr5', null),
      ('Čelik', 7.85, '34CrNiMo6', null),
      ('Čelik', 7.85, '11SMnPb30', null),
      ('Nehrđajući čelik (inox)', 7.90, '1.4301 (AISI 304)', null),
      ('Nehrđajući čelik (inox)', 7.90, '1.4307 (AISI 304L)', null),
      ('Nehrđajući čelik (inox)', 7.90, '1.4305 (AISI 303)', null),
      ('Nehrđajući čelik (inox)', 7.90, '1.4404 (AISI 316L)', 8.00),
      ('Nehrđajući čelik (inox)', 7.90, '1.4571 (AISI 316Ti)', 8.00),
      ('Aluminij', 2.70, 'EN AW-6082 (AlSi1MgMn)', null),
      ('Aluminij', 2.70, 'EN AW-6060 (AlMgSi)', null),
      ('Aluminij', 2.70, 'EN AW-6061 (AlMg1SiCu)', null),
      ('Aluminij', 2.70, 'EN AW-5754 (AlMg3)', 2.66),
      ('Aluminij', 2.70, 'EN AW-5083 (AlMg4,5Mn)', 2.66),
      ('Aluminij', 2.70, 'EN AW-7075 (AlZn5,5MgCu)', 2.81),
      ('Aluminij', 2.70, 'EN AW-2007 (AlCuMgPb)', 2.85),
      ('Mesing', 8.47, 'CW614N (CuZn39Pb3)', null),
      ('Mesing', 8.47, 'CW617N (CuZn40Pb2)', null),
      ('Mesing', 8.47, 'CW508L (CuZn37)', 8.44),
      ('Bakar', 8.93, 'CW004A (Cu-ETP)', null),
      ('Bronza', 8.80, 'CW453K (CuSn8)', null),
      ('Titan', 4.51, 'Grade 2', null),
      ('Titan', 4.51, 'Grade 5 (Ti6Al4V)', 4.43),
      ('Liveno željezo', 7.20, 'EN-GJL-250 (SL 25)', null),
      ('Liveno željezo', 7.20, 'EN-GJS-400-15 (NL 40)', 7.10),
      ('Plastika', null, 'POM-C', 1.41),
      ('Plastika', null, 'PA6', 1.14),
      ('Plastika', null, 'PE-HD', 0.95),
      ('Plastika', null, 'PTFE', 2.20),
      ('Plastika', null, 'PEEK', 1.31)
    ) as t (group_name, group_density, designation, density)
  loop
    select g.id into v_group_id
    from public.material_groups g
    where g.organization_id = p_org_id
      and lower(g.name) = lower(v_row.group_name)
      and g.archived_at is null;
    if v_group_id is null then
      insert into public.material_groups (organization_id, name, density_kg_dm3)
      values (p_org_id, v_row.group_name, v_row.group_density)
      returning id into v_group_id;
    end if;

    if not exists (
      select 1 from public.materials m
      where m.organization_id = p_org_id
        and lower(m.designation) = lower(v_row.designation)
        and m.archived_at is null
    ) then
      insert into public.materials (organization_id, group_id, designation, density_kg_dm3)
      values (p_org_id, v_group_id, v_row.designation, v_row.density);
    end if;
  end loop;
end;
$$;

revoke execute on function private.seed_default_materials(uuid) from public;

create function private.seed_organization_materials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_default_materials(new.id);
  return null;
end;
$$;

create trigger organizations_seed_materials after insert on public.organizations
  for each row execute function private.seed_organization_materials();

select private.seed_default_materials(o.id) from public.organizations o;

-- ---------------------------------------------------------------------------
-- Revisions: material, blank shapes, optional label
-- ---------------------------------------------------------------------------
-- Historic revisions are rewritten here once; the guard would refuse that.
alter table public.product_revisions disable trigger product_revisions_guard;

alter table public.product_revisions
  add column material_id uuid,
  add constraint product_revisions_material_fkey foreign key (organization_id, material_id)
    references public.materials (organization_id, id) on delete restrict;
create index product_revisions_material_idx on public.product_revisions (organization_id, material_id);

-- Existing text grades: match a designation ("C45" → "C45", "1.4301" → "1.4301 (AISI 304)"),
-- otherwise create it in group "Ostalo" (no density).
do $$
declare
  v_rev record;
  v_material_id uuid;
  v_group_id uuid;
begin
  for v_rev in
    select r.id, r.organization_id, btrim(r.material_grade) as grade
    from public.product_revisions r
    where r.material_grade is not null
  loop
    select m.id into v_material_id
    from public.materials m
    where m.organization_id = v_rev.organization_id
      and m.archived_at is null
      and (lower(m.designation) = lower(v_rev.grade)
        or lower(m.designation) like lower(v_rev.grade) || ' (%')
    order by length(m.designation)
    limit 1;

    if v_material_id is null then
      select g.id into v_group_id from public.material_groups g
      where g.organization_id = v_rev.organization_id and g.name = 'Ostalo' and g.archived_at is null;
      if v_group_id is null then
        insert into public.material_groups (organization_id, name)
        values (v_rev.organization_id, 'Ostalo')
        returning id into v_group_id;
      end if;
      insert into public.materials (organization_id, group_id, designation)
      values (v_rev.organization_id, v_group_id, v_rev.grade)
      returning id into v_material_id;
    end if;

    update public.product_revisions set material_id = v_material_id where id = v_rev.id;
  end loop;
end;
$$;

-- Blank: one shape drives the dimensions; the length of the raw piece is
-- cut_length_mm. Round: Ø; tube: outer Ø + wall; rectangular: width × thickness;
-- hexagon: across flats (stored in blank_diameter_mm); other: no dimensions.
alter table public.product_revisions drop constraint product_revisions_blank_check;
alter table public.product_revisions drop constraint product_revisions_blank_geometry_check;

update public.product_revisions set blank_geometry = 'rectangular' where blank_geometry = 'prismatic';
update public.product_revisions
  set cut_length_mm = blank_height_mm
  where cut_length_mm is null and blank_height_mm is not null;
update public.product_revisions set blank_width_mm = null
  where blank_geometry = 'round' and blank_width_mm is not null;

alter table public.product_revisions
  drop column material_grade,
  drop column material_shape_id,
  drop column material_shape_kind,
  drop column blank_height_mm;

alter table public.product_revisions
  add constraint product_revisions_blank_geometry_check
    check (blank_geometry in ('round', 'tube', 'rectangular', 'hexagon', 'other')),
  add constraint product_revisions_blank_check check (
    case coalesce(blank_geometry, 'other')
      when 'other' then num_nonnulls(blank_diameter_mm, blank_width_mm, blank_thickness_mm) = 0
      when 'round' then blank_width_mm is null and blank_thickness_mm is null
      when 'hexagon' then blank_width_mm is null and blank_thickness_mm is null
      when 'tube' then blank_width_mm is null
        and (blank_diameter_mm is null or blank_thickness_mm is null
          or blank_thickness_mm * 2 < blank_diameter_mm)
      when 'rectangular' then blank_diameter_mm is null
    end
  );

-- Revision labels are optional (only when drawings change); new revisions need one.
alter table public.product_revisions alter column revision drop not null;

alter table public.product_revisions enable trigger product_revisions_guard;

-- ---------------------------------------------------------------------------
-- Inspection planning
-- ---------------------------------------------------------------------------
alter table public.operation_types
  add column is_inspection boolean not null default false,
  add constraint operation_types_inspection_check check (not (is_inspection and is_external));

-- between: after every operation and at the end; final: only at the end;
-- none: inspections only where added by hand.
alter table public.products
  add column inspection_plan text not null default 'none'
    check (inspection_plan in ('between', 'final', 'none'));

-- Rows inserted and positioned by private.normalize_routing().
alter table public.product_operations
  add column auto_inspection boolean not null default false;

alter table public.organizations add constraint organizations_inspection_mode_check
  check (coalesce(settings ->> 'inspection_mode', 'manual') in ('automatic', 'manual', 'custom'));

-- Attachments cannot point at generated inspections (they are re-created).
create or replace function private.check_product_attachment()
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
    where o.id = new.operation_id and o.revision_id = new.revision_id and not o.auto_inspection
  ) then
    raise exception 'operation must belong to the same revision' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Orders the routing of a revision: manual operations keep their relative
-- order (positions 1..n), generated inspections are placed according to the
-- product's inspection_plan, archived operations follow at the end.
-- p_order: new order of the manual operations (default: current order).
create function private.normalize_routing(p_revision_id uuid, p_order uuid[] default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_plan text;
  v_type_id uuid;
  v_ops uuid[];
  v_inspection boolean[];
  v_auto uuid[];
  v_auto_used integer := 0;
  v_n integer;
  v_pos integer := 0;
  v_id uuid;
begin
  select r.organization_id, p.inspection_plan into v_org_id, v_plan
  from public.product_revisions r
  join public.products p on p.id = r.product_id and p.organization_id = r.organization_id
  where r.id = p_revision_id;

  select coalesce(array_agg(o.id order by coalesce(x.position, 0), o.sequence), '{}'),
         coalesce(array_agg(t.is_inspection order by coalesce(x.position, 0), o.sequence), '{}')
  into v_ops, v_inspection
  from public.product_operations o
  join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
  left join unnest(p_order) with ordinality as x (id, position) on x.id = o.id
  where o.revision_id = p_revision_id and o.archived_at is null and not o.auto_inspection;

  select coalesce(array_agg(o.id order by o.sequence), '{}') into v_auto
  from public.product_operations o
  where o.revision_id = p_revision_id and o.auto_inspection;

  v_n := coalesce(array_length(v_ops, 1), 0);
  if v_plan <> 'none' and v_n > 0 then
    select t.id into v_type_id
    from public.operation_types t
    where t.organization_id = v_org_id and t.is_inspection and t.archived_at is null
    order by t.created_at
    limit 1;
    if v_type_id is null then
      raise exception 'inspection_type_missing' using errcode = '23514',
        hint = 'Mark an operation type as inspection';
    end if;
  end if;

  set constraints public.product_operations_sequence_key deferred;

  for i in 1 .. v_n loop
    v_pos := v_pos + 1;
    update public.product_operations set sequence = v_pos
    where id = v_ops[i] and sequence <> v_pos;

    if v_plan <> 'none' and not v_inspection[i] and (
      i = v_n or (v_plan = 'between' and not v_inspection[i + 1])
    ) then
      v_pos := v_pos + 1;
      v_auto_used := v_auto_used + 1;
      if v_auto_used <= coalesce(array_length(v_auto, 1), 0) then
        update public.product_operations
        set sequence = v_pos, operation_type_id = v_type_id
        where id = v_auto[v_auto_used]
          and (sequence <> v_pos or operation_type_id <> v_type_id);
      else
        insert into public.product_operations (
          organization_id, revision_id, sequence, operation_type_id, auto_inspection
        ) values (v_org_id, p_revision_id, v_pos, v_type_id, true);
      end if;
    end if;
  end loop;

  delete from public.product_operations
  where id = any (v_auto[v_auto_used + 1 :]);

  for v_id in
    select o.id from public.product_operations o
    where o.revision_id = p_revision_id and o.archived_at is not null
    order by o.sequence
  loop
    v_pos := v_pos + 1;
    update public.product_operations set sequence = v_pos where id = v_id and sequence <> v_pos;
  end loop;

  set constraints public.product_operations_sequence_key immediate;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs (recreated for the new columns) — SECURITY INVOKER
-- ---------------------------------------------------------------------------
create or replace function private.insert_product_revision(
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
    material_id, blank_geometry, blank_diameter_mm, blank_width_mm, blank_thickness_mm,
    cut_length_mm, kerf_mm, net_mass_kg
  ) values (
    p_org_id, p_product_id, nullif(btrim(p_revision ->> 'revision'), ''), true,
    p_revision ->> 'drawing_number', p_revision ->> 'description',
    (p_revision ->> 'material_id')::uuid, p_revision ->> 'blank_geometry',
    (p_revision ->> 'blank_diameter_mm')::numeric, (p_revision ->> 'blank_width_mm')::numeric,
    (p_revision ->> 'blank_thickness_mm')::numeric, (p_revision ->> 'cut_length_mm')::numeric,
    (p_revision ->> 'kerf_mm')::numeric, (p_revision ->> 'net_mass_kg')::numeric
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Copies manual operations (and optionally attachments); inspections are
-- generated again by normalize_routing.
create or replace function private.copy_revision_content(
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
    where o.revision_id = p_source_revision_id and o.archived_at is null and not o.auto_inspection
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

  if p_with_attachments then
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
  end if;

  perform private.normalize_routing(p_target_revision_id);
end;
$$;

create or replace function public.create_product(p_org_id uuid, p_product jsonb, p_revision jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_products_manage(p_org_id);

  insert into public.products (
    organization_id, part_number, name, customer_id, product_type_id, unit, inspection_plan
  ) values (
    p_org_id, btrim(p_product ->> 'part_number'), btrim(p_product ->> 'name'),
    (p_product ->> 'customer_id')::uuid, (p_product ->> 'product_type_id')::uuid,
    coalesce(p_product ->> 'unit', 'pcs'), coalesce(p_product ->> 'inspection_plan', 'none')
  )
  returning id into v_id;

  perform private.insert_product_revision(p_org_id, v_id, p_revision);
  return v_id;
end;
$$;

create or replace function public.update_product(p_product_id uuid, p_product jsonb, p_revision jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid := private.lock_product(p_product_id);
  v_revision_id uuid;
begin
  update public.products set
    part_number = btrim(p_product ->> 'part_number'),
    name = btrim(p_product ->> 'name'),
    customer_id = (p_product ->> 'customer_id')::uuid,
    product_type_id = (p_product ->> 'product_type_id')::uuid,
    unit = coalesce(p_product ->> 'unit', 'pcs'),
    inspection_plan = coalesce(p_product ->> 'inspection_plan', inspection_plan)
  where id = p_product_id and organization_id = v_org_id;

  update public.product_revisions set
    drawing_number = p_revision ->> 'drawing_number',
    description = p_revision ->> 'description',
    material_id = (p_revision ->> 'material_id')::uuid,
    blank_geometry = p_revision ->> 'blank_geometry',
    blank_diameter_mm = (p_revision ->> 'blank_diameter_mm')::numeric,
    blank_width_mm = (p_revision ->> 'blank_width_mm')::numeric,
    blank_thickness_mm = (p_revision ->> 'blank_thickness_mm')::numeric,
    cut_length_mm = (p_revision ->> 'cut_length_mm')::numeric,
    kerf_mm = (p_revision ->> 'kerf_mm')::numeric,
    net_mass_kg = (p_revision ->> 'net_mass_kg')::numeric
  where product_id = p_product_id and organization_id = v_org_id and is_current
  returning id into v_revision_id;

  if v_revision_id is null then
    raise exception 'current revision not found' using errcode = 'P0002';
  end if;
  perform private.normalize_routing(v_revision_id);
  return p_product_id;
end;
$$;

create or replace function public.create_product_revision(
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
  if nullif(btrim(p_revision), '') is null then
    raise exception 'a new revision needs a label' using errcode = '22023';
  end if;

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

create or replace function public.copy_product(
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

  insert into public.products (
    organization_id, part_number, name, customer_id, product_type_id, unit, inspection_plan
  ) values (
    v_source.organization_id, btrim(p_part_number), btrim(p_name), v_product.customer_id,
    v_product.product_type_id, v_product.unit, v_product.inspection_plan
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
    jsonb_build_object('part_number', btrim(p_part_number), 'revision', nullif(btrim(p_revision), ''))
  );
  return v_new_product_id;
end;
$$;

-- Operation of a revision (create: appended at the end). p_operation:
-- {operation_type_id, description, machine_type_id, machine_id,
--  external_company, setup_time_min, cycle_time_s, notes}
create function public.save_product_operation(
  p_revision_id uuid,
  p_operation_id uuid,
  p_operation jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_id uuid := p_operation_id;
begin
  select r.organization_id into v_org_id from public.product_revisions r where r.id = p_revision_id;
  if v_org_id is null then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;
  perform private.require_products_manage(v_org_id);

  if v_id is null then
    insert into public.product_operations (
      organization_id, revision_id, sequence, operation_type_id, description, machine_type_id,
      machine_id, external_company, setup_time_min, cycle_time_s, notes
    ) values (
      v_org_id, p_revision_id,
      (select coalesce(max(o.sequence), 0) + 1 from public.product_operations o
        where o.revision_id = p_revision_id),
      (p_operation ->> 'operation_type_id')::uuid, p_operation ->> 'description',
      (p_operation ->> 'machine_type_id')::uuid, (p_operation ->> 'machine_id')::uuid,
      p_operation ->> 'external_company', (p_operation ->> 'setup_time_min')::numeric,
      (p_operation ->> 'cycle_time_s')::numeric, p_operation ->> 'notes'
    )
    returning id into v_id;
  else
    update public.product_operations set
      operation_type_id = (p_operation ->> 'operation_type_id')::uuid,
      description = p_operation ->> 'description',
      machine_type_id = (p_operation ->> 'machine_type_id')::uuid,
      machine_id = (p_operation ->> 'machine_id')::uuid,
      external_company = p_operation ->> 'external_company',
      setup_time_min = (p_operation ->> 'setup_time_min')::numeric,
      cycle_time_s = (p_operation ->> 'cycle_time_s')::numeric,
      notes = p_operation ->> 'notes'
    where id = v_id and revision_id = p_revision_id and archived_at is null and not auto_inspection;
    if not found then
      raise exception 'operation not found' using errcode = 'P0002';
    end if;
  end if;

  perform private.normalize_routing(p_revision_id);
  return v_id;
end;
$$;

create function public.set_product_operation_archived(p_operation_id uuid, p_archived boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_op public.product_operations;
begin
  select * into v_op from public.product_operations o
  where o.id = p_operation_id and not o.auto_inspection;
  if v_op.id is null then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  perform private.require_products_manage(v_op.organization_id);

  if p_archived then
    -- Restoring puts the operation back at the end.
    update public.product_operations set archived_at = now() where id = v_op.id;
  else
    update public.product_operations set
      archived_at = null,
      sequence = (select max(o.sequence) + 1 from public.product_operations o
        where o.revision_id = v_op.revision_id)
    where id = v_op.id;
  end if;
  perform private.normalize_routing(v_op.revision_id);
end;
$$;

-- New order of the manual, non-archived operations (all of them, exactly once).
create function public.reorder_product_operations(p_revision_id uuid, p_operation_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_product_id uuid;
  v_current uuid[];
begin
  select r.organization_id, r.product_id into v_org_id, v_product_id
  from public.product_revisions r where r.id = p_revision_id;
  if v_org_id is null then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;
  perform private.require_products_manage(v_org_id);

  select coalesce(array_agg(o.id order by o.id), '{}') into v_current
  from public.product_operations o
  where o.revision_id = p_revision_id and o.archived_at is null and not o.auto_inspection;
  if v_current is distinct from (
    select coalesce(array_agg(x order by x), '{}') from unnest(p_operation_ids) as x
  ) then
    raise exception 'operation list does not match the routing' using errcode = '22023';
  end if;

  perform private.normalize_routing(p_revision_id, p_operation_ids);

  perform public.write_audit(
    v_org_id, 'products.routing_reordered', 'products', v_product_id::text, null,
    jsonb_build_object('revision_id', p_revision_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- List view: product + current revision + customer + material
-- ---------------------------------------------------------------------------
create view public.product_directory
with (security_invoker = true)
as
select
  p.id,
  p.organization_id,
  p.part_number,
  p.name,
  p.customer_id,
  c.name as customer_name,
  p.product_type_id,
  t.name as product_type_name,
  p.unit,
  p.inspection_plan,
  p.created_at,
  p.archived_at,
  r.id as revision_id,
  r.revision,
  r.drawing_number,
  r.material_id,
  m.designation as material_designation,
  g.name as material_group_name,
  (
    select count(*)::integer from public.product_operations o
    where o.revision_id = r.id and o.archived_at is null
  ) as operation_count
from public.products p
left join public.product_revisions r on r.product_id = p.id and r.is_current
left join public.customers c on c.id = p.customer_id and c.organization_id = p.organization_id
left join public.catalog_items t on t.id = p.product_type_id and t.organization_id = p.organization_id
left join public.materials m on m.id = r.material_id and m.organization_id = r.organization_id
left join public.material_groups g on g.id = m.group_id and g.organization_id = m.organization_id;

comment on view public.product_directory is
  'Products with current revision, customer and material for list screens (security_invoker).';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on public.customers, public.material_groups, public.materials, public.product_directory
  from anon, authenticated;
grant select on public.customers, public.material_groups, public.materials, public.product_directory
  to authenticated;

grant insert (organization_id, name, tax_id, address, city, country, contact_person, phone, email, notes),
  update (name, tax_id, address, city, country, contact_person, phone, email, notes, archived_at)
  on public.customers to authenticated;
grant insert (organization_id, name, density_kg_dm3), update (name, density_kg_dm3, archived_at)
  on public.material_groups to authenticated;
grant insert (organization_id, group_id, designation, density_kg_dm3),
  update (group_id, designation, density_kg_dm3, archived_at)
  on public.materials to authenticated;

grant insert (customer_id, inspection_plan), update (customer_id, inspection_plan)
  on public.products to authenticated;
grant insert (material_id), update (material_id) on public.product_revisions to authenticated;
grant insert (is_inspection), update (is_inspection) on public.operation_types to authenticated;
grant insert (auto_inspection), delete on public.product_operations to authenticated;

revoke execute on function private.normalize_routing(uuid, uuid[]) from public;
grant execute on function private.normalize_routing(uuid, uuid[]) to authenticated;

revoke execute on function public.save_product_operation(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.set_product_operation_archived(uuid, boolean) from public, anon;
revoke execute on function public.reorder_product_operations(uuid, uuid[]) from public, anon;
grant execute on function public.save_product_operation(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_product_operation_archived(uuid, boolean) to authenticated;
grant execute on function public.reorder_product_operations(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.material_groups enable row level security;
alter table public.materials enable row level security;

create policy customers_select on public.customers
  for select to authenticated
  using (private.has_permission(organization_id, 'customers.read')
    or private.has_permission(organization_id, 'products.read'));
create policy customers_insert on public.customers
  for insert to authenticated
  with check (private.has_permission(organization_id, 'customers.manage'));
create policy customers_update on public.customers
  for update to authenticated
  using (private.has_permission(organization_id, 'customers.manage'))
  with check (private.has_permission(organization_id, 'customers.manage'));

-- Material names and densities are shown wherever products are.
create policy material_groups_select on public.material_groups
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));
create policy material_groups_insert on public.material_groups
  for insert to authenticated
  with check (private.has_permission(organization_id, 'products.manage'));
create policy material_groups_update on public.material_groups
  for update to authenticated
  using (private.has_permission(organization_id, 'products.manage'))
  with check (private.has_permission(organization_id, 'products.manage'));

create policy materials_select on public.materials
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));
create policy materials_insert on public.materials
  for insert to authenticated
  with check (private.has_permission(organization_id, 'products.manage'));
create policy materials_update on public.materials
  for update to authenticated
  using (private.has_permission(organization_id, 'products.manage'))
  with check (private.has_permission(organization_id, 'products.manage'));

-- Only generated inspections are ever deleted (by normalize_routing).
create policy product_operations_delete on public.product_operations
  for delete to authenticated
  using (auto_inspection and private.has_permission(organization_id, 'products.manage'));
