-- An open sick leave (no end date, 20261027140000) took part in the overlap
-- check as an unbounded range, so it collided with every planned absence
-- after it (e.g. approved vacation next week) and could not be reported.
-- While open it now counts as its first day only; closing it checks the
-- real period again (an overlap is refused with absence_overlaps).

alter table public.absences drop constraint absences_no_overlap;
alter table public.absences add constraint absences_no_overlap exclude using gist (
  employee_id with =,
  daterange(start_date, coalesce(end_date, start_date), '[]') with &&
) where (status in ('requested', 'approved'));

create or replace function public.close_sick_leave(p_absence_id uuid, p_last_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.absences;
  v_today date;
begin
  select * into v_row from public.absences a where a.id = p_absence_id for update;
  if v_row.id is null
    or not (private.is_own_employee(v_row.employee_id)
      or private.has_permission(v_row.organization_id, 'absences.manage')) then
    raise exception 'absence not found' using errcode = 'P0002';
  end if;
  if v_row.kind <> 'sick' or v_row.end_date is not null
    or v_row.status not in ('requested', 'approved') then
    raise exception 'sick_leave_not_open' using errcode = '55000';
  end if;
  select (now() at time zone o.timezone)::date into v_today
  from public.organizations o where o.id = v_row.organization_id;
  if p_last_day is null or p_last_day < v_row.start_date or p_last_day > v_today then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  begin
    update public.absences set end_date = p_last_day where id = p_absence_id;
  exception when exclusion_violation then
    raise exception 'absence_overlaps' using errcode = '23P01';
  end;
end;
$$;
