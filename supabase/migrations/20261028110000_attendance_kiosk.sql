-- Shifts and working time, part C2: attendance kiosk (D-029).
--   * A shared tablet at the entrance clocks workers in and out without a
--     user login. An admin creates a kiosk and gets a one-time activation
--     code (30 minutes); the tablet redeems it and receives a device secret
--     (only its SHA-256 hash is stored) kept in an httpOnly cookie.
--   * Workers identify with a badge (QR code / NFC tag carrying a random
--     token) or by choosing their name and entering a 4-digit PIN (bcrypt,
--     locked for 5 minutes after 5 wrong attempts). A worker sets their own
--     PIN on the phone; kiosk.manage can set it and issue badges.
--   * The kiosk functions are executable by service_role only: the server
--     checks the device cookie and the tenant first. Each scan toggles
--     clock-in / clock-out (source 'kiosk'), with an idempotency key.

create extension if not exists pgcrypto with schema extensions;

insert into public.permissions (key, module_key, description, default_roles) values
  ('kiosk.manage', 'attendance', 'Activate kiosk tablets, set PINs and issue badges',
    '{admin,head_of_production}');

insert into public.role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'kiosk.manage'
from public.roles r
where r.is_system and r.key in ('admin', 'head_of_production')
on conflict do nothing;

create table public.attendance_kiosks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 60),
  activation_code_hash text,
  activation_expires_at timestamptz,
  secret_hash text,
  activated_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index attendance_kiosks_org_idx on public.attendance_kiosks (organization_id);

create table public.employee_kiosk_credentials (
  employee_id uuid primary key,
  organization_id uuid not null,
  pin_hash text,
  pin_set_at timestamptz,
  -- Random token printed as QR code / written to an NFC tag.
  badge_token text unique check (badge_token is null or badge_token ~ '^[a-f0-9]{24}$'),
  badge_issued_at timestamptz,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict
);

-- Audited without secrets.
create function private.audit_kiosk()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (new.organization_id, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'employee_id'), null,
    to_jsonb(new) - 'activation_code_hash' - 'secret_hash' - 'pin_hash' - 'badge_token');
  return null;
end;
$$;

create trigger attendance_kiosks_audit after insert or update on public.attendance_kiosks
  for each row execute function private.audit_kiosk();
create trigger employee_kiosk_credentials_audit
  after insert or update of pin_hash, badge_token on public.employee_kiosk_credentials
  for each row execute function private.audit_kiosk();

revoke all on public.attendance_kiosks, public.employee_kiosk_credentials from anon, authenticated;
alter table public.attendance_kiosks enable row level security;
alter table public.employee_kiosk_credentials enable row level security;
-- Read through the functions below only (secrets never leave the database,
-- the badge token only to kiosk.manage for printing).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.sha256(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(p_value, 'sha256'), 'hex')
$$;

-- Activation code: 8 characters without look-alikes (no 0/O, 1/I/L).
create function private.kiosk_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 31) + 1, 1), '')
  from (select extensions.gen_random_bytes(8) as b) as x
  cross join generate_series(0, 7) as i
$$;

create function private.clock_out_employee(p_employee_id uuid, p_source text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  select a.id into v_id from public.attendance_sessions a
  where a.organization_id = v_org and a.clock_out_key = p_idempotency_key;
  if v_id is not null then
    return v_id;
  end if;
  perform private.close_overdue_attendance(v_org);
  perform 1 from public.employees e where e.id = p_employee_id for update;
  v_id := private.open_attendance_session(p_employee_id);
  if v_id is null then
    raise exception 'not_clocked_in' using errcode = '55000';
  end if;
  update public.attendance_sessions set
    clock_out_at = greatest(now(), clock_in_at),
    clock_out_source = p_source,
    clock_out_by = auth.uid(),
    clock_out_key = p_idempotency_key
  where id = v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Management (kiosk.manage)
-- ---------------------------------------------------------------------------
-- Creates a kiosk (or renews the activation of an existing one, which signs
-- the old tablet out) and returns the one-time activation code.
create function public.create_kiosk_activation(p_org_id uuid, p_kiosk_id uuid, p_name text)
returns table (kiosk_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := private.kiosk_code();
  v_id uuid := p_kiosk_id;
  v_expires timestamptz := now() + interval '30 minutes';
begin
  if not private.has_permission(p_org_id, 'kiosk.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
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

create function public.revoke_kiosk(p_kiosk_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select k.organization_id into v_org from public.attendance_kiosks k where k.id = p_kiosk_id;
  if v_org is null or not private.has_permission(v_org, 'kiosk.manage') then
    raise exception 'kiosk not found' using errcode = 'P0002';
  end if;
  update public.attendance_kiosks set
    revoked_at = now(), secret_hash = null, activation_code_hash = null, activation_expires_at = null
  where id = p_kiosk_id;
end;
$$;

create function public.list_kiosks(p_org_id uuid)
returns table (
  id uuid,
  name text,
  status text,
  activated_at timestamptz,
  last_seen_at timestamptz,
  activation_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.name,
    case
      when k.revoked_at is not null then 'revoked'
      when k.secret_hash is not null then 'active'
      when k.activation_expires_at > now() then 'pending'
      else 'expired'
    end,
    k.activated_at, k.last_seen_at, k.activation_expires_at
  from public.attendance_kiosks k
  where k.organization_id = p_org_id and private.has_permission(p_org_id, 'kiosk.manage')
  order by k.revoked_at nulls first, k.created_at
$$;

-- Employees with their kiosk credentials (no PIN hashes; the badge token
-- for printing).
create function public.kiosk_credentials(p_org_id uuid)
returns table (
  employee_id uuid,
  employee_number integer,
  name text,
  has_pin boolean,
  badge_token text,
  locked_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.employee_number, e.first_name || ' ' || e.last_name,
    c.pin_hash is not null, c.badge_token,
    case when c.locked_until > now() then c.locked_until end
  from public.employees e
  left join public.employee_kiosk_credentials c on c.employee_id = e.id
  where e.organization_id = p_org_id and e.status = 'active' and e.archived_at is null
    and private.has_permission(p_org_id, 'kiosk.manage')
  order by e.last_name, e.first_name
$$;

create function private.store_pin(p_employee_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'invalid_pin' using errcode = '22023';
  end if;
  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  insert into public.employee_kiosk_credentials (employee_id, organization_id, pin_hash, pin_set_at)
  values (p_employee_id, v_org, extensions.crypt(p_pin, extensions.gen_salt('bf')), now())
  on conflict (employee_id) do update set
    pin_hash = excluded.pin_hash, pin_set_at = now(), failed_attempts = 0, locked_until = null;
end;
$$;

-- kiosk.manage sets a worker's PIN (or null to remove it).
create function public.set_employee_pin(p_employee_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  if v_org is null or not private.has_permission(v_org, 'kiosk.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_pin is null then
    update public.employee_kiosk_credentials set pin_hash = null, pin_set_at = null
    where employee_id = p_employee_id;
    return;
  end if;
  perform private.store_pin(p_employee_id, p_pin);
end;
$$;

-- The worker sets their own PIN.
create function public.set_own_pin(p_org_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid := private.current_employee(p_org_id);
begin
  if v_employee is null then
    raise exception 'not_an_employee' using errcode = '42501';
  end if;
  perform private.store_pin(v_employee, p_pin);
end;
$$;

-- Issues a new badge token (the old badge stops working).
create function public.issue_badge(p_employee_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_token text := encode(extensions.gen_random_bytes(12), 'hex');
begin
  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  if v_org is null or not private.has_permission(v_org, 'kiosk.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.employee_kiosk_credentials (employee_id, organization_id, badge_token, badge_issued_at)
  values (p_employee_id, v_org, v_token, now())
  on conflict (employee_id) do update set badge_token = excluded.badge_token, badge_issued_at = now();
  return v_token;
end;
$$;

-- Whether the caller has a PIN (for the worker's screen).
create function public.my_kiosk_pin_set(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employee_kiosk_credentials c
    where c.employee_id = private.current_employee(p_org_id) and c.pin_hash is not null
  )
$$;

-- ---------------------------------------------------------------------------
-- Kiosk device (service_role only; the server checks the device cookie)
-- ---------------------------------------------------------------------------
create function public.kiosk_activate(p_org_slug text, p_code text)
returns table (kiosk_id uuid, secret text, kiosk_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_kiosks;
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select k.* into v_row
  from public.attendance_kiosks k
  join public.organizations o on o.id = k.organization_id
  where o.slug = p_org_slug
    and k.activation_code_hash = private.sha256(upper(btrim(p_code)))
    and k.activation_expires_at > now()
    and k.revoked_at is null
  for update of k;
  if v_row.id is null then
    raise exception 'invalid_code' using errcode = 'P0002';
  end if;
  update public.attendance_kiosks set
    secret_hash = private.sha256(v_secret),
    activation_code_hash = null,
    activation_expires_at = null,
    activated_at = now(),
    last_seen_at = now()
  where id = v_row.id;
  return query select v_row.id, v_secret, v_row.name;
end;
$$;

create function private.kiosk_device(p_org_slug text, p_kiosk_id uuid, p_secret text)
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
  update public.attendance_kiosks set last_seen_at = now() where id = v_row.id;
  return v_row;
end;
$$;

-- The kiosk's organization and the names to choose from.
create function public.kiosk_session(p_org_slug text, p_kiosk_id uuid, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kiosk public.attendance_kiosks := private.kiosk_device(p_org_slug, p_kiosk_id, p_secret);
begin
  return jsonb_build_object(
    'kiosk_name', v_kiosk.name,
    'organization_name', (select o.name from public.organizations o where o.id = v_kiosk.organization_id),
    'timezone', (select o.timezone from public.organizations o where o.id = v_kiosk.organization_id),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.first_name || ' ' || e.last_name, 'number', e.employee_number,
        'has_pin', c.pin_hash is not null,
        'present', private.open_attendance_session(e.id) is not null
      ) order by e.last_name, e.first_name)
      from public.employees e
      left join public.employee_kiosk_credentials c on c.employee_id = e.id
      where e.organization_id = v_kiosk.organization_id and e.status = 'active'
        and e.archived_at is null
    ), '[]'::jsonb)
  );
end;
$$;

-- Identifies the worker (badge token or employee + PIN) and toggles
-- clock-in / clock-out. Returns the worker's name, the direction and time.
create function public.kiosk_clock(
  p_org_slug text,
  p_kiosk_id uuid,
  p_secret text,
  p_badge text,
  p_employee_id uuid,
  p_pin text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kiosk public.attendance_kiosks := private.kiosk_device(p_org_slug, p_kiosk_id, p_secret);
  v_employee uuid;
  v_cred public.employee_kiosk_credentials;
  v_direction text;
  v_session uuid;
  v_existing public.attendance_sessions;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if nullif(btrim(p_badge), '') is not null then
    select c.employee_id into v_employee
    from public.employee_kiosk_credentials c
    join public.employees e on e.id = c.employee_id
    where c.badge_token = lower(btrim(p_badge)) and c.organization_id = v_kiosk.organization_id
      and e.status = 'active' and e.archived_at is null;
    if v_employee is null then
      raise exception 'badge_unknown' using errcode = 'P0002';
    end if;
  else
    select c.* into v_cred
    from public.employee_kiosk_credentials c
    join public.employees e on e.id = c.employee_id
    where c.employee_id = p_employee_id and c.organization_id = v_kiosk.organization_id
      and e.status = 'active' and e.archived_at is null
    for update of c;
    if v_cred.employee_id is null or v_cred.pin_hash is null then
      raise exception 'pin_not_set' using errcode = 'P0002';
    end if;
    if v_cred.locked_until > now() then
      raise exception 'pin_locked' using errcode = '55000';
    end if;
    if p_pin is null or extensions.crypt(p_pin, v_cred.pin_hash) <> v_cred.pin_hash then
      update public.employee_kiosk_credentials set
        failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
        locked_until = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' end
      where employee_id = v_cred.employee_id;
      -- The attempt is recorded even though the request fails.
      return jsonb_build_object('error', case when v_cred.failed_attempts + 1 >= 5
        then 'pin_locked' else 'pin_wrong' end);
    end if;
    update public.employee_kiosk_credentials set failed_attempts = 0, locked_until = null
    where employee_id = v_cred.employee_id;
    v_employee := v_cred.employee_id;
  end if;

  -- A resend of the same scan returns the first result.
  select a.* into v_existing from public.attendance_sessions a
  where a.organization_id = v_kiosk.organization_id
    and (a.idempotency_key = p_idempotency_key or a.clock_out_key = p_idempotency_key);
  if v_existing.id is not null then
    v_session := v_existing.id;
    v_direction := case when v_existing.clock_out_key = p_idempotency_key then 'out' else 'in' end;
  elsif private.open_attendance_session(v_employee) is null then
    v_session := private.clock_in_employee(v_employee, 'kiosk', p_idempotency_key);
    v_direction := 'in';
  else
    v_session := private.clock_out_employee(v_employee, 'kiosk', p_idempotency_key);
    v_direction := 'out';
  end if;

  return (
    select jsonb_build_object(
      'employee_name', e.first_name || ' ' || e.last_name,
      'direction', v_direction,
      'at', case when v_direction = 'in' then a.clock_in_at else a.clock_out_at end,
      'shift_code', sh.code,
      'shift_name', sh.name
    )
    from public.attendance_sessions a
    join public.employees e on e.id = a.employee_id
    left join public.shifts sh on sh.id = a.shift_id
    where a.id = v_session
  );
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.audit_kiosk()',
    'private.sha256(text)',
    'private.kiosk_code()',
    'private.clock_out_employee(uuid, text, uuid)',
    'private.store_pin(uuid, text)',
    'private.kiosk_device(text, uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public', v_fn);
  end loop;
  foreach v_fn in array array[
    'public.create_kiosk_activation(uuid, uuid, text)',
    'public.revoke_kiosk(uuid)',
    'public.list_kiosks(uuid)',
    'public.kiosk_credentials(uuid)',
    'public.set_employee_pin(uuid, text)',
    'public.set_own_pin(uuid, text)',
    'public.issue_badge(uuid)',
    'public.my_kiosk_pin_set(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
  -- Device functions: the server only (after checking the cookie and tenant).
  foreach v_fn in array array[
    'public.kiosk_activate(text, text)',
    'public.kiosk_session(text, uuid, text)',
    'public.kiosk_clock(text, uuid, text, text, uuid, text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;
