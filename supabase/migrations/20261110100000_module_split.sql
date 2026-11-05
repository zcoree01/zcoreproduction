-- Module split (D-049). Packages are sold as sets of modules, so the four
-- broad modules become ten: production → + planning, reports;
-- inventory → + finished_goods, tools; attendance → + kiosk, payroll.
-- Customers, machines and employees belong to core. Every firm keeps what it
-- had: the new keys are copied from the old ones with the same state and trial
-- end. module_dependencies says which module needs which (checked when a
-- package or a firm's modules are saved).

insert into public.modules (key, name) values
  ('planning', 'Planiranje'),
  ('reports', 'Izvještaji'),
  ('finished_goods', 'Gotova roba i otpremnice'),
  ('tools', 'Alati'),
  ('kiosk', 'Kiosk'),
  ('payroll', 'Obračun sati za plate')
on conflict (key) do nothing;

update public.modules set name = 'Osnova' where key = 'core';
update public.modules set name = 'Magacin materijala' where key = 'inventory';

create table public.module_dependencies (
  module_key text not null references public.modules (key) on delete restrict,
  requires text not null references public.modules (key) on delete restrict,
  primary key (module_key, requires),
  check (module_key <> requires)
);

alter table public.module_dependencies enable row level security;
revoke all on public.module_dependencies from anon, authenticated;
grant select on public.module_dependencies to authenticated;
create policy module_dependencies_select on public.module_dependencies
  for select to authenticated using (true);

insert into public.module_dependencies (module_key, requires) values
  ('planning', 'production'),
  ('finished_goods', 'production'),
  ('kiosk', 'attendance'),
  ('payroll', 'attendance');

insert into public.org_modules (organization_id, module_key, enabled, enabled_at, active_until)
select m.organization_id, s.new_key, m.enabled, m.enabled_at, m.active_until
from public.org_modules m
join (values
  ('production', 'planning'),
  ('production', 'reports'),
  ('inventory', 'finished_goods'),
  ('inventory', 'tools'),
  ('attendance', 'kiosk'),
  ('attendance', 'payroll')
) as s (old_key, new_key) on s.old_key = m.module_key
on conflict (organization_id, module_key) do nothing;

update public.permissions set module_key = 'reports' where key = 'reports.read';
update public.permissions set module_key = 'finished_goods' where key like 'finished\_goods.%';
update public.permissions set module_key = 'tools' where key like 'tools.%';
update public.permissions set module_key = 'kiosk' where key = 'kiosk.manage';
update public.permissions set module_key = 'payroll' where key like 'payroll.%';
update public.permissions set module_key = 'core'
where key like 'customers.%' or key like 'employees.%' or key like 'machines.%';

-- True when every module p_module requires is enabled for the organization.
create function private.module_requirements_met(p_org uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.module_dependencies d
    where d.module_key = p_module
      and not private.module_enabled(p_org, d.requires)
  )
$$;

revoke all on function private.module_requirements_met(uuid, text) from public;
grant execute on function private.module_requirements_met(uuid, text) to authenticated, service_role;

-- Finished goods and delivery notes: their own module now.
create or replace function private.assert_finished_access(p_org_id uuid, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission(p_org_id, p_permission) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not private.module_enabled(p_org_id, 'finished_goods') then
    raise exception 'module_disabled' using errcode = '42501';
  end if;
end;
$$;

-- Kiosk devices (clock and session) and their activation need the kiosk module.
create or replace function private.kiosk_device(p_org_slug text, p_kiosk_id uuid, p_secret text)
returns public.attendance_kiosks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_kiosks;
begin
  select k.* into v_row
  from public.attendance_kiosks k
  join public.organizations o on o.id = k.organization_id
  where k.id = p_kiosk_id and o.slug = p_org_slug
    and k.secret_hash is not null and k.secret_hash = private.sha256(p_secret)
    and k.revoked_at is null;
  if v_row.id is null then
    raise exception 'kiosk_unknown' using errcode = '42501';
  end if;
  if not private.module_enabled(v_row.organization_id, 'kiosk') then
    raise exception 'module_disabled' using errcode = '42501';
  end if;
  update public.attendance_kiosks set last_seen_at = now() where id = v_row.id;
  return v_row;
end;
$$;

create or replace function public.create_kiosk_activation(p_org_id uuid, p_kiosk_id uuid, p_name text)
returns table (kiosk_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_id uuid := p_kiosk_id;
  v_expires timestamptz := now() + interval '30 minutes';
begin
  if not private.has_permission(p_org_id, 'kiosk.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not private.module_enabled(p_org_id, 'kiosk') then
    raise exception 'module_disabled' using errcode = '42501';
  end if;
  -- A code identifies the company on kiosk.zcore.ba: never reuse one that
  -- is still stored (the unique index guards a concurrent clash).
  loop
    v_code := private.kiosk_code();
    exit when not exists (
      select 1 from public.attendance_kiosks k
      where k.activation_code_hash = private.sha256(v_code)
    );
  end loop;
  if v_id is null then
    if nullif(btrim(p_name), '') is null then
      raise exception 'name required' using errcode = '22023';
    end if;
    insert into public.attendance_kiosks (organization_id, name, activation_code_hash, activation_expires_at)
    values (p_org_id, btrim(p_name), private.sha256(v_code), v_expires)
    returning id into v_id;
  else
    update public.attendance_kiosks set
      activation_code_hash = private.sha256(v_code),
      activation_expires_at = v_expires,
      secret_hash = null,
      activated_at = null,
      revoked_at = null
    where id = v_id and organization_id = p_org_id;
    if not found then
      raise exception 'kiosk not found' using errcode = 'P0002';
    end if;
  end if;
  return query select v_id, v_code, v_expires;
end;
$$;
