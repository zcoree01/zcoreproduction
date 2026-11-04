-- Kiosk on its own host kiosk.zcore.ba (D-048).
--   * The tablet opens one address for every company; the one-time activation
--     code alone finds the company. Codes are therefore unique across all
--     organizations (partial unique index; the generator retries on a clash).
--   * kiosk_activate_code(): like kiosk_activate() without the tenant slug;
--     returns the slug so the server can bind the device cookie to it. Service
--     role only, called after the per-client rate limit (kind
--     'kiosk_activate' in registration_attempts).

create unique index attendance_kiosks_activation_code_uidx
  on public.attendance_kiosks (activation_code_hash)
  where activation_code_hash is not null;

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

create function public.kiosk_activate_code(p_code text)
returns table (kiosk_id uuid, secret text, kiosk_name text, org_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_kiosks;
  v_slug text;
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select k.* into v_row
  from public.attendance_kiosks k
  join public.organizations o on o.id = k.organization_id
  where k.activation_code_hash = private.sha256(upper(btrim(p_code)))
    and k.activation_expires_at > now()
    and k.revoked_at is null
    and o.archived_at is null
  for update of k;
  if v_row.id is null then
    raise exception 'invalid_code' using errcode = 'P0002';
  end if;
  select o.slug into v_slug from public.organizations o where o.id = v_row.organization_id;
  update public.attendance_kiosks set
    secret_hash = private.sha256(v_secret),
    activation_code_hash = null,
    activation_expires_at = null,
    activated_at = now(),
    last_seen_at = now()
  where id = v_row.id;
  return query select v_row.id, v_secret, v_row.name, v_slug;
end;
$$;

revoke execute on function public.kiosk_activate_code(text) from public, anon, authenticated;
grant execute on function public.kiosk_activate_code(text) to service_role;

alter table public.registration_attempts
  drop constraint registration_attempts_kind_check,
  add constraint registration_attempts_kind_check
    check (kind in ('slug_check', 'register', 'kiosk_activate'));
