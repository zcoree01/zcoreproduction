-- Package list for the platform screens (D-049): current price, modules and
-- how many firms have the package this month. Platform admin only. Plus the
-- covering indexes the advisor lists for the new small tables.

create function public.platform_billing_packages()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'monthly_price', private.package_price_on(p.id, date_trunc('month', now() at time zone 'UTC')::date),
      'modules', coalesce((
        select jsonb_agg(pm.module_key order by pm.module_key)
        from public.billing_package_modules pm where pm.package_id = p.id
      ), '[]'::jsonb),
      'archived', p.archived_at is not null,
      'organization_count', (
        select count(*)::integer from public.organizations o
        where private.org_package_on(o.id, date_trunc('month', private.org_today(o.id))::date) = p.id
      )
    ) order by p.archived_at nulls first, p.name)
    from public.billing_packages p
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.platform_billing_packages() from public, anon;
grant execute on function public.platform_billing_packages() to authenticated, service_role;

create index if not exists billing_package_modules_module_key_idx
  on public.billing_package_modules (module_key);
create index if not exists module_dependencies_requires_idx
  on public.module_dependencies (requires);
