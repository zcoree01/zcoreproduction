-- Problem reports, screens (Zcore organization, part 3).
--
-- 1. Bell items for the decision on a proposed support session are keyed
--    `session:<request id>:<decision>`; the key check of notification_reads
--    allows that optional suffix (existing keys stay valid).
-- 2. The reporter sees the support sessions Zcore proposed from their own
--    reports (support_access_requests itself is readable only with
--    support.approve): start, duration and the state of the approval.

alter table public.notification_reads
  drop constraint notification_reads_item_key_check,
  add constraint notification_reads_item_key_check
    check (item_key ~ '^[a-z_]{1,30}:[0-9a-f-]{36}(:[a-z_]{1,30})?$');

create function public.my_problem_report_sessions(p_org uuid)
returns table (
  id uuid,
  problem_report_id uuid,
  status text,
  scheduled_start timestamptz,
  duration_minutes integer,
  approved_until timestamptz,
  reason text,
  created_at timestamptz,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not exists (select 1 from private.user_org_ids() as o (id) where o.id = p_org) then
    return;
  end if;
  return query
  select a.id, a.problem_report_id,
    case
      when a.status in ('approved', 'active') and a.approved_until <= now() then 'ended'
      when a.status = 'pending' and a.scheduled_start is not null
        and a.scheduled_start + make_interval(mins => a.duration_minutes) <= now() then 'cancelled'
      else a.status
    end,
    a.scheduled_start, a.duration_minutes, a.approved_until, a.reason, a.created_at, a.decided_at
  from public.support_access_requests a
  join public.problem_reports r
    on r.id = a.problem_report_id and r.organization_id = a.organization_id
  where a.organization_id = p_org
    and r.created_by = auth.uid()
  order by a.created_at desc
  limit 100;
end;
$$;

revoke all on function public.my_problem_report_sessions(uuid) from public, anon;
grant execute on function public.my_problem_report_sessions(uuid) to authenticated;
