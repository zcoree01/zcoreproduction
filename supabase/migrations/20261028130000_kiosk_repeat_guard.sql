-- Kiosk review (D-030): a card held at the NFC reader was read several times
-- and every read toggled clock-in / clock-out, so the result looked random.
-- Besides the tablet's 3-second pause after a scan, the database now repeats
-- the last result (flag `repeat`) when the same worker is identified again
-- within 10 seconds, instead of toggling. Same as 20261028110000 otherwise.

create or replace function public.kiosk_clock(
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
  v_last public.attendance_sessions;
  v_repeat boolean := false;
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

  -- The worker's latest attendance event (clock-in or clock-out).
  select a.* into v_last from public.attendance_sessions a
  where a.employee_id = v_employee and a.archived_at is null
  order by greatest(a.clock_in_at, coalesce(a.clock_out_at, a.clock_in_at)) desc
  limit 1;

  -- A resend of the same scan returns the first result.
  select a.* into v_existing from public.attendance_sessions a
  where a.organization_id = v_kiosk.organization_id
    and (a.idempotency_key = p_idempotency_key or a.clock_out_key = p_idempotency_key);
  if v_existing.id is not null then
    v_session := v_existing.id;
    v_direction := case when v_existing.clock_out_key = p_idempotency_key then 'out' else 'in' end;
  elsif v_last.id is not null
    and greatest(v_last.clock_in_at, coalesce(v_last.clock_out_at, v_last.clock_in_at))
      > now() - interval '10 seconds' then
    -- The same worker again within 10 seconds (card held at the reader, a
    -- second tablet, a double tap): repeat the last result, do not toggle.
    v_session := v_last.id;
    v_direction := case when v_last.clock_out_at is null then 'in' else 'out' end;
    v_repeat := true;
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
      'shift_name', sh.name,
      'repeat', v_repeat
    )
    from public.attendance_sessions a
    join public.employees e on e.id = a.employee_id
    left join public.shifts sh on sh.id = a.shift_id
    where a.id = v_session
  );
end;
$$;
