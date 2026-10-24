-- Phase 2: machines, employees and per-organization catalogs (machine types,
-- locations, departments, job titles, skills). Module `production`.
-- Access model (D-012):
--   machines.read          all system roles (operators see their machines)
--   machines.manage        admin, director, head_of_production (+ machine catalogs)
--   machines.status.update operator: only machines they are qualified for, never 'inactive'
--   employees.read/manage  admin, director, head_of_production (+ employee catalogs)
-- An employee always sees their own employee row, skills and machines.

-- ---------------------------------------------------------------------------
-- Module and permissions
-- ---------------------------------------------------------------------------
insert into public.modules (key, name) values ('production', 'Proizvodnja');

insert into public.permissions (key, module_key, description, default_roles) values
  ('machines.read', 'production', 'View machines',
    '{admin,director,head_of_production,warehouse,operator}'),
  ('machines.manage', 'production', 'Create, edit and archive machines; manage machine types and locations',
    '{admin,director,head_of_production}'),
  ('machines.status.update', 'production', 'Change the status of machines the employee is qualified for',
    '{operator}'),
  ('employees.read', 'production', 'View employees, their skills and machines',
    '{admin,director,head_of_production}'),
  ('employees.manage', 'production', 'Create, edit and archive employees; manage departments, job titles and skills',
    '{admin,director,head_of_production}');

-- Existing organizations' system roles get the new defaults (D-006).
insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.module_key = 'production'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Catalogs (configurable lists per organization)
-- ---------------------------------------------------------------------------
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind text not null
    check (kind in ('machine_type', 'location', 'department', 'job_title', 'skill')),
  name text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- Target for FKs that pin both the tenant and the kind of the referenced item.
  unique (organization_id, kind, id)
);

comment on table public.catalog_items is
  'Per-organization lists (machine types, locations, departments, job titles, skills).';

create unique index catalog_items_name_key
  on public.catalog_items (organization_id, kind, lower(btrim(name)))
  where archived_at is null;

-- Which permission manages which catalog kind.
create function private.catalog_manage_permission(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('machine_type', 'location') then 'machines.manage'
    when p_kind in ('department', 'job_title', 'skill') then 'employees.manage'
  end
$$;

-- ---------------------------------------------------------------------------
-- Machines
-- ---------------------------------------------------------------------------
create table public.machines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  code text not null check (length(btrim(code)) between 1 and 50),
  name text not null check (length(btrim(name)) between 1 and 200),
  type_id uuid,
  type_kind text generated always as ('machine_type') stored,
  manufacturer text check (manufacturer is null or length(btrim(manufacturer)) between 1 and 100),
  model text check (model is null or length(btrim(model)) between 1 and 100),
  location_id uuid,
  location_kind text generated always as ('location') stored,
  status text not null default 'available'
    check (status in ('available', 'running', 'stopped', 'maintenance', 'inactive')),
  status_changed_at timestamptz not null default now(),
  -- No FK (like audit_log.actor_id): history must outlive users.
  status_changed_by uuid,
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, type_kind, type_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict,
  foreign key (organization_id, location_kind, location_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict
);

-- A code can be reused once the old machine is archived.
create unique index machines_code_key
  on public.machines (organization_id, lower(btrim(code)))
  where archived_at is null;
create index machines_type_idx on public.machines (organization_id, type_kind, type_id);
create index machines_location_idx on public.machines (organization_id, location_kind, location_id);

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Assigned by save_employee() when not given; never reused.
  employee_number integer not null check (employee_number between 1 and 999999),
  first_name text not null check (length(btrim(first_name)) between 1 and 100),
  last_name text not null check (length(btrim(last_name)) between 1 and 100),
  department_id uuid,
  department_kind text generated always as ('department') stored,
  job_title_id uuid,
  job_title_kind text generated always as ('job_title') stored,
  -- Optional login account of this employee (same organization).
  user_id uuid,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, employee_number),
  unique (organization_id, id),
  foreign key (organization_id, user_id)
    references public.profiles (organization_id, id) on delete restrict,
  foreign key (organization_id, department_kind, department_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict,
  foreign key (organization_id, job_title_kind, job_title_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict
);

-- One account belongs to at most one (non-archived) employee.
create unique index employees_user_key
  on public.employees (organization_id, user_id)
  where user_id is not null and archived_at is null;
create index employees_user_idx on public.employees (organization_id, user_id);
create index employees_department_idx
  on public.employees (organization_id, department_kind, department_id);
create index employees_job_title_idx
  on public.employees (organization_id, job_title_kind, job_title_id);

create table public.employee_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  skill_id uuid not null,
  skill_kind text generated always as ('skill') stored,
  -- 1 = basic, 2 = independent, 3 = advanced.
  level smallint not null check (level between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, skill_id),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  foreign key (organization_id, skill_kind, skill_id)
    references public.catalog_items (organization_id, kind, id) on delete restrict
);

create index employee_skills_employee_idx on public.employee_skills (organization_id, employee_id);
create index employee_skills_skill_idx on public.employee_skills (organization_id, skill_kind, skill_id);

-- Machines an employee is qualified to work on.
create table public.employee_machines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  machine_id uuid not null,
  created_at timestamptz not null default now(),
  unique (employee_id, machine_id),
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  foreign key (organization_id, machine_id)
    references public.machines (organization_id, id) on delete restrict
);

create index employee_machines_employee_idx on public.employee_machines (organization_id, employee_id);
create index employee_machines_machine_idx on public.employee_machines (organization_id, machine_id);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at, machine status bookkeeping, audit
-- ---------------------------------------------------------------------------
create trigger catalog_items_set_updated_at before update on public.catalog_items
  for each row execute function private.set_updated_at();
create trigger machines_set_updated_at before update on public.machines
  for each row execute function private.set_updated_at();
create trigger employees_set_updated_at before update on public.employees
  for each row execute function private.set_updated_at();
create trigger employee_skills_set_updated_at before update on public.employee_skills
  for each row execute function private.set_updated_at();

create function private.track_machine_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  else
    new.status_changed_at := old.status_changed_at;
    new.status_changed_by := old.status_changed_by;
  end if;
  return new;
end;
$$;

create trigger machines_track_status before insert or update on public.machines
  for each row execute function private.track_machine_status();

create trigger catalog_items_audit after insert or update on public.catalog_items
  for each row execute function private.audit_row_change();
create trigger machines_audit after insert or update on public.machines
  for each row execute function private.audit_row_change();
create trigger employees_audit after insert or update on public.employees
  for each row execute function private.audit_row_change();
create trigger employee_skills_audit after insert or update or delete on public.employee_skills
  for each row execute function private.audit_row_change();
create trigger employee_machines_audit after insert or delete on public.employee_machines
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RPC: machine status (operators and managers)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because operators have no UPDATE on machines; the rules
-- are enforced here: managers may set any status, an operator only on a
-- non-archived machine they are qualified for (as an active, non-archived
-- employee linked to their account) and never to or from 'inactive'.
create function public.set_machine_status(p_machine_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_current text;
begin
  if p_status is null
    or p_status not in ('available', 'running', 'stopped', 'maintenance', 'inactive') then
    raise exception 'invalid machine status %', p_status using errcode = '22023';
  end if;

  select m.organization_id, m.status into v_org_id, v_current
  from public.machines m
  where m.id = p_machine_id and m.archived_at is null
  for update;

  if v_org_id is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = v_org_id) then
    raise exception 'machine not found' using errcode = 'P0002';
  end if;

  if not private.has_permission(v_org_id, 'machines.manage') then
    if not private.has_permission(v_org_id, 'machines.status.update')
      or p_status = 'inactive'
      or v_current = 'inactive'
      or not exists (
        select 1
        from public.employee_machines em
        join public.employees e on e.id = em.employee_id and e.organization_id = em.organization_id
        where em.machine_id = p_machine_id
          and e.user_id = (select auth.uid())
          and e.status = 'active'
          and e.archived_at is null
      ) then
      raise exception 'not allowed to change the status of this machine' using errcode = '42501';
    end if;
  end if;

  update public.machines set status = p_status where id = p_machine_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: save employee with skills and machines in one transaction
-- ---------------------------------------------------------------------------
-- Next free employee number (SECURITY DEFINER: must see every employee of the
-- organization, including archived ones, regardless of the caller's read rights).
create function private.next_employee_number(p_org_id uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(max(e.employee_number), 0) + 1
  from public.employees e
  where e.organization_id = p_org_id
$$;

-- SECURITY INVOKER: every statement runs under the caller's RLS; the explicit
-- permission check only produces a clear error. p_employee_id null = create.
-- p_employee_number null = keep (update) or assign the next number (create).
-- p_skills = [{"skill_id": uuid, "level": 1..3}, ...]; both lists replace the
-- current ones.
create function public.save_employee(
  p_org_id uuid,
  p_employee_id uuid,
  p_employee_number integer,
  p_first_name text,
  p_last_name text,
  p_department_id uuid,
  p_job_title_id uuid,
  p_user_id uuid,
  p_status text,
  p_skills jsonb,
  p_machine_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_employee_id;
  v_number integer := p_employee_number;
begin
  if not private.has_permission(p_org_id, 'employees.manage') then
    raise exception 'missing permission employees.manage' using errcode = '42501';
  end if;
  if p_skills is null or jsonb_typeof(p_skills) <> 'array' then
    raise exception 'p_skills must be a JSON array' using errcode = '22023';
  end if;

  if v_id is null then
    if v_number is null then
      -- Serialize numbering per organization.
      perform pg_advisory_xact_lock(hashtextextended('employee_number:' || p_org_id::text, 0));
      v_number := private.next_employee_number(p_org_id);
    end if;

    insert into public.employees (
      organization_id, employee_number, first_name, last_name,
      department_id, job_title_id, user_id, status
    ) values (
      p_org_id, v_number, btrim(p_first_name), btrim(p_last_name),
      p_department_id, p_job_title_id, p_user_id, p_status
    )
    returning id into v_id;
  else
    update public.employees set
      employee_number = coalesce(v_number, employee_number),
      first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      department_id = p_department_id,
      job_title_id = p_job_title_id,
      user_id = p_user_id,
      status = p_status
    where id = v_id and organization_id = p_org_id and archived_at is null;

    if not found then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
  end if;

  -- Skills: remove deselected, upsert the rest.
  delete from public.employee_skills s
  where s.employee_id = v_id
    and s.skill_id not in (
      select (x ->> 'skill_id')::uuid from jsonb_array_elements(p_skills) as x
    );

  insert into public.employee_skills (organization_id, employee_id, skill_id, level)
  select p_org_id, v_id, (x ->> 'skill_id')::uuid, (x ->> 'level')::smallint
  from jsonb_array_elements(p_skills) as x
  on conflict (employee_id, skill_id) do update
    set level = excluded.level
    where public.employee_skills.level is distinct from excluded.level;

  -- Machines: remove deselected, add new.
  delete from public.employee_machines em
  where em.employee_id = v_id
    and em.machine_id <> all (coalesce(p_machine_ids, '{}'));

  insert into public.employee_machines (organization_id, employee_id, machine_id)
  select p_org_id, v_id, m
  from unnest(coalesce(p_machine_ids, '{}')) as m
  on conflict (employee_id, machine_id) do nothing;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- List views (security_invoker: RLS of the underlying tables applies)
-- ---------------------------------------------------------------------------
create view public.machine_directory
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
  m.archived_at
from public.machines m
left join public.catalog_items t on t.id = m.type_id and t.organization_id = m.organization_id
left join public.catalog_items l on l.id = m.location_id and l.organization_id = m.organization_id;

create view public.employee_directory
with (security_invoker = true)
as
select
  e.id,
  e.organization_id,
  e.employee_number,
  e.employee_number::text as employee_number_text,
  e.first_name,
  e.last_name,
  e.first_name || ' ' || e.last_name as full_name,
  e.department_id,
  d.name as department_name,
  e.job_title_id,
  j.name as job_title_name,
  e.user_id,
  p.username,
  e.status,
  e.created_at,
  e.archived_at,
  coalesce((
    select jsonb_agg(jsonb_build_object('skill_id', s.skill_id, 'name', c.name, 'level', s.level)
      order by c.name)
    from public.employee_skills s
    join public.catalog_items c on c.id = s.skill_id and c.organization_id = s.organization_id
    where s.employee_id = e.id
  ), '[]'::jsonb) as skills,
  coalesce((
    select jsonb_agg(jsonb_build_object('machine_id', em.machine_id, 'code', m.code, 'name', m.name)
      order by m.code)
    from public.employee_machines em
    join public.machines m on m.id = em.machine_id and m.organization_id = em.organization_id
    where em.employee_id = e.id
  ), '[]'::jsonb) as machines
from public.employees e
left join public.catalog_items d on d.id = e.department_id and d.organization_id = e.organization_id
left join public.catalog_items j on j.id = e.job_title_id and j.organization_id = e.organization_id
left join public.profiles p on p.id = e.user_id and p.organization_id = e.organization_id;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on
  public.catalog_items, public.machines, public.employees,
  public.employee_skills, public.employee_machines,
  public.machine_directory, public.employee_directory
from anon, authenticated;

grant select on
  public.catalog_items, public.machines, public.employees,
  public.employee_skills, public.employee_machines,
  public.machine_directory, public.employee_directory
to authenticated;

grant insert (organization_id, kind, name), update (name, archived_at)
  on public.catalog_items to authenticated;
grant insert (organization_id, code, name, type_id, manufacturer, model, location_id, status, notes),
  update (code, name, type_id, manufacturer, model, location_id, status, notes, archived_at)
  on public.machines to authenticated;
grant insert (organization_id, employee_number, first_name, last_name, department_id, job_title_id, user_id, status),
  update (employee_number, first_name, last_name, department_id, job_title_id, user_id, status, archived_at)
  on public.employees to authenticated;
grant insert (organization_id, employee_id, skill_id, level), update (level), delete
  on public.employee_skills to authenticated;
grant insert (organization_id, employee_id, machine_id), delete
  on public.employee_machines to authenticated;

revoke execute on function private.catalog_manage_permission(text) from public;
grant execute on function private.catalog_manage_permission(text) to authenticated;
revoke execute on function private.next_employee_number(uuid) from public;
grant execute on function private.next_employee_number(uuid) to authenticated;

revoke execute on function public.set_machine_status(uuid, text) from public, anon;
grant execute on function public.set_machine_status(uuid, text) to authenticated;
revoke execute on function
  public.save_employee(uuid, uuid, integer, text, text, uuid, uuid, uuid, text, jsonb, uuid[])
  from public, anon;
grant execute on function
  public.save_employee(uuid, uuid, integer, text, text, uuid, uuid, uuid, text, jsonb, uuid[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.catalog_items enable row level security;
alter table public.machines enable row level security;
alter table public.employees enable row level security;
alter table public.employee_skills enable row level security;
alter table public.employee_machines enable row level security;

-- catalog_items: names are needed wherever items are shown, so every member reads them.
create policy catalog_items_select on public.catalog_items
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy catalog_items_insert on public.catalog_items
  for insert to authenticated
  with check (private.has_permission(organization_id, private.catalog_manage_permission(kind)));

create policy catalog_items_update on public.catalog_items
  for update to authenticated
  using (private.has_permission(organization_id, private.catalog_manage_permission(kind)))
  with check (private.has_permission(organization_id, private.catalog_manage_permission(kind)));

-- machines
create policy machines_select on public.machines
  for select to authenticated
  using (private.has_permission(organization_id, 'machines.read'));

create policy machines_insert on public.machines
  for insert to authenticated
  with check (private.has_permission(organization_id, 'machines.manage'));

create policy machines_update on public.machines
  for update to authenticated
  using (private.has_permission(organization_id, 'machines.manage'))
  with check (private.has_permission(organization_id, 'machines.manage'));

-- employees: readers see all, everyone sees their own row.
create policy employees_select on public.employees
  for select to authenticated
  using (
    private.has_permission(organization_id, 'employees.read')
    or (user_id = (select auth.uid()) and organization_id in (select private.user_org_ids()))
  );

create policy employees_insert on public.employees
  for insert to authenticated
  with check (private.has_permission(organization_id, 'employees.manage'));

create policy employees_update on public.employees
  for update to authenticated
  using (private.has_permission(organization_id, 'employees.manage'))
  with check (private.has_permission(organization_id, 'employees.manage'));

-- employee_skills / employee_machines: same visibility as the employee.
create function private.is_own_employee(p_org_id uuid, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee_id
      and e.organization_id = p_org_id
      and e.user_id = (select auth.uid())
      and e.organization_id in (select private.user_org_ids())
  )
$$;

revoke execute on function private.is_own_employee(uuid, uuid) from public;
grant execute on function private.is_own_employee(uuid, uuid) to authenticated;

create policy employee_skills_select on public.employee_skills
  for select to authenticated
  using (
    private.has_permission(organization_id, 'employees.read')
    or private.is_own_employee(organization_id, employee_id)
  );

create policy employee_skills_insert on public.employee_skills
  for insert to authenticated
  with check (private.has_permission(organization_id, 'employees.manage'));

create policy employee_skills_update on public.employee_skills
  for update to authenticated
  using (private.has_permission(organization_id, 'employees.manage'))
  with check (private.has_permission(organization_id, 'employees.manage'));

create policy employee_skills_delete on public.employee_skills
  for delete to authenticated
  using (private.has_permission(organization_id, 'employees.manage'));

create policy employee_machines_select on public.employee_machines
  for select to authenticated
  using (
    private.has_permission(organization_id, 'employees.read')
    or private.is_own_employee(organization_id, employee_id)
  );

create policy employee_machines_insert on public.employee_machines
  for insert to authenticated
  with check (private.has_permission(organization_id, 'employees.manage'));

create policy employee_machines_delete on public.employee_machines
  for delete to authenticated
  using (private.has_permission(organization_id, 'employees.manage'));

comment on view public.machine_directory is
  'Machines with type and location names for list screens (security_invoker).';
comment on view public.employee_directory is
  'Employees with catalog names, account, skills and machines for list screens (security_invoker).';
