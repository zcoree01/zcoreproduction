-- Fixes from Supabase advisors after the foundation migrations.

-- Cover the composite tenant FK on role_permissions; it also serves the
-- organization_id lookups, so the single-column index is redundant.
create index role_permissions_organization_role_idx
  on public.role_permissions (organization_id, role_id);
drop index public.role_permissions_organization_id_idx;

-- Platform-created event trigger function (auto-enable RLS). Event triggers do
-- not check EXECUTE, so revoking it from API roles changes nothing functionally.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
