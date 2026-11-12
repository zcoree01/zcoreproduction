-- Speed (D-062). The server cache of an organization's picker lists
-- (catalogs, materials, operation types, customers, machines, stock locations
-- and items) is keyed by a version per list. Every write to the tables behind
-- a list bumps its version, wherever it comes from (app, RPC, trigger, SQL,
-- the directory sync), so a cached list is never older than the data. The
-- versions are read together with the membership on every request.
--
-- Private: no tenant data, only counters; written by the triggers below.

create table private.org_cache_versions (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  version bigint not null default 1,
  primary key (organization_id, kind)
);

create function private.bump_org_cache_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
begin
  insert into private.org_cache_versions as v (organization_id, kind)
  values (v_org, tg_argv[0])
  on conflict (organization_id, kind) do update set version = v.version + 1;
  return null;
end;
$$;

revoke all on function private.bump_org_cache_version() from public;

create trigger org_cache_version after insert or update or delete on public.catalog_items
  for each row execute function private.bump_org_cache_version('catalogs');
create trigger org_cache_version after insert or update or delete on public.materials
  for each row execute function private.bump_org_cache_version('materials');
create trigger org_cache_version after insert or update or delete on public.material_groups
  for each row execute function private.bump_org_cache_version('materials');
create trigger org_cache_version after insert or update or delete on public.operation_types
  for each row execute function private.bump_org_cache_version('operation_types');
create trigger org_cache_version after insert or update or delete on public.customers
  for each row execute function private.bump_org_cache_version('customers');
-- Machines change status all day on the floor; only what the lists show counts.
create trigger org_cache_version after insert or delete on public.machines
  for each row execute function private.bump_org_cache_version('machines');
create trigger org_cache_version_update after update of code, name, archived_at on public.machines
  for each row execute function private.bump_org_cache_version('machines');
create trigger org_cache_version after insert or update or delete on public.stock_locations
  for each row execute function private.bump_org_cache_version('stock_locations');
create trigger org_cache_version after insert or update or delete on public.stock_items
  for each row execute function private.bump_org_cache_version('stock_items');

-- The caller's organization's versions ({} for anyone else).
create function public.org_cache_versions(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(v.kind, v.version), '{}'::jsonb)
  from private.org_cache_versions v
  where v.organization_id = p_org_id
    and p_org_id in (select private.user_org_ids())
$$;

revoke execute on function public.org_cache_versions(uuid) from public, anon;
grant execute on function public.org_cache_versions(uuid) to authenticated, service_role;
