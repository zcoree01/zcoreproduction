-- Inventory part D: finished goods and delivery notes (D-034).
--   * finished_goods.read / finished_goods.manage (module inventory). The
--     head of production receives good pieces of an order into finished goods
--     (also partly, at most what the last operation reported good and was not
--     received yet) and ships them to the customer with a delivery note.
--   * finished_goods_movements: ledger per order (receipt +, shipment −,
--     cancelled shipment +); stock = sum, never updated.
--   * delivery_notes / delivery_note_lines: number from a format in the
--     organization settings (default {KUPAC2}-{MJESEC}{GODINA}-{BROJ}, the
--     sequence restarts only with a new year), customer position per line
--     (from the order, editable), snapshot of the order data for printing.
--   * delivery_note_templates: layouts per organization (title, texts,
--     columns, signatures, logo); one is the default, customers may have
--     their own (customers.delivery_note_template_id). org.settings.manage.
--   * production_orders.customer_position: position / item number the
--     customer uses for the order.
--   * Organization logo in the private bucket organization-files
--     (settings.branding.logo_path).

insert into public.permissions (key, module_key, description, default_roles) values
  ('finished_goods.read', 'inventory', 'View finished goods stock and delivery notes',
    '{admin,director,head_of_production,warehouse}'),
  ('finished_goods.manage', 'inventory',
    'Receive good pieces into finished goods and issue delivery notes',
    '{admin,director,head_of_production}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.key in ('finished_goods.read', 'finished_goods.manage')
on conflict do nothing;

alter table public.production_orders
  add column customer_position text
    check (customer_position is null or length(btrim(customer_position)) between 1 and 60);
grant insert (customer_position), update (customer_position)
  on public.production_orders to authenticated;

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
create table public.delivery_note_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 80),
  is_default boolean not null default false,
  -- {title, header_text, footer_text, show_logo, columns: [{key, label}],
  --  signatures: [label]} — validated by deliveryTemplateLayoutSchema.
  layout jsonb not null check (jsonb_typeof(layout) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id)
);

create unique index delivery_note_templates_default_key
  on public.delivery_note_templates (organization_id) where is_default and archived_at is null;
create unique index delivery_note_templates_name_key
  on public.delivery_note_templates (organization_id, lower(btrim(name)))
  where archived_at is null;

create trigger delivery_note_templates_set_updated_at before update on public.delivery_note_templates
  for each row execute function private.set_updated_at();
create trigger delivery_note_templates_audit after insert or update on public.delivery_note_templates
  for each row execute function private.audit_row_change();

create function private.seed_default_delivery_template(p_org_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.delivery_note_templates (organization_id, name, is_default, layout)
  select p_org_id, 'Standardna', true, jsonb_build_object(
    'title', 'Otpremnica',
    'header_text', '',
    'footer_text', '',
    'show_logo', true,
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'position', 'label', 'Poz.'),
      jsonb_build_object('key', 'customer_position', 'label', 'Pozicija kupca'),
      jsonb_build_object('key', 'order', 'label', 'Broj naloga'),
      jsonb_build_object('key', 'drawing', 'label', 'Broj crteža'),
      jsonb_build_object('key', 'product', 'label', 'Naziv'),
      jsonb_build_object('key', 'quantity', 'label', 'Količina')
    ),
    'signatures', jsonb_build_array('Izdao', 'Preuzeo')
  )
  where not exists (
    select 1 from public.delivery_note_templates t where t.organization_id = p_org_id
  )
$$;

revoke execute on function private.seed_default_delivery_template(uuid) from public;

create function private.seed_organization_delivery_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_default_delivery_template(new.id);
  return null;
end;
$$;

create trigger organizations_seed_delivery_template after insert on public.organizations
  for each row execute function private.seed_organization_delivery_template();

select private.seed_default_delivery_template(o.id) from public.organizations o;

alter table public.customers
  add column delivery_note_template_id uuid,
  add constraint customers_delivery_template_fkey foreign key (organization_id, delivery_note_template_id)
    references public.delivery_note_templates (organization_id, id) on delete restrict;
grant insert (delivery_note_template_id), update (delivery_note_template_id)
  on public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- Delivery notes
-- ---------------------------------------------------------------------------
create table public.delivery_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  number text not null check (length(number) between 1 and 100),
  note_year integer not null,
  note_sequence integer not null check (note_sequence > 0),
  customer_id uuid not null,
  template_id uuid not null,
  issued_on date not null,
  status text not null default 'issued' check (status in ('issued', 'cancelled')),
  notes text check (length(notes) <= 2000),
  idempotency_key uuid not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text check (length(btrim(cancel_reason)) between 1 and 500),
  unique (organization_id, id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete restrict,
  foreign key (organization_id, template_id)
    references public.delivery_note_templates (organization_id, id) on delete restrict,
  check ((status = 'cancelled') = (cancel_reason is not null))
);

create index delivery_notes_customer_idx
  on public.delivery_notes (organization_id, customer_id, issued_on desc);

create table public.delivery_note_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  delivery_note_id uuid not null,
  line_no integer not null check (line_no between 1 and 500),
  order_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  customer_position text check (length(btrim(customer_position)) between 1 and 60),
  -- Snapshot for printing (the order may change later).
  order_number text not null,
  part_number text not null,
  product_name text not null,
  drawing_number text,
  revision text,
  unit text not null,
  unique (delivery_note_id, line_no),
  foreign key (organization_id, delivery_note_id)
    references public.delivery_notes (organization_id, id) on delete restrict,
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict
);

create index delivery_note_lines_order_idx on public.delivery_note_lines (organization_id, order_id);

-- ---------------------------------------------------------------------------
-- Finished goods ledger
-- ---------------------------------------------------------------------------
create table public.finished_goods_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  order_id uuid not null,
  kind text not null check (kind in ('receipt', 'shipment', 'shipment_cancelled')),
  -- Signed, in the order unit (good pieces).
  quantity numeric(14, 3) not null check (quantity <> 0),
  delivery_note_id uuid,
  idempotency_key text not null check (length(idempotency_key) between 1 and 100),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, delivery_note_id)
    references public.delivery_notes (organization_id, id) on delete restrict,
  check ((kind = 'receipt') = (delivery_note_id is null)),
  check (sign(quantity) = case kind when 'shipment' then -1 else 1 end)
);

create index finished_goods_movements_order_idx
  on public.finished_goods_movements (organization_id, order_id);

create trigger finished_goods_movements_append_only before update on public.finished_goods_movements
  for each row execute function private.prevent_stock_movement_update();

-- Per order: received, shipped (net of cancellations) and on hand.
create view public.finished_goods_stock with (security_invoker = true) as
select
  m.organization_id,
  m.order_id,
  coalesce(sum(m.quantity) filter (where m.kind = 'receipt'), 0) as received,
  coalesce(-sum(m.quantity) filter (where m.kind in ('shipment', 'shipment_cancelled')), 0)
    as shipped,
  sum(m.quantity) as on_hand
from public.finished_goods_movements m
group by m.organization_id, m.order_id;

-- ---------------------------------------------------------------------------
-- Delivery note numbers (mirrored by formatDeliveryNumber)
-- ---------------------------------------------------------------------------
-- {KUPAC} customer number, {KUPAC2} with at least 2 digits, {MJESEC} month (2
-- digits), {GODINA} year (2 digits), {GODINA4} year, {BROJ} yearly sequence
-- with at least p_digits digits.
create function private.valid_delivery_number_template(p_template text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select length(p_template) between 1 and 60
    and position('{BROJ}' in p_template) > 0
    and regexp_replace(p_template, '\{(KUPAC2|KUPAC|MJESEC|GODINA4|GODINA|BROJ)\}', '', 'g')
      ~ '^[A-Za-z0-9./_ -]*$'
$$;

create function private.format_delivery_number(
  p_template text,
  p_digits integer,
  p_customer_number integer,
  p_date date,
  p_sequence bigint
)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(replace(p_template,
    '{KUPAC2}', lpad(p_customer_number::text, greatest(2, length(p_customer_number::text)), '0')),
    '{KUPAC}', p_customer_number::text),
    '{MJESEC}', to_char(p_date, 'MM')),
    '{GODINA4}', to_char(p_date, 'YYYY')),
    '{GODINA}', to_char(p_date, 'YY')),
    '{BROJ}', lpad(p_sequence::text, greatest(p_digits, length(p_sequence::text)), '0'))
$$;

alter table public.organizations add constraint organizations_delivery_settings_check
  check (
    (settings -> 'delivery_note_number_template' is null
      or (jsonb_typeof(settings -> 'delivery_note_number_template') = 'string'
        and private.valid_delivery_number_template(settings ->> 'delivery_note_number_template')))
    and (settings -> 'delivery_note_number_digits' is null
      or (jsonb_typeof(settings -> 'delivery_note_number_digits') = 'number'
        and (settings ->> 'delivery_note_number_digits') in ('1', '2', '3', '4', '5', '6')))
  );

create function private.assert_finished_access(p_org_id uuid, p_permission text)
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

-- ---------------------------------------------------------------------------
-- Receipt of good pieces
-- ---------------------------------------------------------------------------
create function public.receive_finished_goods(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_order_id uuid,
  p_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_received numeric;
begin
  perform private.assert_finished_access(p_org_id, 'finished_goods.manage');
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.finished_goods_movements m
    where m.organization_id = p_org_id and m.idempotency_key = p_idempotency_key::text
  ) then
    return;
  end if;

  select * into v_order from public.production_orders o
  where o.id = p_order_id and o.organization_id = p_org_id
  for update;
  if v_order.id is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_order.status in ('draft', 'cancelled', 'archived') then
    raise exception 'order_not_open' using errcode = '55000';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity <> round(p_quantity, 3)
    or (v_order.unit in ('pcs', 'set') and p_quantity <> trunc(p_quantity)) then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  select coalesce(sum(m.quantity), 0) into v_received
  from public.finished_goods_movements m
  where m.order_id = p_order_id and m.kind = 'receipt';
  -- Only good pieces of the last operation, each received once.
  if v_received + p_quantity > private.order_good_quantity(p_order_id) then
    raise exception 'more_than_good' using errcode = '23514';
  end if;

  insert into public.finished_goods_movements (
    organization_id, order_id, kind, quantity, idempotency_key
  ) values (p_org_id, p_order_id, 'receipt', p_quantity, p_idempotency_key::text);

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'finished_goods.received', 'production_orders', p_order_id::text,
    jsonb_build_object('quantity', p_quantity));
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery note (issued at once; cancelling returns the pieces to stock)
-- ---------------------------------------------------------------------------
-- p_note: {customer_id, template_id (null: the customer's or the default),
--   issued_on, notes}; p_lines: [{order_id, quantity, customer_position}].
create function public.issue_delivery_note(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_note jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_customer public.customers;
  v_template uuid;
  v_date date := coalesce((p_note ->> 'issued_on')::date, current_date);
  v_settings jsonb;
  v_sequence bigint;
  v_line jsonb;
  v_no integer;
  v_order public.production_orders;
  v_product public.products;
  v_revision public.product_revisions;
  v_on_hand numeric;
  v_quantity numeric;
begin
  perform private.assert_finished_access(p_org_id, 'finished_goods.manage');
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select d.id into v_id from public.delivery_notes d
  where d.organization_id = p_org_id and d.idempotency_key = p_idempotency_key;
  if found then return v_id; end if;

  select * into v_customer from public.customers c
  where c.id = (p_note ->> 'customer_id')::uuid and c.organization_id = p_org_id;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  select t.id into v_template from public.delivery_note_templates t
  where t.organization_id = p_org_id and t.archived_at is null
    and t.id = coalesce((p_note ->> 'template_id')::uuid, v_customer.delivery_note_template_id,
      (select d.id from public.delivery_note_templates d
       where d.organization_id = p_org_id and d.is_default and d.archived_at is null));
  if v_template is null then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  -- Serializes notes of the organization (numbers and stock).
  perform pg_advisory_xact_lock(hashtextextended('delivery:' || p_org_id::text, 0));
  select o.settings into v_settings from public.organizations o where o.id = p_org_id;
  v_sequence := private.next_counter(p_org_id, 'delivery_note:' || to_char(v_date, 'YYYY'));

  insert into public.delivery_notes (
    organization_id, number, note_year, note_sequence, customer_id, template_id, issued_on,
    notes, idempotency_key
  ) values (
    p_org_id,
    private.format_delivery_number(
      coalesce(v_settings ->> 'delivery_note_number_template', '{KUPAC2}-{MJESEC}{GODINA}-{BROJ}'),
      coalesce((v_settings ->> 'delivery_note_number_digits')::integer, 1),
      v_customer.customer_number, v_date, v_sequence),
    extract(year from v_date)::integer, v_sequence, v_customer.id, v_template, v_date,
    nullif(btrim(p_note ->> 'notes'), ''), p_idempotency_key
  )
  returning id into v_id;

  for v_line, v_no in select e.value, e.ordinality from jsonb_array_elements(p_lines) with ordinality e loop
    select * into v_order from public.production_orders o
    where o.id = (v_line ->> 'order_id')::uuid and o.organization_id = p_org_id
    for update;
    if v_order.id is null or v_order.customer_id <> v_customer.id then
      raise exception 'order_not_found' using errcode = 'P0002';
    end if;
    v_quantity := (v_line ->> 'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 or v_quantity <> round(v_quantity, 3)
      or (v_order.unit in ('pcs', 'set') and v_quantity <> trunc(v_quantity)) then
      raise exception 'invalid_line' using errcode = '22023';
    end if;
    select coalesce(sum(m.quantity), 0) into v_on_hand
    from public.finished_goods_movements m where m.order_id = v_order.id;
    if v_on_hand < v_quantity then
      raise exception 'not_in_stock' using errcode = '23514';
    end if;
    select * into v_product from public.products p where p.id = v_order.product_id;
    select * into v_revision from public.product_revisions r where r.id = v_order.revision_id;

    insert into public.delivery_note_lines (
      organization_id, delivery_note_id, line_no, order_id, quantity, customer_position,
      order_number, part_number, product_name, drawing_number, revision, unit
    ) values (
      p_org_id, v_id, v_no, v_order.id, v_quantity,
      coalesce(nullif(btrim(v_line ->> 'customer_position'), ''), v_order.customer_position),
      v_order.order_number, v_product.part_number, v_product.name, v_revision.drawing_number,
      v_revision.revision, v_order.unit
    );
    insert into public.finished_goods_movements (
      organization_id, order_id, kind, quantity, delivery_note_id, idempotency_key
    ) values (
      p_org_id, v_order.id, 'shipment', -v_quantity, v_id, p_idempotency_key::text || ':' || v_no
    );
  end loop;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'delivery_note.issued', 'delivery_notes', v_id::text,
    jsonb_build_object('customer_id', v_customer.id, 'lines', jsonb_array_length(p_lines)));
  return v_id;
end;
$$;

create function public.cancel_delivery_note(p_note_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note public.delivery_notes;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select * into v_note from public.delivery_notes d where d.id = p_note_id for update;
  if v_note.id is null or not private.has_permission(v_note.organization_id, 'finished_goods.read') then
    raise exception 'delivery_note_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_finished_access(v_note.organization_id, 'finished_goods.manage');
  if v_note.status <> 'issued' then
    raise exception 'already_cancelled' using errcode = '55000';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  insert into public.finished_goods_movements (
    organization_id, order_id, kind, quantity, delivery_note_id, idempotency_key
  )
  select v_note.organization_id, l.order_id, 'shipment_cancelled', l.quantity, v_note.id,
    'cancel:' || v_note.id::text || ':' || l.line_no
  from public.delivery_note_lines l where l.delivery_note_id = v_note.id;

  update public.delivery_notes
    set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
      cancel_reason = v_reason
    where id = p_note_id;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (v_note.organization_id, auth.uid(), 'delivery_note.cancelled', 'delivery_notes',
    p_note_id::text, jsonb_build_object('reason', v_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: organization logo (and later other organization files)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organization-files', 'organization-files', false, 2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy organization_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'organization-files'
    and private.storage_org_id(name) in (select private.user_org_ids())
  );
create policy organization_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'organization-files'
    and private.has_permission(private.storage_org_id(name), 'org.settings.manage')
  );

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
revoke all on public.delivery_note_templates, public.delivery_notes, public.delivery_note_lines,
  public.finished_goods_movements, public.finished_goods_stock
  from anon, authenticated;
grant select on public.delivery_note_templates, public.delivery_notes, public.delivery_note_lines,
  public.finished_goods_movements, public.finished_goods_stock
  to authenticated;
grant insert (organization_id, name, is_default, layout),
  update (name, is_default, layout, archived_at)
  on public.delivery_note_templates to authenticated;

alter table public.delivery_note_templates enable row level security;
alter table public.delivery_notes enable row level security;
alter table public.delivery_note_lines enable row level security;
alter table public.finished_goods_movements enable row level security;

-- Template names are visible wherever customers are edited.
create policy delivery_note_templates_select on public.delivery_note_templates
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));
create policy delivery_note_templates_insert on public.delivery_note_templates
  for insert to authenticated
  with check (private.has_permission(organization_id, 'org.settings.manage'));
create policy delivery_note_templates_update on public.delivery_note_templates
  for update to authenticated
  using (private.has_permission(organization_id, 'org.settings.manage'))
  with check (private.has_permission(organization_id, 'org.settings.manage'));

create policy delivery_notes_select on public.delivery_notes
  for select to authenticated
  using (private.has_permission(organization_id, 'finished_goods.read'));
create policy delivery_note_lines_select on public.delivery_note_lines
  for select to authenticated
  using (private.has_permission(organization_id, 'finished_goods.read'));
create policy finished_goods_movements_select on public.finished_goods_movements
  for select to authenticated
  using (private.has_permission(organization_id, 'finished_goods.read'));

revoke execute on function
  private.seed_organization_delivery_template(),
  private.valid_delivery_number_template(text),
  private.format_delivery_number(text, integer, integer, date, bigint),
  private.assert_finished_access(uuid, text)
  from public;
-- The settings check runs as the caller.
grant execute on function private.valid_delivery_number_template(text) to authenticated;

revoke execute on function
  public.receive_finished_goods(uuid, uuid, uuid, numeric),
  public.issue_delivery_note(uuid, uuid, jsonb, jsonb),
  public.cancel_delivery_note(uuid, text)
  from public, anon;
grant execute on function
  public.receive_finished_goods(uuid, uuid, uuid, numeric),
  public.issue_delivery_note(uuid, uuid, jsonb, jsonb),
  public.cancel_delivery_note(uuid, text)
  to authenticated;
