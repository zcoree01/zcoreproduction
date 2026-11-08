-- Product owner (2026-11-08): a firm keeps only what its package has. Moving to
-- a smaller package already switched the other paid modules off; removing the
-- package left them on. Now it switches every paid module off as well (trial
-- modules with an end date stay). The platform screen warns before both.

create or replace function public.platform_assign_package(p_org_id uuid, p_package_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_before uuid;
begin
  perform private.require_platform_admin();
  perform private.assert_billable_org(p_org_id);
  if p_package_id is not null and not exists (
    select 1 from public.billing_packages p where p.id = p_package_id and p.archived_at is null
  ) then
    raise exception 'package not found' using errcode = 'P0002';
  end if;
  v_month := date_trunc('month', private.org_today(p_org_id))::date;
  v_before := private.org_package_on(p_org_id, v_month);
  insert into public.organization_packages (organization_id, valid_from, package_id)
  values (p_org_id, v_month, p_package_id)
  on conflict (organization_id, valid_from) do update set package_id = excluded.package_id;
  if p_package_id is null then
    if v_before is not null then
      update public.org_modules om set enabled = false
      where om.organization_id = p_org_id
        and om.enabled
        and om.active_until is null
        and om.module_key not in ('core', 'platform');
    end if;
  else
    perform private.sync_package_modules(p_org_id);
  end if;
  perform private.billing_audit(p_org_id, 'billing.package_assigned', p_package_id::text,
    jsonb_build_object('package_id', v_before), jsonb_build_object('package_id', p_package_id));
end;
$$;
