-- my_requests (20261027120000) listed only absences touching p_year (plus
-- open requests), so a worker did not see a decided absence planned for next
-- year. Now: every absence that ends in p_year or later, and older ones only
-- while still requested.
create or replace function public.my_requests(p_org_id uuid, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee uuid := private.current_employee(p_org_id);
begin
  if v_employee is null then
    return null;
  end if;
  return jsonb_build_object(
    'absences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'start_date', a.start_date, 'end_date', a.end_date,
        'status', a.status, 'note', a.note, 'decision_note', a.decision_note,
        'working_days', private.working_days(a.start_date, a.end_date),
        'requested_at', a.requested_at,
        'has_document', d.document_path is not null
      ) order by a.start_date desc)
      from public.absences a
      left join public.absence_details d on d.absence_id = a.id
      where a.employee_id = v_employee
        and (a.end_date >= make_date(p_year, 1, 1) or a.status = 'requested')
    ), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'session_id', c.session_id, 'clock_in_at', c.clock_in_at,
        'clock_out_at', c.clock_out_at, 'reason', c.reason, 'status', c.status,
        'decision_note', c.decision_note, 'requested_at', c.requested_at
      ) order by c.requested_at desc)
      from public.attendance_corrections c
      where c.employee_id = v_employee and c.requested_at > now() - interval '120 days'
    ), '[]'::jsonb),
    'leave', private.leave_data(v_employee, p_year)
  );
end;
$$;
