-- Permanent deletion of a firm 30 days after the deletion was confirmed (D-049).
-- The daily cron (/api/cron/purge-organizations) removes the firm's Storage
-- files and then calls public.purge_organization, which removes every row of
-- the firm in every tenant table and its users. The rows deleted here are
-- the same as public.purge_test_organization (its body moves into
-- private.purge_organization_rows), except that the directory entries
-- (companies, company_bank_accounts) stay: they are public business data that
-- other firms may use. Payment records (platform_payment_records, no
-- organization_id) stay as well.

create function private.purge_organization_rows(p_org_id uuid, p_remove_directory boolean)
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

-- Same checks as 20261110160000_purge_test_organization.sql; the deletes moved
-- into private.purge_organization_rows (directory entries removed as before).
create or replace function public.purge_test_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_platform boolean;
begin
  select o.slug, o.is_platform into v_slug, v_platform
  from public.organizations o where o.id = p_org_id;
  if v_slug is null then
    return;
  end if;
  if v_platform or v_slug !~ '^(dbt-reg-|e2e-)' then
    raise exception 'not a test organization' using errcode = '42501';
  end if;
  perform private.purge_organization_rows(p_org_id, true);
end;
$$;

revoke all on function public.purge_test_organization(uuid) from public, anon, authenticated;
grant execute on function public.purge_test_organization(uuid) to service_role;

-- Service role only (the cron route). Refuses a firm that is not archived,
-- not scheduled, not yet due, or the platform itself; false when the firm is
-- already gone (a second run is harmless). The audit row goes to the Zcore
-- firm: every audit row of the purged firm is removed with it.
create function public.purge_organization(p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_platform uuid;
  v_members integer;
begin
  select * into v_org from public.organizations o where o.id = p_org_id for update;
  if v_org.id is null then
    return false;
  end if;
  if v_org.is_platform or v_org.archived_at is null
    or v_org.delete_after is null or v_org.delete_after > now() then
    raise exception 'not_due' using errcode = '42501';
  end if;
  v_platform := private.platform_org_id();
  if v_platform is null then
    raise exception 'platform organization missing';
  end if;

  select count(*)::integer into v_members
  from public.memberships m where m.organization_id = p_org_id;
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_platform, null, 'organization.purged', 'billing', p_org_id::text,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'member_count', v_members,
      'archived_at', v_org.archived_at, 'delete_after', v_org.delete_after),
    null);

  perform private.purge_organization_rows(p_org_id, false);
  return true;
end;
$$;

revoke all on function public.purge_organization(uuid) from public, anon, authenticated;
grant execute on function public.purge_organization(uuid) to service_role;
