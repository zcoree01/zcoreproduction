-- Foundation schema: tenants, users, roles, permissions, audit log, modules.
-- RLS and grants are in 20261023160200_foundation_rls.sql.

create schema if not exists private;
revoke all on schema private from public;
alter default privileges in schema private revoke execute on functions from public;

-- Used by CHECK constraints, so it lives with the schema.
create function private.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz)
$$;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  timezone text not null default 'Europe/Sarajevo'
    check (private.is_valid_timezone(timezone)),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.organizations is 'Tenant root. Every tenant table references it via organization_id.';

-- ---------------------------------------------------------------------------
-- Global catalogs (not tenant data)
-- ---------------------------------------------------------------------------
create table public.modules (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.permissions (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  module_key text not null references public.modules (key) on delete restrict,
  description text not null,
  -- System role keys that receive this permission when an organization is created.
  default_roles text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index permissions_module_key_idx on public.permissions (module_key);

-- ---------------------------------------------------------------------------
-- Roles and permissions per organization
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, key),
  -- Target for composite FKs that keep references inside one tenant.
  unique (organization_id, id)
);

create table public.role_permissions (
  organization_id uuid not null,
  role_id uuid not null,
  permission_key text not null references public.permissions (key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key),
  foreign key (organization_id, role_id)
    references public.roles (organization_id, id) on delete restrict
);

create index role_permissions_organization_id_idx on public.role_permissions (organization_id);
create index role_permissions_permission_key_idx on public.role_permissions (permission_key);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
-- One auth user per organization (synthetic e-mail <username>@<slug>.users.zcore.ba).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  username text not null
    check (username ~ '^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$'),
  full_name text check (full_name is null or length(btrim(full_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, username),
  unique (organization_id, id)
);

-- One role per member. Deactivating a user = archiving the membership.
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null,
  role_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, user_id),
  foreign key (organization_id, user_id)
    references public.profiles (organization_id, id) on delete restrict,
  foreign key (organization_id, role_id)
    references public.roles (organization_id, id) on delete restrict
);

create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_organization_role_idx on public.memberships (organization_id, role_id);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- No FK: audit rows must outlive the users who created them. Null = system/service.
  actor_id uuid,
  action text not null check (length(action) between 1 and 100),
  entity_type text not null check (length(entity_type) between 1 and 100),
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_organization_created_idx on public.audit_log (organization_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (organization_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Modules enabled per organization (commercial activation)
-- ---------------------------------------------------------------------------
create table public.org_modules (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  module_key text not null references public.modules (key) on delete restrict,
  enabled boolean not null default true,
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, module_key)
);

create index org_modules_module_key_idx on public.org_modules (module_key);

-- ---------------------------------------------------------------------------
-- Reference data (needed in every environment, so it is not in seed.sql)
-- ---------------------------------------------------------------------------
insert into public.modules (key, name) values
  ('core', 'Zcore Core');

insert into public.permissions (key, module_key, description, default_roles) values
  ('org.settings.manage', 'core', 'Manage organization settings', '{admin}'),
  ('users.read', 'core', 'View users and memberships', '{admin,director,head_of_production}'),
  ('users.manage', 'core', 'Create, edit and deactivate users', '{admin}'),
  ('roles.manage', 'core', 'Manage custom roles and their permissions', '{admin}'),
  ('audit.read', 'core', 'View the audit log', '{admin,director}');
