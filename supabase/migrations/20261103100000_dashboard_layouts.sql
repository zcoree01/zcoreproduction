-- Phase 5: configurable dashboard (D-037).
--   * dashboard.manage (core): the company admin chooses the widgets of each
--     role's dashboard.
--   * dashboard_layouts: one ordered widget list per role. Widget keys are
--     defined in the app (src/modules/dashboard/widgets.ts); the database
--     checks only their shape. A role without a row uses the app's default.
--   * Members read the layouts of their organization; writes only through
--     save_dashboard_layout / reset_dashboard_layout (permission, audit).
--   * A widget is shown only when the member also has the widget's own
--     permission: the layout never grants access to data.

insert into public.permissions (key, module_key, description, default_roles) values
  ('dashboard.manage', 'core', 'Choose the dashboard widgets of each role', '{admin}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, p.key
from public.roles r
join public.permissions p on r.key = any (p.default_roles)
where r.is_system and p.key = 'dashboard.manage'
on conflict do nothing;

-- An array of at most 40 {key, size} objects with distinct keys.
create function private.dashboard_widgets_valid(p_widgets jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_widget jsonb;
  v_keys text[] := '{}';
begin
  if p_widgets is null or jsonb_typeof(p_widgets) <> 'array'
    or jsonb_array_length(p_widgets) > 40 then
    return false;
  end if;
  for v_widget in select value from jsonb_array_elements(p_widgets) loop
    if jsonb_typeof(v_widget) <> 'object' then
      return false;
    end if;
    if (select count(*) from jsonb_object_keys(v_widget)) <> 2
      or coalesce(v_widget ->> 'key', '') !~ '^[a-z][a-z0-9_]{1,62}$'
      or coalesce(v_widget ->> 'size', '') not in ('normal', 'wide')
      or (v_widget ->> 'key') = any (v_keys) then
      return false;
    end if;
    v_keys := v_keys || (v_widget ->> 'key');
  end loop;
  return true;
end;
$$;

create table public.dashboard_layouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  role_id uuid not null,
  -- [{"key": "orders_late", "size": "wide"}, ...] in display order.
  widgets jsonb not null,
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, role_id),
  foreign key (organization_id, role_id)
    references public.roles (organization_id, id) on delete restrict,
  constraint dashboard_layouts_widgets_check check (private.dashboard_widgets_valid(widgets))
);

create trigger dashboard_layouts_set_updated_at before update on public.dashboard_layouts
  for each row execute function private.set_updated_at();
create trigger dashboard_layouts_audit after insert or update or delete on public.dashboard_layouts
  for each row execute function private.audit_row_change();

revoke all on public.dashboard_layouts from anon, authenticated;
grant select on public.dashboard_layouts to authenticated;

alter table public.dashboard_layouts enable row level security;

create policy dashboard_layouts_select on public.dashboard_layouts
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create function public.save_dashboard_layout(p_org_id uuid, p_role_id uuid, p_widgets jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'dashboard.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.roles r
    where r.id = p_role_id and r.organization_id = p_org_id and r.archived_at is null
  ) then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if not private.dashboard_widgets_valid(p_widgets) then
    raise exception 'invalid_widgets' using errcode = '22023';
  end if;

  insert into public.dashboard_layouts (organization_id, role_id, widgets)
  values (p_org_id, p_role_id, p_widgets)
  on conflict (organization_id, role_id) do update
    set widgets = excluded.widgets, updated_by = auth.uid();
end;
$$;

-- Back to the app's default for the role.
create function public.reset_dashboard_layout(p_org_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'dashboard.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  delete from public.dashboard_layouts
  where organization_id = p_org_id and role_id = p_role_id;
end;
$$;

revoke execute on function public.save_dashboard_layout(uuid, uuid, jsonb),
  public.reset_dashboard_layout(uuid, uuid) from public, anon;
grant execute on function public.save_dashboard_layout(uuid, uuid, jsonb),
  public.reset_dashboard_layout(uuid, uuid) to authenticated;
