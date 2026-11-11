-- Guard for rule 1 and D-049 (D-059): every public table with organization_id
-- must have row level security on and the lock_guard trigger. Nothing enforced
-- the trigger for tables added later; tests/db/tenant-tables.test.ts now calls
-- this function and fails on any row. Service role only.

create function public.tenant_table_gaps()
returns table (table_name text, missing text)
language sql
stable
security definer
set search_path = ''
as $$
  with tenant as (
    select c.oid, c.relname::text as name, c.relrowsecurity as rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = c.oid and a.attname = 'organization_id'
          and a.attnum > 0 and not a.attisdropped
      )
  )
  select t.name, 'row level security'
  from tenant t
  where not t.rls
  union all
  select t.name, 'lock_guard trigger'
  from tenant t
  where not exists (
    select 1 from pg_catalog.pg_trigger tg
    where tg.tgrelid = t.oid and tg.tgname = 'lock_guard' and not tg.tgisinternal
  )
  order by 1, 2
$$;
revoke all on function public.tenant_table_gaps() from public, anon, authenticated;
grant execute on function public.tenant_table_gaps() to service_role;
