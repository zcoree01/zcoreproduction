-- Product owner (2026-11-08): tests must not leave organizations behind. The
-- registration tests (tests/db/company-directory, e2e/companies) create real
-- organizations; they were archived and piled up (45 removed by hand). This
-- removes one test organization completely: its rows in every tenant table,
-- its users (auth) and its directory entries no one else uses.
--
-- Service role only, and only for test registrations (slug dbt-reg-… / e2e-…):
-- it refuses every other organization. The audit log is append-only; its
-- delete guard is off for this one transaction.

create function public.purge_test_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_platform boolean;
  v_tables text[];
  v_table text;
  v_pass integer;
  v_left bigint;
  v_count bigint;
  v_users uuid[];
  v_companies uuid[];
begin
  select o.slug, o.is_platform into v_slug, v_platform
  from public.organizations o where o.id = p_org_id;
  if v_slug is null then
    return;
  end if;
  if v_platform or v_slug !~ '^(dbt-reg-|e2e-)' then
    raise exception 'not a test organization' using errcode = '42501';
  end if;

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

  alter table public.audit_log disable trigger audit_log_no_update_delete;

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
  alter table public.audit_log enable trigger audit_log_no_update_delete;

  delete from auth.users where id = any (v_users);
  delete from public.company_change_requests where company_id = any (v_companies);
  delete from public.company_bank_accounts b where b.company_id = any (v_companies)
    and not exists (select 1 from public.customers cu where cu.company_id = b.company_id)
    and not exists (select 1 from public.organizations o where o.company_id = b.company_id);
  delete from public.companies c where c.id = any (v_companies)
    and not exists (select 1 from public.customers cu where cu.company_id = c.id)
    and not exists (select 1 from public.organizations o where o.company_id = c.id);
end;
$$;

revoke all on function public.purge_test_organization(uuid) from public, anon, authenticated;
grant execute on function public.purge_test_organization(uuid) to service_role;
