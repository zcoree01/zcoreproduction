-- Each platform write RPC requires its own platform permission instead of the
-- shared platform.read check. The current definition of every function is
-- patched in place so the latest body (and its grants) is kept.

do $$
declare
  v_old text := 'perform private.require_platform_admin();';
  v_item record;
  v_def text;
begin
  for v_item in
    select * from (values
      ('public.platform_set_module(uuid,text,boolean,timestamptz)', v_old,
        'perform private.require_platform_permission(''platform.modules.manage'');'),
      ('public.platform_assign_package(uuid,uuid)', v_old,
        'perform private.require_platform_permission(''platform.packages.assign'');'),
      ('public.platform_save_package(uuid,text,numeric,text[])', v_old,
        'perform private.require_platform_permission(''platform.packages.manage'');'),
      ('public.platform_set_package_archived(uuid,boolean)', v_old,
        'perform private.require_platform_permission(''platform.packages.manage'');'),
      ('public.platform_set_lock(uuid,boolean,text)', v_old,
        'perform private.require_platform_permission(''platform.lock'');'),
      ('public.platform_unlock_until(uuid,date)', v_old,
        'perform private.require_platform_permission(''platform.lock'');'),
      ('public.platform_set_org_billing(uuid,integer,boolean)', v_old,
        'perform private.require_platform_permission(''platform.lock'');'),
      ('public.platform_save_billing_settings(integer,integer,text)', v_old,
        'perform private.require_platform_permission(''platform.settings.manage'');'),
      ('public.platform_set_trial_days(integer)', v_old,
        'perform private.require_platform_permission(''platform.settings.manage'');'),
      ('public.platform_request_support(uuid,text)', v_old,
        'perform private.require_platform_permission(''platform.support'');'),
      ('public.platform_begin_support(uuid)', v_old,
        'perform private.require_platform_permission(''platform.support'');'),
      ('public.decide_company_change(uuid,uuid,boolean,text)',
        'coalesce(v_platform_org, false) and private.is_platform_admin()',
        'coalesce(v_platform_org, false) and private.has_platform_permission(''platform.directory.approve'')')
    ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(v_item.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, v_item.old_text, '')))
       <> length(v_item.old_text) then
      raise exception 'expected exactly one occurrence of the old check in %', v_item.fn;
    end if;
    execute replace(v_def, v_item.old_text, v_item.new_text);
  end loop;
end
$$;
