-- The organization lock (D-049) also covers the shared company directory and
-- Storage uploads (D-060). These were outside it: the directory tables have no
-- organization_id (so no lock_guard), and Storage is not a tenant table.
--
-- Directory: one BEFORE trigger on companies, company_bank_accounts and
-- company_change_requests refuses writes by a member whose own organization is
-- locked. Same exceptions as lock_guard: the service role (registration,
-- scripts) and the platform admin.
-- Storage: the upload policies of the organization buckets also require the
-- organization in the path to be unlocked. Problem report screenshots stay
-- allowed (a locked firm can still report a problem, D-051).

-- The acting member's organization is locked (never for the platform admin).
create function private.actor_org_locked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.is_platform_admin()
    and coalesce((
      select private.org_locked(p.organization_id)
      from public.profiles p
      where p.id = (select auth.uid())
    ), false)
$$;
revoke all on function private.actor_org_locked() from public, anon;
grant execute on function private.actor_org_locked() to authenticated;

create function private.directory_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and private.actor_org_locked() then
    raise exception 'organization_locked' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.directory_lock_guard() from public, anon;

create trigger directory_lock_guard before insert or update or delete on public.companies
  for each row execute function private.directory_lock_guard();
create trigger directory_lock_guard before insert or update or delete on public.company_bank_accounts
  for each row execute function private.directory_lock_guard();
create trigger directory_lock_guard before insert or update or delete on public.company_change_requests
  for each row execute function private.directory_lock_guard();

-- The organization of a Storage path (<organization_id>/…) is locked.
create function private.storage_org_locked(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.is_platform_admin()
    and coalesce(private.org_locked(private.storage_org_id(p_name)), false)
$$;
revoke all on function private.storage_org_locked(text) from public, anon;
grant execute on function private.storage_org_locked(text) to authenticated;

drop policy product_files_insert on storage.objects;
create policy product_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-files'
    and private.has_permission(private.storage_org_id(name), 'products.manage')
    and not private.storage_org_locked(name)
  );

drop policy absence_documents_insert on storage.objects;
create policy absence_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'absence-documents'
    and private.can_upload_absence_file(name)
    and not private.storage_org_locked(name)
  );

drop policy stock_certificates_insert on storage.objects;
create policy stock_certificates_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'stock-certificates'
    and private.has_permission(private.storage_org_id(name), 'inventory.move')
    and not private.storage_org_locked(name)
  );

drop policy organization_files_insert on storage.objects;
create policy organization_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'organization-files'
    and private.has_permission(private.storage_org_id(name), 'org.settings.manage')
    and not private.storage_org_locked(name)
  );
