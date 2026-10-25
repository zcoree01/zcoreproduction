-- Phase 2: production orders (radni nalozi) and their operations (D-016).
-- Module `production`. Access model:
--   orders.read             admin, director, head_of_production, warehouse, quality_inspector
--   orders.manage           admin, director, head_of_production
--   orders.material.update  warehouse: material statuses (waiting for material, cutting, ready)
--   quality.inspect         quality_inspector: may be assigned to inspection operations
-- Operators read nothing directly: the floor functions below return the
-- operations of the machines they are qualified for (or that are assigned to
-- them by name). The worker of a cutting operation may set the material statuses.
--
-- Also in this migration:
--   * new system role quality_inspector ("Kontrolor") for every organization;
--   * customers.customer_number (automatic, never reused, editable);
--   * private.counters: per-organization counters (customer numbers, order
--     numbers per year) incremented in the inserting transaction;
--   * operation_types.is_cutting (sawing / cutting the raw pieces);
--   * organization settings for order numbers, priorities and due-date warnings.
--
-- Orders are a snapshot: operations and drawings are copied from the product
-- revision when the order is created; later product changes never touch it.
-- Completing an order stays blocked until production reporting exists
-- (private.order_completion_allowed).

-- ---------------------------------------------------------------------------
-- System role "Kontrolor" and permissions
-- ---------------------------------------------------------------------------
create or replace function private.bootstrap_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.roles (organization_id, key, name, is_system) values
    (new.id, 'admin', 'Administrator', true),
    (new.id, 'director', 'Direktor', true),
    (new.id, 'head_of_production', 'Šef proizvodnje', true),
    (new.id, 'warehouse', 'Skladištar', true),
    (new.id, 'operator', 'Operater', true),
    (new.id, 'quality_inspector', 'Kontrolor', true);

  insert into public.role_permissions (organization_id, role_id, permission_key)
  select new.id, r.id, p.key
  from public.roles r
  join public.permissions p on r.key = any (p.default_roles)
  where r.organization_id = new.id;

  insert into public.org_modules (organization_id, module_key, enabled, enabled_at)
  values (new.id, 'core', true, now());

  return null;
end;
$$;

insert into public.roles (organization_id, key, name, is_system)
select o.id, 'quality_inspector', 'Kontrolor', true
from public.organizations o
on conflict (organization_id, key) do nothing;

insert into public.permissions (key, module_key, description, default_roles) values
  ('orders.read', 'production', 'View production orders, their operations, drawings and history',
    '{admin,director,head_of_production,warehouse,quality_inspector}'),
  ('orders.manage', 'production',
    'Create, edit, copy and assign production orders and change their status',
    '{admin,director,head_of_production}'),
  ('orders.material.update', 'production',
    'Set the material statuses of production orders (waiting for material, cutting, ready)',
    '{warehouse}'),
  ('quality.inspect', 'production', 'Be assigned to inspection operations', '{quality_inspector}');

-- Inspectors see machines and drawings like the other shop roles.
update public.permissions
set default_roles = array_append(default_roles, 'quality_inspector')
where key in ('machines.read', 'products.read')
  and not ('quality_inspector' = any (default_roles));

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system
  and (p.key in ('orders.read', 'orders.manage', 'orders.material.update', 'quality.inspect')
    or r.key = 'quality_inspector')
on conflict do nothing;

-- Permission check for another user (e.g. "is this employee's account an inspector?").
create function private.user_has_permission(p_org_id uuid, p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id and o.archived_at is null
    join public.profiles p on p.id = m.user_id and p.archived_at is null
    join public.roles r on r.id = m.role_id and r.archived_at is null
    join public.role_permissions rp on rp.role_id = r.id
    where m.organization_id = p_org_id
      and m.user_id = p_user_id
      and m.archived_at is null
      and rp.permission_key = p_permission
  )
$$;

-- ---------------------------------------------------------------------------
-- Counters (never reused; incremented inside the inserting transaction, so
-- concurrent inserts wait on the counter row and never get the same value)
-- ---------------------------------------------------------------------------
create table private.counters (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  scope text not null check (length(scope) between 1 and 100),
  value bigint not null check (value >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, scope)
);

comment on table private.counters is
  'Per-organization counters (customer_number, production_order:<year>). Only definer functions use it.';

-- RLS without policies: only SECURITY DEFINER functions read or write counters.
alter table private.counters enable row level security;
revoke all on private.counters from public, anon, authenticated;

create function private.next_counter(p_org_id uuid, p_scope text)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.counters as c (organization_id, scope, value)
  values (p_org_id, p_scope, 1)
  on conflict (organization_id, scope) do update
    set value = c.value + 1, updated_at = now()
  returning c.value
$$;

-- A value taken by hand: the counter never hands it out later.
create function private.raise_counter(p_org_id uuid, p_scope text, p_value bigint)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.counters as c (organization_id, scope, value)
  values (p_org_id, p_scope, greatest(p_value, 0))
  on conflict (organization_id, scope) do update
    set value = greatest(c.value, excluded.value), updated_at = now()
$$;

-- ---------------------------------------------------------------------------
-- Customer numbers
-- ---------------------------------------------------------------------------
alter table public.customers
  add column customer_number integer check (customer_number between 1 and 999999);

with numbered as (
  select c.id, row_number() over (partition by c.organization_id order by c.created_at, c.id) as n
  from public.customers c
)
update public.customers c set customer_number = numbered.n
from numbered
where numbered.id = c.id;

alter table public.customers alter column customer_number set not null;

insert into private.counters (organization_id, scope, value)
select c.organization_id, 'customer_number', max(c.customer_number)
from public.customers c
group by c.organization_id
on conflict (organization_id, scope) do nothing;

-- Unique among active customers; an archived customer's number can be taken
-- over by hand (the application asks for confirmation), never automatically.
create unique index customers_number_key
  on public.customers (organization_id, customer_number)
  where archived_at is null;

create function private.assign_customer_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_number is null then
    new.customer_number := case
      when tg_op = 'UPDATE' then old.customer_number
      else private.next_counter(new.organization_id, 'customer_number')
    end;
  elsif tg_op = 'INSERT' or new.customer_number is distinct from old.customer_number then
    perform private.raise_counter(new.organization_id, 'customer_number', new.customer_number);
  end if;
  return new;
end;
$$;

create trigger customers_assign_number before insert or update on public.customers
  for each row execute function private.assign_customer_number();

grant insert (customer_number), update (customer_number) on public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- Cutting operations
-- ---------------------------------------------------------------------------
alter table public.operation_types
  add column is_cutting boolean not null default false,
  add constraint operation_types_cutting_check
    check (not (is_cutting and (is_external or is_inspection)));

grant insert (is_cutting), update (is_cutting) on public.operation_types to authenticated;

-- ---------------------------------------------------------------------------
-- Organization settings
--   order_number_template  tokens {KUPAC} {SEDMICA} {GODINA} {GODINA4} {BROJ};
--                          must contain {BROJ} and a year (numbers restart yearly)
--   order_number_digits    minimum digits of {BROJ} (more when needed)
--   priority_mode          manual | automatic
--   priority_thresholds    4 ascending day limits of the schedule slack → 1..4, else 5
--   due_warning_days       days before the due date that raise a warning
--   work_hours_per_day     for the slack calculation (until shifts exist)
-- ---------------------------------------------------------------------------
create function private.valid_order_number_template(p_template text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select length(p_template) between 1 and 60
    and position('{BROJ}' in p_template) > 0
    and p_template ~ '\{GODINA4?\}'
    and regexp_replace(p_template, '\{(KUPAC|SEDMICA|GODINA4|GODINA|BROJ)\}', '', 'g')
      ~ '^[A-Za-z0-9./_ -]*$'
$$;

create function private.valid_int_list(
  p_value jsonb,
  p_min_length integer,
  p_max_length integer,
  p_min integer,
  p_max integer,
  p_ascending boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'array'
    and jsonb_array_length(p_value) between p_min_length and p_max_length
    and not exists (
      select 1 from jsonb_array_elements(p_value) as e (v)
      where jsonb_typeof(e.v) <> 'number'
        or (e.v #>> '{}')::numeric <> trunc((e.v #>> '{}')::numeric)
        or (e.v #>> '{}')::numeric not between p_min and p_max
    )
    and (not p_ascending or not exists (
      select 1
      from jsonb_array_elements(p_value) with ordinality as a (v, i)
      join jsonb_array_elements(p_value) with ordinality as b (v, i) on b.i = a.i + 1
      where (b.v #>> '{}')::numeric < (a.v #>> '{}')::numeric
    ))
$$;

create function private.valid_order_settings(p_settings jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    (p_settings -> 'order_number_template' is null
      or (jsonb_typeof(p_settings -> 'order_number_template') = 'string'
        and private.valid_order_number_template(p_settings ->> 'order_number_template')))
    and (p_settings -> 'order_number_digits' is null
      or (jsonb_typeof(p_settings -> 'order_number_digits') = 'number'
        and (p_settings ->> 'order_number_digits') in ('1', '2', '3', '4', '5', '6')))
    and coalesce(p_settings ->> 'priority_mode', 'manual') in ('manual', 'automatic')
    and (p_settings -> 'priority_thresholds' is null
      or private.valid_int_list(p_settings -> 'priority_thresholds', 4, 4, -365, 365, true))
    and (p_settings -> 'due_warning_days' is null
      or private.valid_int_list(p_settings -> 'due_warning_days', 1, 5, 0, 365, false))
    and (p_settings -> 'work_hours_per_day' is null
      or (jsonb_typeof(p_settings -> 'work_hours_per_day') = 'number'
        and (p_settings ->> 'work_hours_per_day')::numeric between 1 and 24))
$$;

alter table public.organizations add constraint organizations_order_settings_check
  check (private.valid_order_settings(settings));

-- {KUPAC} customer number, {SEDMICA} ISO week (2 digits), {GODINA} year (2
-- digits), {GODINA4} year (4 digits), {BROJ} yearly sequence with at least
-- p_digits digits. Mirrored by formatOrderNumber() in src/modules/production-orders/rules.ts.
create function private.format_order_number(
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
  select replace(replace(replace(replace(replace(p_template,
    '{KUPAC}', p_customer_number::text),
    '{SEDMICA}', to_char(p_date, 'IW')),
    '{GODINA4}', to_char(p_date, 'YYYY')),
    '{GODINA}', to_char(p_date, 'YY')),
    '{BROJ}', lpad(p_sequence::text, greatest(p_digits, length(p_sequence::text)), '0'))
$$;

-- ---------------------------------------------------------------------------
-- Production orders
-- ---------------------------------------------------------------------------
create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Assigned by private.assign_order_number() (format from the settings).
  order_number text not null check (length(order_number) between 1 and 100),
  order_year integer not null check (order_year between 2000 and 2999),
  order_sequence integer not null check (order_sequence > 0),
  customer_id uuid not null,
  product_id uuid not null,
  -- Revision whose drawings are on the order (changed only by replace_order_drawings).
  revision_id uuid not null,
  unit text not null check (unit in ('pcs', 'kg', 'm', 'm2', 'set')),
  quantity numeric(14, 3) not null check (quantity > 0),
  due_date date not null,
  -- 1 = extremely urgent … 5 = not urgent; null = automatic (or normal in manual mode).
  priority smallint check (priority between 1 and 5),
  planned_start date,
  planned_end date,
  status text not null default 'draft' check (status in (
    'draft', 'planned', 'waiting_material', 'cutting', 'ready', 'in_progress', 'paused',
    'quality_check', 'completed', 'cancelled', 'archived'
  )),
  status_changed_at timestamptz not null default now(),
  -- No FK (like audit_log.actor_id): history must outlive users.
  status_changed_by uuid,
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 1 and 500),
  notes text check (notes is null or length(notes) <= 2000),
  -- Raw piece (copied from the revision) and the bar it is cut from.
  piece_length_mm numeric(10, 3) check (piece_length_mm > 0),
  kerf_mm numeric(8, 3) check (kerf_mm >= 0),
  bar_length_mm numeric(10, 3) check (bar_length_mm > 0),
  bar_remnant_mm numeric(10, 3) check (bar_remnant_mm >= 0),
  -- Copy of (repeat order).
  source_order_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, order_year, order_sequence),
  constraint production_orders_whole_pieces_check
    check (unit not in ('pcs', 'set') or quantity = trunc(quantity)),
  constraint production_orders_planned_check
    check (planned_start is null or planned_end is null or planned_end >= planned_start),
  constraint production_orders_cancel_check
    check (status not in ('cancelled') or cancel_reason is not null),
  constraint production_orders_archived_check
    check ((status = 'archived') = (archived_at is not null)),
  foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id)
    references public.products (organization_id, id) on delete restrict,
  foreign key (organization_id, revision_id)
    references public.product_revisions (organization_id, id) on delete restrict,
  foreign key (organization_id, source_order_id)
    references public.production_orders (organization_id, id) on delete restrict
);

comment on table public.production_orders is
  'Production orders (radni nalozi): a snapshot of a product revision for a customer and quantity.';

create unique index production_orders_number_key
  on public.production_orders (organization_id, order_number);
create index production_orders_customer_idx on public.production_orders (organization_id, customer_id);
create index production_orders_product_idx on public.production_orders (organization_id, product_id);
create index production_orders_revision_idx on public.production_orders (organization_id, revision_id);
create index production_orders_status_idx on public.production_orders (organization_id, status, due_date);
create index production_orders_source_idx on public.production_orders (organization_id, source_order_id);

create table public.production_order_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  sequence integer not null check (sequence between 1 and 9999),
  -- product_operations.id it was copied from (no FK: generated inspections are re-created).
  source_operation_id uuid,
  operation_type_id uuid not null,
  description text check (description is null or length(btrim(description)) between 1 and 200),
  -- Planned machine type from the routing; the order assigns a concrete machine.
  machine_type_id uuid,
  machine_type_kind text generated always as ('machine_type') stored,
  machine_id uuid,
  external_company text
    check (external_company is null or length(btrim(external_company)) between 1 and 200),
  setup_time_min numeric(10, 2) check (setup_time_min >= 0),
  cycle_time_s numeric(12, 3) check (cycle_time_s > 0),
  notes text check (notes is null or length(notes) <= 2000),
  planned_start timestamptz,
  planned_end timestamptz,
  status text not null default 'waiting'
    check (status in ('waiting', 'ready', 'in_progress', 'paused', 'done')),
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  constraint production_order_operations_sequence_key unique (order_id, sequence)
    deferrable initially immediate,
  constraint production_order_operations_planned_check
    check (planned_start is null or planned_end is null or planned_end > planned_start),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, operation_type_id)
    references public.operation_types (organization_id, id) on delete restrict,
  foreign key (organization_id, machine_type_kind, machine_type_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict,
  foreign key (organization_id, machine_id)
    references public.machines (organization_id, id) on delete restrict
);

create index production_order_operations_order_idx
  on public.production_order_operations (organization_id, order_id);
create index production_order_operations_type_idx
  on public.production_order_operations (organization_id, operation_type_id);
create index production_order_operations_machine_type_idx
  on public.production_order_operations (organization_id, machine_type_kind, machine_type_id);
create index production_order_operations_machine_idx
  on public.production_order_operations (organization_id, machine_id);

-- Workers assigned by name (optional). Without workers, everyone qualified
-- for the operation's machine sees it.
create table public.production_order_operation_workers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  operation_id uuid not null,
  employee_id uuid not null,
  created_at timestamptz not null default now(),
  unique (operation_id, employee_id),
  foreign key (organization_id, operation_id)
    references public.production_order_operations (organization_id, id) on delete restrict,
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict
);

create index production_order_operation_workers_operation_idx
  on public.production_order_operation_workers (organization_id, operation_id);
create index production_order_operation_workers_employee_idx
  on public.production_order_operation_workers (organization_id, employee_id);

-- Drawings frozen on the order. Replacing the drawing archives these rows.
create table public.production_order_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  attachment_id uuid not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, attachment_id)
    references public.product_attachments (organization_id, id) on delete restrict
);

create unique index production_order_attachments_active_key
  on public.production_order_attachments (order_id, attachment_id)
  where archived_at is null;
create index production_order_attachments_order_idx
  on public.production_order_attachments (organization_id, order_id);
create index production_order_attachments_attachment_idx
  on public.production_order_attachments (organization_id, attachment_id);

-- Every status change of an order (operation_id null) or of one of its operations.
create table public.production_order_status_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  order_id uuid not null,
  operation_id uuid,
  from_status text,
  to_status text not null,
  reason text check (reason is null or length(reason) <= 500),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  foreign key (organization_id, order_id)
    references public.production_orders (organization_id, id) on delete restrict,
  foreign key (organization_id, operation_id)
    references public.production_order_operations (organization_id, id) on delete restrict
);

create index production_order_status_history_order_idx
  on public.production_order_status_history (organization_id, order_id, changed_at);
create index production_order_status_history_operation_idx
  on public.production_order_status_history (organization_id, operation_id);

-- ---------------------------------------------------------------------------
-- Status rules (mirrored by src/modules/production-orders/status-rules.ts)
-- ---------------------------------------------------------------------------
create function private.order_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('draft', 'planned'), ('draft', 'cancelled'),
    ('planned', 'draft'), ('planned', 'waiting_material'), ('planned', 'cutting'),
    ('planned', 'ready'), ('planned', 'cancelled'),
    ('waiting_material', 'cutting'), ('waiting_material', 'ready'),
    ('waiting_material', 'cancelled'),
    ('cutting', 'waiting_material'), ('cutting', 'ready'), ('cutting', 'cancelled'),
    ('ready', 'waiting_material'), ('ready', 'in_progress'), ('ready', 'cancelled'),
    ('in_progress', 'paused'), ('in_progress', 'quality_check'), ('in_progress', 'cancelled'),
    ('paused', 'in_progress'), ('paused', 'cancelled'),
    ('quality_check', 'in_progress'), ('quality_check', 'completed'),
    ('completed', 'archived'), ('cancelled', 'archived')
  )
$$;

-- Transitions the warehouse and the cutting worker may make.
create function private.is_material_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from in ('planned', 'waiting_material', 'cutting', 'ready')
    and p_to in ('waiting_material', 'cutting', 'ready')
    and private.order_transition_allowed(p_from, p_to)
$$;

create function private.operation_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('waiting', 'ready'), ('ready', 'waiting'), ('ready', 'in_progress'),
    ('in_progress', 'paused'), ('in_progress', 'done'),
    ('paused', 'in_progress'), ('paused', 'done'),
    ('done', 'in_progress')
  )
$$;

-- Production reporting (next module) replaces this: an order may be
-- completed once the reported good quantity covers the ordered quantity.
create function private.order_completion_allowed(p_order_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select false
$$;

-- ---------------------------------------------------------------------------
-- Schedule: planned time, slack, priority and due-date warnings
-- (mirrored by src/modules/production-orders/rules.ts)
-- ---------------------------------------------------------------------------
create function private.order_schedule(p_order_id uuid)
returns table (
  planned_seconds numeric,
  remaining_seconds numeric,
  days_to_due integer,
  slack_days integer,
  computed_priority smallint,
  effective_priority smallint,
  started boolean,
  due_warning text,
  due_warning_days integer
)
language sql
stable
set search_path = ''
as $$
  with o as (
    select r.id, r.status, r.priority, r.quantity, r.due_date, org.timezone, org.settings
    from public.production_orders r
    join public.organizations org on org.id = r.organization_id
    where r.id = p_order_id
  ),
  ops as (
    select
      coalesce(sum(coalesce(op.setup_time_min, 0) * 60 + coalesce(op.cycle_time_s, 0) * o.quantity), 0)
        as planned,
      coalesce(sum(coalesce(op.setup_time_min, 0) * 60 + coalesce(op.cycle_time_s, 0) * o.quantity)
        filter (where op.status <> 'done'), 0) as remaining,
      coalesce(bool_or(op.status in ('in_progress', 'paused', 'done')), false) as op_started
    from o
    left join public.production_order_operations op
      on op.order_id = o.id and op.archived_at is null
  ),
  calc as (
    select
      o.*,
      ops.planned,
      ops.remaining,
      ops.op_started or o.status in ('in_progress', 'paused', 'quality_check') as started,
      o.due_date - (now() at time zone o.timezone)::date as days_to_due,
      coalesce((o.settings ->> 'work_hours_per_day')::numeric, 8) as hours_per_day,
      coalesce(o.settings -> 'priority_thresholds', '[0, 3, 7, 10]'::jsonb) as thresholds,
      coalesce(o.settings -> 'due_warning_days', '[10, 7, 3]'::jsonb) as warning_days
    from o, ops
  ),
  slack as (
    select calc.*,
      calc.days_to_due - ceil(calc.remaining / (3600 * calc.hours_per_day))::integer as slack_days
    from calc
  ),
  prio as (
    select slack.*,
      (case
        when slack.slack_days <= (slack.thresholds ->> 0)::integer then 1
        when slack.slack_days <= (slack.thresholds ->> 1)::integer then 2
        when slack.slack_days <= (slack.thresholds ->> 2)::integer then 3
        when slack.slack_days <= (slack.thresholds ->> 3)::integer then 4
        else 5
      end)::smallint as computed_priority,
      (
        select min((d #>> '{}')::integer)
        from jsonb_array_elements(slack.warning_days) as d
        where slack.days_to_due <= (d #>> '{}')::integer
      ) as warning_level
    from slack
  )
  select
    prio.planned,
    prio.remaining,
    prio.days_to_due,
    prio.slack_days,
    prio.computed_priority,
    coalesce(
      prio.priority,
      case when prio.settings ->> 'priority_mode' = 'automatic' then prio.computed_priority else 3 end
    )::smallint,
    prio.started,
    case
      when prio.status in ('completed', 'cancelled', 'archived') then null
      when prio.days_to_due < 0 then 'overdue'
      when prio.slack_days < 0 then 'behind'
      when not prio.started and prio.warning_level is not null then 'due_soon'
    end,
    case
      when prio.status not in ('completed', 'cancelled', 'archived')
        and prio.days_to_due >= 0 and prio.slack_days >= 0 and not prio.started
        then prio.warning_level
    end
  from prio
$$;

-- Time range an operation occupies its machine: its own planned times, else
-- the order's planned days (whole days in the organization's time zone).
create function private.operation_period(
  p_op_start timestamptz,
  p_op_end timestamptz,
  p_order_start date,
  p_order_end date,
  p_timezone text
)
returns tstzrange
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(p_op_start, p_order_start::timestamp at time zone p_timezone) is null
      or coalesce(p_op_end, (p_order_end + 1)::timestamp at time zone p_timezone) is null
      then null
    else tstzrange(
      coalesce(p_op_start, p_order_start::timestamp at time zone p_timezone),
      coalesce(p_op_end, (p_order_end + 1)::timestamp at time zone p_timezone),
      '[)'
    )
  end
$$;

-- Other active operations on the same machine whose periods overlap.
create function private.operation_overlaps(p_operation_id uuid)
returns table (operation_id uuid, order_id uuid, order_number text, operation_code text)
language sql
stable
set search_path = ''
as $$
  with me as (
    select o.id, o.machine_id,
      private.operation_period(o.planned_start, o.planned_end, r.planned_start, r.planned_end, org.timezone)
        as period
    from public.production_order_operations o
    join public.production_orders r on r.id = o.order_id
    join public.organizations org on org.id = o.organization_id
    where o.id = p_operation_id and o.machine_id is not null
  )
  select other.id, r.id, r.order_number, t.code
  from me
  join public.production_order_operations other
    on other.machine_id = me.machine_id and other.id <> me.id
  join public.production_orders r on r.id = other.order_id
  join public.organizations org on org.id = other.organization_id
  join public.operation_types t on t.id = other.operation_type_id
  where me.period is not null
    and other.archived_at is null
    and other.status <> 'done'
    and r.status not in ('draft', 'completed', 'cancelled', 'archived')
    and private.operation_period(
      other.planned_start, other.planned_end, r.planned_start, r.planned_end, org.timezone
    ) && me.period
  order by r.order_number, other.sequence
$$;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
create function private.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_settings jsonb;
  v_customer_number integer;
  v_date date;
begin
  select o.timezone, o.settings into v_timezone, v_settings
  from public.organizations o where o.id = new.organization_id;

  select c.customer_number into v_customer_number
  from public.customers c
  where c.id = new.customer_id and c.organization_id = new.organization_id;
  if v_customer_number is null then
    raise exception 'customer not found' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.product_revisions r
    where r.id = new.revision_id and r.product_id = new.product_id
  ) then
    raise exception 'revision does not belong to the product' using errcode = '23514';
  end if;

  v_date := (now() at time zone v_timezone)::date;
  new.order_year := extract(year from v_date)::integer;
  new.order_sequence := private.next_counter(new.organization_id, 'production_order:' || new.order_year);
  new.order_number := private.format_order_number(
    coalesce(v_settings ->> 'order_number_template', 'RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ}'),
    coalesce((v_settings ->> 'order_number_digits')::integer, 3),
    v_customer_number, v_date, new.order_sequence
  );
  new.status := 'draft';
  new.status_changed_at := now();
  new.status_changed_by := auth.uid();
  new.cancel_reason := null;
  new.archived_at := null;
  return new;
end;
$$;

create trigger production_orders_assign_number before insert on public.production_orders
  for each row execute function private.assign_order_number();

-- Identity never changes; what may change depends on the status. Status
-- changes come from set_production_order_status (no column grant on status).
create function private.guard_production_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.order_number is distinct from old.order_number
    or new.order_year is distinct from old.order_year
    or new.order_sequence is distinct from old.order_sequence
    or new.customer_id is distinct from old.customer_id
    or new.product_id is distinct from old.product_id
    or new.unit is distinct from old.unit
    or new.source_order_id is distinct from old.source_order_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'order identity cannot change' using errcode = '55000';
  end if;

  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
    new.archived_at := case when new.status = 'archived' then now() end;
    return new;
  end if;

  new.status_changed_at := old.status_changed_at;
  new.status_changed_by := old.status_changed_by;
  new.cancel_reason := old.cancel_reason;
  new.archived_at := old.archived_at;

  if old.status in ('completed', 'cancelled', 'archived') then
    raise exception 'order_closed' using errcode = '55000';
  end if;
  if old.status not in ('draft', 'planned') and (
    new.quantity, new.piece_length_mm, new.kerf_mm, new.bar_length_mm, new.bar_remnant_mm
  ) is distinct from (
    old.quantity, old.piece_length_mm, old.kerf_mm, old.bar_length_mm, old.bar_remnant_mm
  ) then
    raise exception 'order_in_production' using errcode = '55000';
  end if;
  if new.revision_id is distinct from old.revision_id and not exists (
    select 1 from public.product_revisions r
    where r.id = new.revision_id and r.product_id = new.product_id
  ) then
    raise exception 'revision does not belong to the product' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger production_orders_guard before update on public.production_orders
  for each row execute function private.guard_production_order();

create function private.check_operation_worker(p_operation_id uuid, p_employee_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op record;
begin
  select o.organization_id, o.machine_id, o.status, t.is_external, t.is_inspection
  into v_op
  from public.production_order_operations o
  join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
  where o.id = p_operation_id;

  if v_op.is_external then
    raise exception 'worker_external' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.organization_id = v_op.organization_id
      and e.status = 'active' and e.archived_at is null
  ) then
    raise exception 'worker_inactive' using errcode = '23514';
  end if;

  if v_op.is_inspection then
    if not exists (
      select 1 from public.employees e
      where e.id = p_employee_id and e.user_id is not null
        and private.user_has_permission(v_op.organization_id, e.user_id, 'quality.inspect')
    ) then
      raise exception 'worker_not_inspector' using errcode = '23514';
    end if;
  elsif v_op.machine_id is null then
    raise exception 'worker_needs_machine' using errcode = '23514';
  elsif not exists (
    select 1 from public.employee_machines em
    where em.employee_id = p_employee_id and em.machine_id = v_op.machine_id
  ) then
    raise exception 'worker_not_qualified' using errcode = '23514';
  end if;
end;
$$;

create function private.guard_order_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_external boolean;
begin
  if tg_op = 'UPDATE' and (new.order_id is distinct from old.order_id
    or new.organization_id is distinct from old.organization_id
    or new.source_operation_id is distinct from old.source_operation_id) then
    raise exception 'operation cannot move to another order' using errcode = '55000';
  end if;

  select r.status into v_order_status
  from public.production_orders r where r.id = new.order_id;
  if v_order_status in ('completed', 'cancelled', 'archived') then
    raise exception 'order_closed' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if v_order_status <> 'draft' then
      raise exception 'order_not_draft' using errcode = '55000';
    end if;
    new.status := 'waiting';
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  else
    if new.status is distinct from old.status then
      new.status_changed_at := now();
      new.status_changed_by := auth.uid();
    else
      new.status_changed_at := old.status_changed_at;
      new.status_changed_by := old.status_changed_by;
    end if;
    if new.archived_at is distinct from old.archived_at and v_order_status <> 'draft' then
      raise exception 'order_not_draft' using errcode = '55000';
    end if;
    if (new.operation_type_id, new.description, new.machine_type_id, new.external_company,
        new.setup_time_min, new.cycle_time_s, new.notes)
      is distinct from (old.operation_type_id, old.description, old.machine_type_id,
        old.external_company, old.setup_time_min, old.cycle_time_s, old.notes)
      and v_order_status not in ('draft', 'planned') then
      raise exception 'order_in_production' using errcode = '55000';
    end if;
    if old.status = 'done' and new.status = 'done'
      and (new.machine_id, new.planned_start, new.planned_end)
        is distinct from (old.machine_id, old.planned_start, old.planned_end) then
      raise exception 'operation_done' using errcode = '55000';
    end if;
  end if;

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

create trigger production_order_operations_guard
  before insert or update on public.production_order_operations
  for each row execute function private.guard_order_operation();

-- A new machine (or operation type) must still suit the assigned workers.
create function private.recheck_operation_workers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
begin
  if (new.machine_id, new.operation_type_id) is distinct from (old.machine_id, old.operation_type_id) then
    for v_employee_id in
      select w.employee_id from public.production_order_operation_workers w where w.operation_id = new.id
    loop
      perform private.check_operation_worker(new.id, v_employee_id);
    end loop;
  end if;
  return null;
end;
$$;

create trigger production_order_operations_recheck_workers
  after update on public.production_order_operations
  for each row execute function private.recheck_operation_workers();

create function private.guard_operation_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation_id uuid;
  v_order_status text;
  v_op_status text;
begin
  if tg_op = 'DELETE' then
    v_operation_id := old.operation_id;
  else
    v_operation_id := new.operation_id;
  end if;
  select r.status, o.status into v_order_status, v_op_status
  from public.production_order_operations o
  join public.production_orders r on r.id = o.order_id
  where o.id = v_operation_id;

  if v_order_status in ('completed', 'cancelled', 'archived') then
    raise exception 'order_closed' using errcode = '55000';
  end if;
  if v_op_status = 'done' then
    raise exception 'operation_done' using errcode = '55000';
  end if;
  if tg_op = 'INSERT' then
    perform private.check_operation_worker(new.operation_id, new.employee_id);
    return new;
  end if;
  return old;
end;
$$;

create trigger production_order_operation_workers_guard
  before insert or delete on public.production_order_operation_workers
  for each row execute function private.guard_operation_worker();

create function private.guard_order_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.order_id is distinct from old.order_id
    or new.attachment_id is distinct from old.attachment_id) then
    raise exception 'order attachment cannot change' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.production_orders r
    where r.id = new.order_id and r.status in ('completed', 'cancelled', 'archived')
  ) then
    raise exception 'order_closed' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger production_order_attachments_guard
  before insert or update on public.production_order_attachments
  for each row execute function private.guard_order_attachment();

create trigger production_orders_set_updated_at before update on public.production_orders
  for each row execute function private.set_updated_at();
create trigger production_order_operations_set_updated_at
  before update on public.production_order_operations
  for each row execute function private.set_updated_at();

create trigger production_orders_audit after insert or update on public.production_orders
  for each row execute function private.audit_row_change();
create trigger production_order_operations_audit after insert or update on public.production_order_operations
  for each row execute function private.audit_row_change();
create trigger production_order_operation_workers_audit
  after insert or delete on public.production_order_operation_workers
  for each row execute function private.audit_row_change();
create trigger production_order_attachments_audit
  after insert or update on public.production_order_attachments
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create function private.require_orders_manage(p_org_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'orders.manage') then
    raise exception 'missing permission orders.manage' using errcode = '42501';
  end if;
end;
$$;

-- Copies the routing of a revision (incl. generated inspections) into an order.
create function private.snapshot_routing(p_org_id uuid, p_order_id uuid, p_revision_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.production_order_operations (
    organization_id, order_id, sequence, source_operation_id, operation_type_id, description,
    machine_type_id, machine_id, external_company, setup_time_min, cycle_time_s, notes
  )
  select p_org_id, p_order_id, row_number() over (order by o.sequence), o.id, o.operation_type_id,
    o.description, o.machine_type_id, o.machine_id, o.external_company, o.setup_time_min,
    o.cycle_time_s, o.notes
  from public.product_operations o
  where o.revision_id = p_revision_id and o.archived_at is null
  order by o.sequence;
end;
$$;

create function private.snapshot_drawings(p_org_id uuid, p_order_id uuid, p_revision_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.production_order_attachments (organization_id, order_id, attachment_id)
  select p_org_id, p_order_id, a.id
  from public.product_attachments a
  where a.revision_id = p_revision_id and a.archived_at is null;
end;
$$;

-- p_order: {customer_id, product_id, revision_id (null = current), quantity,
--   due_date, priority, planned_start, planned_end, notes, piece_length_mm,
--   kerf_mm, bar_length_mm, bar_remnant_mm}. Piece length and kerf default to the revision.
create function public.create_production_order(p_org_id uuid, p_order jsonb)
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
    '-', 2000, 1
  )
  returning id into v_id;

  perform private.snapshot_routing(p_org_id, v_id, v_revision.id);
  perform private.snapshot_drawings(p_org_id, v_id, v_revision.id);
  return v_id;
end;
$$;

-- Repeat order: same customer, product, drawings and operations (machines
-- kept, workers and planned times not). p_order: {quantity, due_date,
-- priority, planned_start, planned_end, notes}.
create function public.copy_production_order(p_order_id uuid, p_order jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.production_orders;
  v_id uuid;
begin
  select * into v_source from public.production_orders r where r.id = p_order_id;
  if v_source.id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(v_source.organization_id);

  insert into public.production_orders (
    organization_id, customer_id, product_id, revision_id, unit, quantity, due_date, priority,
    planned_start, planned_end, notes, piece_length_mm, kerf_mm, bar_length_mm, bar_remnant_mm,
    source_order_id, order_number, order_year, order_sequence
  ) values (
    v_source.organization_id, v_source.customer_id, v_source.product_id, v_source.revision_id,
    v_source.unit, (p_order ->> 'quantity')::numeric, (p_order ->> 'due_date')::date,
    (p_order ->> 'priority')::smallint, (p_order ->> 'planned_start')::date,
    (p_order ->> 'planned_end')::date, p_order ->> 'notes', v_source.piece_length_mm,
    v_source.kerf_mm, v_source.bar_length_mm, v_source.bar_remnant_mm, v_source.id, '-', 2000, 1
  )
  returning id into v_id;

  insert into public.production_order_operations (
    organization_id, order_id, sequence, source_operation_id, operation_type_id, description,
    machine_type_id, machine_id, external_company, setup_time_min, cycle_time_s, notes
  )
  select o.organization_id, v_id, row_number() over (order by o.sequence), o.source_operation_id,
    o.operation_type_id, o.description, o.machine_type_id, o.machine_id, o.external_company,
    o.setup_time_min, o.cycle_time_s, o.notes
  from public.production_order_operations o
  where o.order_id = v_source.id and o.archived_at is null
  order by o.sequence;

  insert into public.production_order_attachments (organization_id, order_id, attachment_id)
  select a.organization_id, v_id, a.attachment_id
  from public.production_order_attachments a
  where a.order_id = v_source.id and a.archived_at is null;

  perform public.write_audit(
    v_source.organization_id, 'production_orders.copied', 'production_orders', v_id::text,
    jsonb_build_object('order_id', v_source.id, 'order_number', v_source.order_number), null
  );
  return v_id;
end;
$$;

-- Status change with the server-side transition rules. SECURITY DEFINER:
-- warehouse and cutting workers have no UPDATE on orders; the rules are here.
create function public.set_production_order_status(
  p_order_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select * into v_order from public.production_orders r where r.id = p_order_id for update;
  if v_order.id is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = v_order.organization_id) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status = p_status then
    return;
  end if;
  if not private.order_transition_allowed(v_order.status, p_status) then
    raise exception 'invalid_status_transition' using errcode = '22023';
  end if;

  if not private.has_permission(v_order.organization_id, 'orders.manage')
    and not (
      private.is_material_transition(v_order.status, p_status)
      and (private.has_permission(v_order.organization_id, 'orders.material.update')
        or private.is_cutting_worker(p_order_id))
    ) then
    raise exception 'not allowed to change the status of this order' using errcode = '42501';
  end if;

  if p_status = 'cancelled' and v_reason is null then
    raise exception 'cancel_reason_required' using errcode = '22023';
  end if;
  if p_status = 'completed' and not private.order_completion_allowed(p_order_id) then
    raise exception 'completion_requires_production_report' using errcode = '22023';
  end if;
  if p_status in ('ready', 'in_progress') and exists (
    select 1
    from public.production_order_operations o
    join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
    where o.order_id = p_order_id and o.archived_at is null and o.machine_id is null
      and not t.is_external and not t.is_inspection
  ) then
    raise exception 'machine_assignment_missing' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'reason too long' using errcode = '22023';
  end if;

  update public.production_orders
  set status = p_status,
    cancel_reason = case when p_status = 'cancelled' then v_reason else cancel_reason end
  where id = p_order_id;

  insert into public.production_order_status_history (
    organization_id, order_id, from_status, to_status, reason
  ) values (v_order.organization_id, p_order_id, v_order.status, p_status, v_reason);
end;
$$;

create function public.set_order_operation_status(p_operation_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_order_status text;
begin
  select * into v_op from public.production_order_operations o
  where o.id = p_operation_id and o.archived_at is null
  for update;
  if v_op.id is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = v_op.organization_id) then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(v_op.organization_id);

  if v_op.status = p_status then
    return;
  end if;
  if not private.operation_transition_allowed(v_op.status, p_status) then
    raise exception 'invalid_status_transition' using errcode = '22023';
  end if;
  select r.status into v_order_status from public.production_orders r where r.id = v_op.order_id;
  if v_order_status in ('draft', 'completed', 'cancelled', 'archived') then
    raise exception 'order_not_released' using errcode = '55000';
  end if;

  update public.production_order_operations set status = p_status where id = p_operation_id;

  insert into public.production_order_status_history (
    organization_id, order_id, operation_id, from_status, to_status
  ) values (v_op.organization_id, v_op.order_id, p_operation_id, v_op.status, p_status);
end;
$$;

-- Warnings for an operation's assignment (never blocking): another machine
-- type than the routing planned, and overlapping operations on the machine.
create function public.order_operation_warnings(p_operation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'machine_type_mismatch', coalesce((
      select o.machine_type_id is not null and m.type_id is distinct from o.machine_type_id
      from public.production_order_operations o
      join public.machines m on m.id = o.machine_id and m.organization_id = o.organization_id
      where o.id = p_operation_id
    ), false),
    'overlaps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'operation_id', x.operation_id, 'order_id', x.order_id,
        'order_number', x.order_number, 'operation_code', x.operation_code
      ))
      from private.operation_overlaps(p_operation_id) x
    ), '[]'::jsonb)
  )
$$;

-- Machine, workers (replace the list) and planned times of one operation.
-- Returns order_operation_warnings().
create function public.assign_order_operation(
  p_operation_id uuid,
  p_machine_id uuid,
  p_employee_ids uuid[],
  p_planned_start timestamptz,
  p_planned_end timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
begin
  select * into v_op from public.production_order_operations o
  where o.id = p_operation_id and o.archived_at is null
  for update;
  if v_op.id is null then
    raise exception 'operation not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(v_op.organization_id);

  delete from public.production_order_operation_workers w
  where w.operation_id = p_operation_id
    and w.employee_id <> all (coalesce(p_employee_ids, '{}'));

  update public.production_order_operations set
    machine_id = p_machine_id,
    planned_start = p_planned_start,
    planned_end = p_planned_end
  where id = p_operation_id
    and (machine_id, planned_start, planned_end)
      is distinct from (p_machine_id, p_planned_start, p_planned_end);

  insert into public.production_order_operation_workers (organization_id, operation_id, employee_id)
  select v_op.organization_id, p_operation_id, e
  from unnest(coalesce(p_employee_ids, '{}')) as e
  on conflict (operation_id, employee_id) do nothing;

  return public.order_operation_warnings(p_operation_id);
end;
$$;

-- New operation at the end of a draft order. p_operation: {operation_type_id,
-- description, machine_id, external_company, setup_time_min, cycle_time_s, notes}
create function public.add_order_operation(p_order_id uuid, p_operation jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_id uuid;
begin
  select r.organization_id into v_org_id from public.production_orders r
  where r.id = p_order_id for update;
  if v_org_id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(v_org_id);

  insert into public.production_order_operations (
    organization_id, order_id, sequence, operation_type_id, description, machine_id,
    external_company, setup_time_min, cycle_time_s, notes
  ) values (
    v_org_id, p_order_id,
    (select coalesce(max(o.sequence), 0) + 1 from public.production_order_operations o
      where o.order_id = p_order_id),
    (p_operation ->> 'operation_type_id')::uuid, p_operation ->> 'description',
    (p_operation ->> 'machine_id')::uuid, p_operation ->> 'external_company',
    (p_operation ->> 'setup_time_min')::numeric, (p_operation ->> 'cycle_time_s')::numeric,
    p_operation ->> 'notes'
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- "Change of drawing on the existing order": the order shows the drawings of
-- p_revision_id (newer or older revision of the same product) instead.
create function public.replace_order_drawings(p_order_id uuid, p_revision_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_from text;
  v_to text;
begin
  select * into v_order from public.production_orders r where r.id = p_order_id for update;
  if v_order.id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  perform private.require_orders_manage(v_order.organization_id);

  select r.revision into v_to from public.product_revisions r
  where r.id = p_revision_id and r.product_id = v_order.product_id;
  if not found then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;
  select r.revision into v_from from public.product_revisions r where r.id = v_order.revision_id;

  update public.production_order_attachments set archived_at = now()
  where order_id = p_order_id and archived_at is null;
  update public.production_orders set revision_id = p_revision_id where id = p_order_id;
  perform private.snapshot_drawings(v_order.organization_id, p_order_id, p_revision_id);

  perform public.write_audit(
    v_order.organization_id, 'production_orders.drawings_replaced', 'production_orders',
    p_order_id::text,
    jsonb_build_object('revision_id', v_order.revision_id, 'revision', v_from),
    jsonb_build_object('revision_id', p_revision_id, 'revision', v_to)
  );
end;
$$;

-- Status log (order and operations) with user names. SECURITY DEFINER with
-- its own orders.read check (profiles of other users, operation codes).
create function public.production_order_status_log(p_order_id uuid)
returns table (
  id bigint,
  changed_at timestamptz,
  username text,
  full_name text,
  operation_id uuid,
  operation_code text,
  operation_sequence integer,
  from_status text,
  to_status text,
  reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.changed_at, p.username, p.full_name, h.operation_id, t.code, o.sequence,
    h.from_status, h.to_status, h.reason
  from public.production_order_status_history h
  join public.production_orders r on r.id = h.order_id
  left join public.profiles p on p.id = h.changed_by and p.organization_id = h.organization_id
  left join public.production_order_operations o on o.id = h.operation_id
  left join public.operation_types t on t.id = o.operation_type_id
  where h.order_id = p_order_id
    and private.has_permission(r.organization_id, 'orders.read')
  order by h.changed_at desc, h.id desc
$$;

-- Audit entries of an order, its operations, workers and drawings.
create function public.production_order_history(p_order_id uuid, p_limit integer default 200)
returns table (
  id bigint,
  created_at timestamptz,
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
  with ord as (
    select r.id, r.organization_id from public.production_orders r
    where r.id = p_order_id and private.has_permission(r.organization_id, 'orders.read')
  ),
  ops as (
    select o.id from public.production_order_operations o join ord on o.order_id = ord.id
  ),
  entities as (
    select ord.id::text as id from ord
    union all select o.id::text from ops o
    union all select w.id::text from public.production_order_operation_workers w
      join ops o on o.id = w.operation_id
    union all select a.id::text from public.production_order_attachments a join ord on a.order_id = ord.id
  )
  select a.id, a.created_at, pf.username, a.action, a.entity_type, a.entity_id, a.before, a.after
  from public.audit_log a
  join ord on a.organization_id = ord.organization_id
  left join public.profiles pf on pf.id = a.actor_id and pf.organization_id = a.organization_id
  where a.entity_type in ('production_orders', 'production_order_operations',
      'production_order_operation_workers', 'production_order_attachments')
    and a.entity_id in (select e.id from entities e)
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

-- ---------------------------------------------------------------------------
-- Shop floor: who sees which operation
-- ---------------------------------------------------------------------------
-- Order statuses in which operations appear on the floor.
create function private.floor_order_status(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in (
    'planned', 'waiting_material', 'cutting', 'ready', 'in_progress', 'paused', 'quality_check'
  )
$$;

-- Active employee record of the caller in the organization (or null).
create function private.current_employee(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.employees e
  where e.organization_id = p_org_id
    and e.user_id = (select auth.uid())
    and e.status = 'active'
    and e.archived_at is null
    and p_org_id in (select private.user_org_ids())
$$;

-- Assigned workers see the operation; without workers, everyone qualified
-- for its machine does.
create function private.employee_sees_operation(p_employee_id uuid, p_operation_id uuid, p_machine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee_id is not null and case
    when exists (select 1 from public.production_order_operation_workers w where w.operation_id = p_operation_id)
      then exists (
        select 1 from public.production_order_operation_workers w
        where w.operation_id = p_operation_id and w.employee_id = p_employee_id
      )
    else p_machine_id is not null and exists (
      select 1 from public.employee_machines em
      where em.employee_id = p_employee_id and em.machine_id = p_machine_id
    )
  end
$$;

create function private.can_view_order_operation(p_operation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.production_order_operations o
    join public.production_orders r on r.id = o.order_id
    where o.id = p_operation_id
      and o.archived_at is null
      and r.organization_id in (select private.user_org_ids())
      and (
        private.has_permission(r.organization_id, 'orders.read')
        or (private.floor_order_status(r.status)
          and private.employee_sees_operation(
            private.current_employee(r.organization_id), o.id, o.machine_id))
      )
  )
$$;

-- The caller works on a cutting operation of this order.
create function private.is_cutting_worker(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.production_order_operations o
    join public.production_orders r on r.id = o.order_id
    join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
    where o.order_id = p_order_id
      and o.archived_at is null
      and t.is_cutting
      and private.floor_order_status(r.status)
      and private.employee_sees_operation(private.current_employee(r.organization_id), o.id, o.machine_id)
  )
$$;

-- Open operations for the caller: on p_machine_id (a machine they are
-- qualified for) or, without a machine, the ones assigned to them by name.
-- Sorted by priority, due date and order number.
create function public.floor_operation_queue(p_org_id uuid, p_machine_id uuid default null)
returns table (
  operation_id uuid,
  order_id uuid,
  order_number text,
  order_status text,
  effective_priority smallint,
  due_date date,
  due_warning text,
  quantity numeric,
  unit text,
  part_number text,
  product_name text,
  revision text,
  sequence integer,
  operation_code text,
  operation_name text,
  description text,
  status text,
  machine_code text,
  is_cutting boolean,
  is_inspection boolean,
  planned_seconds numeric,
  previous_code text,
  previous_status text,
  assigned_by_name boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select private.current_employee(p_org_id) as employee_id)
  select o.id, r.id, r.order_number, r.status, s.effective_priority, r.due_date, s.due_warning,
    r.quantity, r.unit, p.part_number, p.name, rv.revision, o.sequence, t.code, t.name,
    o.description, o.status, m.code, t.is_cutting, t.is_inspection,
    coalesce(o.setup_time_min, 0) * 60 + coalesce(o.cycle_time_s, 0) * r.quantity,
    prev.code, prev.status,
    exists (
      select 1 from public.production_order_operation_workers w
      where w.operation_id = o.id and w.employee_id = me.employee_id
    )
  from me
  join public.production_order_operations o on o.organization_id = p_org_id
  join public.production_orders r on r.id = o.order_id
  join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
  join public.products p on p.id = r.product_id
  left join public.product_revisions rv on rv.id = r.revision_id
  left join public.machines m on m.id = o.machine_id
  cross join lateral private.order_schedule(r.id) s
  left join lateral (
    select pt.code, po.status
    from public.production_order_operations po
    join public.operation_types pt on pt.id = po.operation_type_id
    where po.order_id = o.order_id and po.archived_at is null and po.sequence < o.sequence
    order by po.sequence desc
    limit 1
  ) prev on true
  where me.employee_id is not null
    and o.archived_at is null
    and o.status <> 'done'
    and private.floor_order_status(r.status)
    and private.employee_sees_operation(me.employee_id, o.id, o.machine_id)
    and (
      (p_machine_id is null and exists (
        select 1 from public.production_order_operation_workers w
        where w.operation_id = o.id and w.employee_id = me.employee_id
      ))
      or o.machine_id = p_machine_id
    )
  order by s.effective_priority, r.due_date, r.order_number, o.sequence
$$;

-- One operation for the floor screen (QR code). Visible: everything the
-- worker needs; not visible: only the order number and its current operation.
-- Null when the operation does not exist in the caller's organization.
create function public.floor_operation(p_operation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op public.production_order_operations;
  v_order public.production_orders;
  v_current jsonb;
begin
  select * into v_op from public.production_order_operations o where o.id = p_operation_id;
  if v_op.id is null
    or not exists (select 1 from private.user_org_ids() as x (id) where x.id = v_op.organization_id) then
    return null;
  end if;
  select * into v_order from public.production_orders r where r.id = v_op.order_id;

  -- First operation that is not done: where the work is now.
  select jsonb_build_object('code', t.code, 'name', t.name, 'sequence', o.sequence,
      'status', o.status, 'machine_code', m.code, 'machine_name', m.name)
  into v_current
  from public.production_order_operations o
  join public.operation_types t on t.id = o.operation_type_id
  left join public.machines m on m.id = o.machine_id
  where o.order_id = v_order.id and o.archived_at is null and o.status <> 'done'
  order by o.sequence
  limit 1;

  if not private.can_view_order_operation(p_operation_id) then
    return jsonb_build_object(
      'visible', false,
      'order_number', v_order.order_number,
      'current', v_current
    );
  end if;

  return jsonb_build_object(
    'visible', true,
    'current', v_current,
    'order', (
      select jsonb_build_object(
        'id', r.id, 'order_number', r.order_number, 'status', r.status,
        'quantity', r.quantity, 'unit', r.unit, 'due_date', r.due_date, 'notes', r.notes,
        'effective_priority', s.effective_priority, 'due_warning', s.due_warning,
        'piece_length_mm', r.piece_length_mm, 'kerf_mm', r.kerf_mm,
        'bar_length_mm', r.bar_length_mm, 'bar_remnant_mm', r.bar_remnant_mm,
        'part_number', p.part_number, 'product_name', p.name, 'revision', rv.revision,
        'drawing_number', rv.drawing_number, 'material', mat.designation,
        'can_set_material', private.is_cutting_worker(r.id)
          or private.has_permission(r.organization_id, 'orders.material.update')
          or private.has_permission(r.organization_id, 'orders.manage')
      )
      from public.production_orders r
      join public.products p on p.id = r.product_id
      left join public.product_revisions rv on rv.id = r.revision_id
      left join public.materials mat on mat.id = rv.material_id
      cross join lateral private.order_schedule(r.id) s
      where r.id = v_order.id
    ),
    'operation', (
      select jsonb_build_object(
        'id', o.id, 'sequence', o.sequence, 'code', t.code, 'name', t.name,
        'description', o.description, 'status', o.status, 'notes', o.notes,
        'is_cutting', t.is_cutting, 'is_inspection', t.is_inspection, 'is_external', t.is_external,
        'machine_code', m.code, 'machine_name', m.name, 'external_company', o.external_company,
        'setup_time_min', o.setup_time_min, 'cycle_time_s', o.cycle_time_s,
        'planned_seconds', coalesce(o.setup_time_min, 0) * 60 + coalesce(o.cycle_time_s, 0) * v_order.quantity,
        'planned_start', o.planned_start, 'planned_end', o.planned_end,
        'workers', coalesce((
          select jsonb_agg(e.first_name || ' ' || e.last_name order by e.last_name, e.first_name)
          from public.production_order_operation_workers w
          join public.employees e on e.id = w.employee_id
          where w.operation_id = o.id
        ), '[]'::jsonb)
      )
      from public.production_order_operations o
      join public.operation_types t on t.id = o.operation_type_id
      left join public.machines m on m.id = o.machine_id
      where o.id = p_operation_id
    ),
    'operations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'sequence', o.sequence, 'code', t.code, 'name', t.name,
        'status', o.status, 'machine_code', m.code
      ) order by o.sequence), '[]'::jsonb)
      from public.production_order_operations o
      join public.operation_types t on t.id = o.operation_type_id
      left join public.machines m on m.id = o.machine_id
      where o.order_id = v_order.id and o.archived_at is null
    ),
    -- Drawings of the order; machine drawings only for this operation (or for none).
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'title', a.title, 'file_name', a.file_name,
        'content_type', a.content_type, 'for_operation', a.operation_id is not null
      ) order by (a.kind <> 'main_drawing'), a.created_at), '[]'::jsonb)
      from public.production_order_attachments oa
      join public.product_attachments a on a.id = oa.attachment_id
      where oa.order_id = v_order.id and oa.archived_at is null
        and (a.kind <> 'machine_drawing' or a.operation_id is null
          or a.operation_id = v_op.source_operation_id)
    )
  );
end;
$$;

-- Order drawings a floor user may open (storage policy below).
create function private.can_read_order_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.product_attachments a
    join public.production_order_attachments oa
      on oa.attachment_id = a.id and oa.archived_at is null
    join public.production_order_operations o on o.order_id = oa.order_id
    where a.storage_path = p_name
      and a.organization_id = private.storage_org_id(p_name)
      and private.can_view_order_operation(o.id)
  )
$$;

-- ---------------------------------------------------------------------------
-- Views (security_invoker)
-- ---------------------------------------------------------------------------
create view public.production_order_directory
with (security_invoker = true)
as
select
  r.id,
  r.organization_id,
  r.order_number,
  r.order_year,
  r.order_sequence,
  r.status,
  r.priority,
  r.due_date,
  r.planned_start,
  r.planned_end,
  r.quantity,
  r.unit,
  r.notes,
  r.created_at,
  r.status_changed_at,
  r.archived_at,
  r.customer_id,
  c.name as customer_name,
  c.customer_number,
  r.product_id,
  p.part_number,
  p.name as product_name,
  r.revision_id,
  rv.revision,
  s.planned_seconds,
  s.remaining_seconds,
  s.days_to_due,
  s.slack_days,
  s.computed_priority,
  s.effective_priority,
  s.started,
  s.due_warning,
  s.due_warning_days,
  (
    select coalesce(array_agg(distinct o.machine_id) filter (where o.machine_id is not null), '{}')
    from public.production_order_operations o
    where o.order_id = r.id and o.archived_at is null
  ) as machine_ids,
  (
    select count(*)::integer from public.production_order_operations o
    where o.order_id = r.id and o.archived_at is null
  ) as operation_count,
  (
    select count(*)::integer from public.production_order_operations o
    where o.order_id = r.id and o.archived_at is null and o.status = 'done'
  ) as operations_done
from public.production_orders r
left join public.customers c on c.id = r.customer_id and c.organization_id = r.organization_id
left join public.products p on p.id = r.product_id and p.organization_id = r.organization_id
left join public.product_revisions rv on rv.id = r.revision_id and rv.organization_id = r.organization_id
cross join lateral private.order_schedule(r.id) s;

comment on view public.production_order_directory is
  'Production orders with customer, product, planned time, priority and due-date warnings (security_invoker).';

-- Worker names for order screens (employees.read is not needed to see who is assigned).
create function private.operation_workers(p_operation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', e.id, 'name', e.first_name || ' ' || e.last_name,
      'employee_number', e.employee_number
    ) order by e.last_name, e.first_name), '[]'::jsonb)
  from public.production_order_operation_workers w
  join public.employees e on e.id = w.employee_id
  where w.operation_id = p_operation_id
    and private.has_permission(w.organization_id, 'orders.read')
$$;

create view public.production_order_operation_directory
with (security_invoker = true)
as
select
  o.id,
  o.organization_id,
  o.order_id,
  o.sequence,
  o.source_operation_id,
  o.operation_type_id,
  t.code as operation_code,
  t.name as operation_name,
  t.is_external,
  t.is_inspection,
  t.is_cutting,
  o.description,
  o.machine_type_id,
  mt.name as machine_type_name,
  o.machine_id,
  m.code as machine_code,
  m.name as machine_name,
  m.cycle_time_unit as machine_cycle_time_unit,
  o.machine_id is not null and o.machine_type_id is not null
    and m.type_id is distinct from o.machine_type_id as machine_type_mismatch,
  o.external_company,
  o.setup_time_min,
  o.cycle_time_s,
  coalesce(o.setup_time_min, 0) * 60 + coalesce(o.cycle_time_s, 0) * r.quantity as planned_seconds,
  o.notes,
  o.planned_start,
  o.planned_end,
  o.status,
  o.status_changed_at,
  o.archived_at,
  private.operation_workers(o.id) as workers,
  (select count(*)::integer from private.operation_overlaps(o.id)) as overlap_count
from public.production_order_operations o
join public.production_orders r on r.id = o.order_id and r.organization_id = o.organization_id
left join public.operation_types t on t.id = o.operation_type_id and t.organization_id = o.organization_id
left join public.catalog_items mt on mt.id = o.machine_type_id and mt.organization_id = o.organization_id
left join public.machines m on m.id = o.machine_id and m.organization_id = o.organization_id;

comment on view public.production_order_operation_directory is
  'Operations of production orders with type, machine, planned time, workers and overlap count (security_invoker).';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on
  public.production_orders, public.production_order_operations,
  public.production_order_operation_workers, public.production_order_attachments,
  public.production_order_status_history, public.production_order_directory,
  public.production_order_operation_directory
from anon, authenticated;

grant select on
  public.production_orders, public.production_order_operations,
  public.production_order_operation_workers, public.production_order_attachments,
  public.production_order_status_history, public.production_order_directory,
  public.production_order_operation_directory
to authenticated;

-- order_number / year / sequence / status are set by triggers and definer functions.
grant insert (organization_id, customer_id, product_id, revision_id, unit, quantity, due_date,
    priority, planned_start, planned_end, notes, piece_length_mm, kerf_mm, bar_length_mm,
    bar_remnant_mm, source_order_id, order_number, order_year, order_sequence),
  update (revision_id, quantity, due_date, priority, planned_start, planned_end, notes,
    piece_length_mm, kerf_mm, bar_length_mm, bar_remnant_mm)
  on public.production_orders to authenticated;
grant insert (organization_id, order_id, sequence, source_operation_id, operation_type_id,
    description, machine_type_id, machine_id, external_company, setup_time_min, cycle_time_s, notes),
  update (description, machine_id, setup_time_min, cycle_time_s, notes, planned_start,
    planned_end, archived_at)
  on public.production_order_operations to authenticated;
grant insert (organization_id, operation_id, employee_id), delete
  on public.production_order_operation_workers to authenticated;
grant insert (organization_id, order_id, attachment_id), update (archived_at)
  on public.production_order_attachments to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.user_has_permission(uuid, uuid, text)',
    'private.next_counter(uuid, text)',
    'private.raise_counter(uuid, text, bigint)',
    'private.valid_order_number_template(text)',
    'private.valid_int_list(jsonb, integer, integer, integer, integer, boolean)',
    'private.valid_order_settings(jsonb)',
    'private.format_order_number(text, integer, integer, date, bigint)',
    'private.order_transition_allowed(text, text)',
    'private.is_material_transition(text, text)',
    'private.operation_transition_allowed(text, text)',
    'private.order_completion_allowed(uuid)',
    'private.order_schedule(uuid)',
    'private.operation_period(timestamptz, timestamptz, date, date, text)',
    'private.operation_overlaps(uuid)',
    'private.check_operation_worker(uuid, uuid)',
    'private.require_orders_manage(uuid)',
    'private.snapshot_routing(uuid, uuid, uuid)',
    'private.snapshot_drawings(uuid, uuid, uuid)',
    'private.floor_order_status(text)',
    'private.current_employee(uuid)',
    'private.employee_sees_operation(uuid, uuid, uuid)',
    'private.can_view_order_operation(uuid)',
    'private.is_cutting_worker(uuid)',
    'private.can_read_order_file(text)',
    'private.operation_workers(uuid)'
  ] loop
    execute format('revoke execute on function %s from public', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.create_production_order(uuid, jsonb)',
    'public.copy_production_order(uuid, jsonb)',
    'public.set_production_order_status(uuid, text, text)',
    'public.set_order_operation_status(uuid, text)',
    'public.order_operation_warnings(uuid)',
    'public.assign_order_operation(uuid, uuid, uuid[], timestamptz, timestamptz)',
    'public.add_order_operation(uuid, jsonb)',
    'public.replace_order_drawings(uuid, uuid)',
    'public.production_order_status_log(uuid)',
    'public.production_order_history(uuid, integer)',
    'public.floor_operation_queue(uuid, uuid)',
    'public.floor_operation(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.production_orders enable row level security;
alter table public.production_order_operations enable row level security;
alter table public.production_order_operation_workers enable row level security;
alter table public.production_order_attachments enable row level security;
alter table public.production_order_status_history enable row level security;

create policy production_orders_select on public.production_orders
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));
create policy production_orders_insert on public.production_orders
  for insert to authenticated
  with check (private.has_permission(organization_id, 'orders.manage'));
create policy production_orders_update on public.production_orders
  for update to authenticated
  using (private.has_permission(organization_id, 'orders.manage'))
  with check (private.has_permission(organization_id, 'orders.manage'));

create policy production_order_operations_select on public.production_order_operations
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));
create policy production_order_operations_insert on public.production_order_operations
  for insert to authenticated
  with check (private.has_permission(organization_id, 'orders.manage'));
create policy production_order_operations_update on public.production_order_operations
  for update to authenticated
  using (private.has_permission(organization_id, 'orders.manage'))
  with check (private.has_permission(organization_id, 'orders.manage'));

create policy production_order_operation_workers_select on public.production_order_operation_workers
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));
create policy production_order_operation_workers_insert on public.production_order_operation_workers
  for insert to authenticated
  with check (private.has_permission(organization_id, 'orders.manage'));
create policy production_order_operation_workers_delete on public.production_order_operation_workers
  for delete to authenticated
  using (private.has_permission(organization_id, 'orders.manage'));

create policy production_order_attachments_select on public.production_order_attachments
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));
create policy production_order_attachments_insert on public.production_order_attachments
  for insert to authenticated
  with check (private.has_permission(organization_id, 'orders.manage'));
create policy production_order_attachments_update on public.production_order_attachments
  for update to authenticated
  using (private.has_permission(organization_id, 'orders.manage'))
  with check (private.has_permission(organization_id, 'orders.manage'));

-- Written only by the status functions (no insert grant).
create policy production_order_status_history_select on public.production_order_status_history
  for select to authenticated
  using (private.has_permission(organization_id, 'orders.read'));

-- Floor users open the drawings of operations they see.
create policy product_files_select_orders on storage.objects
  for select to authenticated
  using (bucket_id = 'product-files' and private.can_read_order_file(name));
