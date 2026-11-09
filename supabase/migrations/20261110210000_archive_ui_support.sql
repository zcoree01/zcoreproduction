-- Archive screens support (D-049): the firm detail carries the archive fields,
-- and a deletion cannot be cancelled once its 30 days have passed.

-- Same as 20261110190000, plus: refused once delete_after has passed.
create or replace function public.platform_cancel_organization_deletion(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  perform private.require_platform_permission('platform.organizations.delete');
  perform private.assert_billable_org(p_org_id);
  select * into v_org from public.organizations o where o.id = p_org_id for update;
  if v_org.delete_after is null then
    raise exception 'not_scheduled' using errcode = '22023';
  end if;
  if v_org.delete_after <= now() then
    raise exception 'not_cancellable' using errcode = '22023';
  end if;
  update public.organizations set delete_after = null where id = p_org_id;
  perform private.billing_audit(private.platform_org_id(), 'organization.deletion_cancelled',
    p_org_id::text,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'delete_after', v_org.delete_after),
    null);
end;
$$;

-- platform_organization_billing: the live definition (patched by the permission
-- migration) is rewritten so its organization object also carries archived_at,
-- archived_reason and delete_after. Everything else stays identical.
do $$
declare
  v_def text;
  v_old constant text := '''archived'', v_org.archived_at is not null,';
  v_new constant text := '''archived'', v_org.archived_at is not null, '
    || '''archived_at'', v_org.archived_at, ''archived_reason'', v_org.archived_reason, '
    || '''delete_after'', v_org.delete_after,';
begin
  v_def := pg_get_functiondef('public.platform_organization_billing(uuid)'::regprocedure);
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then
    raise exception 'platform_organization_billing: expected exactly one archived field';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
