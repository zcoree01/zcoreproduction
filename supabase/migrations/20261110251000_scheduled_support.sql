-- Scheduled support sessions (Zcore organization, part 3).
--
-- Zcore proposes a time window from a problem report (start >= now, 15..480
-- minutes, reason). The firm's admin / director (support.approve) approves it
-- any time before the window ends; approved_until = scheduled_start + duration.
-- "Enter the firm" works only from scheduled_start. A window that has passed
-- without approval expires (cancelled); an approved / active one whose end has
-- passed becomes ended. Every function below starts from its CURRENT
-- definition (see the migration that last changed it).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.support_access_requests
  add column scheduled_start timestamptz,
  add column problem_report_id uuid,
  add constraint support_access_requests_report_fkey
    foreign key (organization_id, problem_report_id)
    references public.problem_reports (organization_id, id) on delete restrict,
  add constraint support_access_requests_scheduled_check
    check (scheduled_start is null or duration_minutes is not null);

create index support_access_requests_report_idx
  on public.support_access_requests (problem_report_id)
  where problem_report_id is not null;

-- ---------------------------------------------------------------------------
-- Expiry (p_org null = every organization)
-- ---------------------------------------------------------------------------
create function private.expire_support_requests(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A proposed window that ended without approval.
  update public.support_access_requests r
  set status = 'cancelled', ended_at = r.scheduled_start + make_interval(mins => r.duration_minutes)
  where r.status = 'pending'
    and r.scheduled_start is not null
    and r.scheduled_start + make_interval(mins => r.duration_minutes) <= now()
    and (p_org is null or r.organization_id = p_org);
  -- An approved or running session whose end has passed.
  update public.support_access_requests r
  set status = 'ended', ended_at = r.approved_until
  where r.status in ('approved', 'active')
    and r.approved_until <= now()
    and (p_org is null or r.organization_id = p_org);
end;
$$;

revoke execute on function private.expire_support_requests(uuid) from public, anon, authenticated;

-- The support account is usable only once the scheduled window has begun.
create or replace function private.support_active(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.support_access_requests r
    where r.organization_id = p_org_id
      and r.status in ('approved', 'active')
      and r.approved_until > now()
      and (r.scheduled_start is null or r.scheduled_start <= now())
  )
$$;

-- ---------------------------------------------------------------------------
-- platform_request_support: expire first (patched in place, keeps grants)
-- ---------------------------------------------------------------------------
do $$
declare
  v_old text := 'perform private.require_platform_permission(''platform.support'');';
  v_def text := pg_get_functiondef('public.platform_request_support(uuid,text)'::regprocedure);
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then
    raise exception 'expected exactly one permission check in platform_request_support';
  end if;
  execute replace(v_def, v_old, v_old || E'\n  perform private.expire_support_requests(p_org_id);');
end
$$;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
create function public.platform_schedule_support_session(
  p_report_id uuid, p_start timestamptz, p_minutes integer, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_report public.problem_reports;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
  v_id uuid;
begin
  perform private.require_platform_permission('platform.reports.manage');
  perform private.require_platform_permission('platform.support');
  select * into v_report from public.problem_reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if p_start is null or p_start < now() - interval '1 minute'
    or p_minutes is null or p_minutes not between 15 and 480
    or length(v_reason) not between 1 and 1000 then
    raise exception 'invalid session' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.organizations o
    where o.id = v_report.organization_id and (o.is_platform or o.archived_at is not null)
  ) then
    raise exception 'organization not available' using errcode = '22023';
  end if;

  perform private.expire_support_requests(v_report.organization_id);
  if exists (
    select 1 from public.support_access_requests s
    where s.organization_id = v_report.organization_id
      and s.status in ('pending', 'approved', 'active')
  ) then
    raise exception 'support_open' using errcode = '22023';
  end if;

  select coalesce(p.full_name, p.username) into v_name from public.profiles p where p.id = v_uid;
  insert into public.support_access_requests (
    organization_id, requested_by, requester_name, reason, duration_minutes,
    scheduled_start, problem_report_id
  )
  values (
    v_report.organization_id, v_uid, coalesce(v_name, 'Zcore'), v_reason, p_minutes,
    p_start, p_report_id
  )
  returning id into v_id;

  insert into public.problem_report_messages (organization_id, report_id, author_id, from_zcore, body)
  values (v_report.organization_id, p_report_id, v_uid, true, v_reason);
  update public.problem_reports
  set status = 'waiting_user', resolved_at = null, last_message_at = now(), updated_at = now()
  where id = p_report_id;

  perform private.write_audit_as(v_report.organization_id, 'support.scheduled',
    'support_access_requests', v_id::text, null,
    jsonb_build_object('reason', v_reason, 'requester', v_name, 'scheduled_start', p_start,
      'minutes', p_minutes, 'problem_report_id', p_report_id));
  return v_id;
end;
$$;

revoke execute on function public.platform_schedule_support_session(uuid, timestamptz, integer, text)
  from public, anon;
grant execute on function public.platform_schedule_support_session(uuid, timestamptz, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- decide_support_request: a scheduled request keeps its own window
-- ---------------------------------------------------------------------------
create or replace function public.decide_support_request(
  p_org_id uuid, p_request_id uuid, p_approve boolean, p_minutes integer default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.support_access_requests;
  v_minutes integer;
begin
  if not private.has_permission(p_org_id, 'support.approve') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform private.expire_support_requests(p_org_id);
  select * into v_request from public.support_access_requests
  where id = p_request_id and organization_id = p_org_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'request not found or already decided' using errcode = 'P0002';
  end if;
  -- p_minutes is ignored for a scheduled request.
  v_minutes := case when v_request.scheduled_start is not null then v_request.duration_minutes
                    else p_minutes end;
  if p_approve and (v_minutes is null or v_minutes not between 15 and 480) then
    raise exception 'duration must be 15..480 minutes' using errcode = '22023';
  end if;

  update public.support_access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      duration_minutes = case when p_approve then v_minutes else duration_minutes end,
      approved_until = case when not p_approve then null
                            when v_request.scheduled_start is not null
                              then v_request.scheduled_start + make_interval(mins => v_minutes)
                            else now() + make_interval(mins => v_minutes) end,
      decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(btrim(p_note), '')
  where id = p_request_id;

  perform private.write_audit_as(p_org_id,
    case when p_approve then 'support.approved' else 'support.rejected' end,
    'support_access_requests', p_request_id::text, null,
    jsonb_build_object('minutes', case when p_approve then v_minutes end,
      'note', nullif(btrim(p_note), '')));
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_begin_support: not before the scheduled start
-- ---------------------------------------------------------------------------
create or replace function public.platform_begin_support(p_request_id uuid)
returns table (organization_id uuid, slug text, approved_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.support_access_requests;
begin
  perform private.require_platform_permission('platform.support');
  perform private.expire_support_requests(
    (select r.organization_id from public.support_access_requests r where r.id = p_request_id));
  select * into v_request from public.support_access_requests where id = p_request_id for update;
  if not found or v_request.status not in ('approved', 'active') or v_request.approved_until <= now() then
    raise exception 'support access is not approved' using errcode = '42501';
  end if;
  if v_request.scheduled_start is not null and v_request.scheduled_start > now() then
    raise exception 'not_started' using errcode = '22023';
  end if;
  update public.support_access_requests
  set status = 'active', started_at = coalesce(started_at, now())
  where id = p_request_id;
  perform private.write_audit_as(v_request.organization_id, 'support.started',
    'support_access_requests', p_request_id::text, null, null);
  return query
  select o.id, o.slug, v_request.approved_until
  from public.organizations o where o.id = v_request.organization_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- platform_support_requests / pending_support_requests: two more columns
-- ---------------------------------------------------------------------------
drop function public.platform_support_requests();

create function public.platform_support_requests()
returns table (
  id uuid,
  organization_id uuid,
  status text,
  reason text,
  requester_name text,
  duration_minutes integer,
  approved_until timestamptz,
  decision_note text,
  created_at timestamptz,
  scheduled_start timestamptz,
  problem_report_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  perform private.expire_support_requests(null);
  return query
  select distinct on (r.organization_id)
    r.id, r.organization_id,
    case when r.status in ('approved', 'active') and r.approved_until <= now() then 'ended' else r.status end,
    r.reason, r.requester_name, r.duration_minutes, r.approved_until, r.decision_note, r.created_at,
    r.scheduled_start, r.problem_report_id
  from public.support_access_requests r
  order by r.organization_id, r.created_at desc;
end;
$$;

revoke execute on function public.platform_support_requests() from public, anon;
grant execute on function public.platform_support_requests() to authenticated;

drop function public.pending_support_requests(uuid);

create function public.pending_support_requests(p_org_id uuid)
returns table (
  id uuid,
  requester_name text,
  reason text,
  created_at timestamptz,
  scheduled_start timestamptz,
  problem_report_id uuid,
  duration_minutes integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org_id, 'support.approve') then
    return;
  end if;
  perform private.expire_support_requests(p_org_id);
  return query
  select r.id, r.requester_name, r.reason, r.created_at, r.scheduled_start, r.problem_report_id,
    r.duration_minutes
  from public.support_access_requests r
  where r.organization_id = p_org_id
    and r.status = 'pending'
  order by r.created_at;
end;
$$;

revoke execute on function public.pending_support_requests(uuid) from public, anon;
grant execute on function public.pending_support_requests(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_problem_report: list the linked support sessions
-- ---------------------------------------------------------------------------
do $$
declare
  v_old text := '''access_requests'', ''[]''::jsonb';
  v_new text := $r$'access_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'status', case
          when a.status in ('approved', 'active') and a.approved_until <= now() then 'ended'
          when a.status = 'pending' and a.scheduled_start is not null
            and a.scheduled_start + make_interval(mins => a.duration_minutes) <= now() then 'cancelled'
          else a.status end,
        'scheduled_start', a.scheduled_start,
        'duration_minutes', a.duration_minutes,
        'approved_until', a.approved_until,
        'reason', a.reason,
        'created_at', a.created_at,
        'decided_at', a.decided_at) order by a.created_at desc)
      from public.support_access_requests a where a.problem_report_id = r.id), '[]'::jsonb)$r$;
  v_def text := pg_get_functiondef('public.platform_problem_report(uuid)'::regprocedure);
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then
    raise exception 'expected exactly one access_requests placeholder';
  end if;
  execute replace(v_def, v_old, v_new);
end
$$;
