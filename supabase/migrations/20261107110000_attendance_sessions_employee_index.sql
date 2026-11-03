-- report_production (20261107100000) looks up the attendance session of a
-- worker at a moment by employee and clock-in time, without the organization.
create index attendance_sessions_employee_clock_in_idx
  on public.attendance_sessions (employee_id, clock_in_at desc);
