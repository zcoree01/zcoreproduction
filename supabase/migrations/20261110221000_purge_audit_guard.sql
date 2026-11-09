-- Purge without a table lock on audit_log (D-050, final review).
-- private.purge_organization_rows disabled the append-only trigger with
-- ALTER TABLE, which locks audit_log against every insert (every audited
-- write of every firm) until the purge commits, and makes PostgREST reload
-- its schema cache. Instead the purge sets a transaction-local marker with
-- the id of the firm being purged; the trigger lets a DELETE through only for
-- that firm's rows, only while the marker is set, and only when running as
-- the owner of the purge function (security definer). Updates, truncates and
-- every other delete are still refused.

-- Same as 20261023160100_foundation_functions.sql, plus the purge exception.
create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and old.organization_id::text = current_setting('zcore.purge_organization', true)
    and current_user = (
      select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
      where p.oid = 'private.purge_organization_rows(uuid, boolean)'::regprocedure
    ) then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

-- Same as 20261110200000_purge_organization.sql, except: no ALTER TABLE on
-- audit_log; the marker above is set for the deletes and cleared after them.
create or replace function private.purge_organization_rows(p_org_id uuid, p_remove_directory boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables text[];
  v_table text;
  v_pass integer;
  v_left bigint;
  v_count bigint;
  v_users uuid[];
  v_companies uuid[];
begin
  select coalesce(array_agg(p.id), '{}') into v_users
  from public.profiles p
  where p.organization_id = p_org_id
    and not exists (select 1 from public.memberships m
                    where m.user_id = p.id and m.organization_id <> p_org_id);
  select coalesce(array_agg(c.id), '{}') into v_companies
  from public.companies c
  where c.owner_organization_id = p_org_id or c.created_by_organization_id = p_org_id;

  select array_agg(format('%I.%I', c.table_schema, c.table_name)) into v_tables
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.column_name = 'organization_id' and t.table_type = 'BASE TABLE'
    and c.table_schema in ('public', 'private');

  perform pg_catalog.set_config('zcore.purge_organization', p_org_id::text, true);

  update public.companies set owner_organization_id = null where owner_organization_id = p_org_id;
  update public.companies set created_by_organization_id = null where created_by_organization_id = p_org_id;
  delete from public.company_change_requests where requested_by_organization_id = p_org_id;

  -- Restricting foreign keys: repeat until every table is empty for the
  -- organization (deletes may write audit rows, removed in the next pass).
  for v_pass in 1..30 loop
    v_left := 0;
    foreach v_table in array v_tables loop
      begin
        execute format('delete from %s where organization_id = $1', v_table) using p_org_id;
      exception when foreign_key_violation then
        null;
      end;
      execute format('select count(*) from %s where organization_id = $1', v_table)
        into v_count using p_org_id;
      v_left := v_left + v_count;
    end loop;
    exit when v_left = 0;
  end loop;
  if v_left > 0 then
    raise exception 'rows left after purge: %', v_left;
  end if;

  delete from public.organizations where id = p_org_id;
  delete from public.audit_log where organization_id = p_org_id;
  perform pg_catalog.set_config('zcore.purge_organization', '', true);

  delete from auth.users where id = any (v_users);
  if p_remove_directory then
    delete from public.company_change_requests where company_id = any (v_companies);
    delete from public.company_bank_accounts b where b.company_id = any (v_companies)
      and not exists (select 1 from public.customers cu where cu.company_id = b.company_id)
      and not exists (select 1 from public.organizations o where o.company_id = b.company_id);
    delete from public.companies c where c.id = any (v_companies)
      and not exists (select 1 from public.customers cu where cu.company_id = c.id)
      and not exists (select 1 from public.organizations o where o.company_id = c.id);
  end if;
end;
$$;

revoke all on function private.purge_organization_rows(uuid, boolean)
  from public, anon, authenticated, service_role;
