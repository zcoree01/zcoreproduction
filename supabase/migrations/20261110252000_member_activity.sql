-- Zcore organization, part 3: usage per day and problem-report counts.
-- member_activity_days holds one row per (firm, user, day in the firm's
-- timezone); it is written only through record_member_activity (page loads of
-- the app and the floor), never by Zcore users or support accounts. The Zcore
-- home gets usage (active users of the last 7 days, 30 days of users) and
-- problems, both visible with platform.read.

create table public.member_activity_days (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null,
  day date not null,
  primary key (organization_id, user_id, day),
  foreign key (organization_id, user_id)
    references public.profiles (organization_id, id) on delete restrict
);

create index member_activity_days_day_idx on public.member_activity_days (day);

revoke all on public.member_activity_days from anon, authenticated;
alter table public.member_activity_days enable row level security;

create trigger lock_guard before insert or update or delete on public.member_activity_days
  for each row execute function private.lock_guard();

create function public.record_member_activity(p_org uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or p_org is null
     or not (p_org in (select private.user_org_ids())) then
    raise exception 'not a member of the organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations o where o.id = p_org and o.is_platform) then
    return;
  end if;
  if exists (select 1 from public.profiles p
             where p.organization_id = p_org and p.id = v_user and p.is_support) then
    return;
  end if;
  insert into public.member_activity_days (organization_id, user_id, day)
  values (p_org, v_user, private.org_today(p_org))
  on conflict do nothing;
end;
$$;

revoke all on function public.record_member_activity(uuid) from public, anon;
grant execute on function public.record_member_activity(uuid) to authenticated;

create or replace function public.platform_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_platform uuid := private.platform_org_id();
  v_today date;
  v_month date;
  v_prev date;
  v_firms jsonb;
  v_using integer;
  v_using_last integer;
  v_trial integer;
  v_active integer;
  v_warning integer;
  v_overdue_n integer;
  v_locked integer;
  v_users integer;
  v_requests integer;
  v_support integer;
  v_trials integer;
  v_deletions integer;
  v_overdue jsonb;
  v_overdue_total numeric;
  v_paid numeric;
  v_expected numeric;
  v_by_month jsonb;
  v_revenue jsonb := null;
  v_active_7d integer;
  v_by_day jsonb;
  v_open integer;
  v_slow_open integer;
  v_resolved integer;
  v_avg numeric;
  v_tz text;
begin
  perform private.require_platform_permission('platform.read');
  v_today := private.org_today(v_platform);
  v_month := date_trunc('month', v_today)::date;
  v_prev := (v_month - interval '1 month')::date;
  select p.timezone into v_tz from public.organizations p where p.id = v_platform;

  -- One entry per live firm; each firm's lock state and months are read once.
  select coalesce(jsonb_agg(f.row), '[]'::jsonb) into v_firms
  from (
    select jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'state', s.state,
      'reason', s.reason,
      'this_package', private.org_package_on(o.id, v_month),
      'last_package', private.org_package_on(o.id, v_prev),
      'overdue_month', case when s.state in ('overdue', 'locked') and s.reason = 'unpaid' then
        (select jsonb_build_object(
            'period', m.period,
            'package_name', m.package_name,
            'amount', m.amount,
            'due_on', m.due_on)
         from private.billing_months(o.id) m
         where m.period = s.unpaid_period)
      end
    ) as row
    from public.organizations o
    cross join lateral private.org_lock_state(o.id) s
    where not o.is_platform and o.archived_at is null
  ) f;

  select
    count(*) filter (where (x ->> 'this_package') is not null),
    count(*) filter (where (x ->> 'last_package') is not null),
    count(*) filter (where x ->> 'state' = 'trial'),
    count(*) filter (where x ->> 'state' = 'active'),
    count(*) filter (where x ->> 'state' = 'warning'),
    count(*) filter (where x ->> 'state' = 'overdue'),
    count(*) filter (where x ->> 'state' = 'locked')
  into v_using, v_using_last, v_trial, v_active, v_warning, v_overdue_n, v_locked
  from jsonb_array_elements(v_firms) x;

  select count(*)::integer into v_users
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  join public.profiles p on p.organization_id = m.organization_id and p.id = m.user_id
  where m.archived_at is null and not p.is_support
    and not o.is_platform and o.archived_at is null;

  select count(*)::integer into v_requests
  from public.company_change_requests_to_decide(v_platform);

  select count(*)::integer into v_support
  from public.support_access_requests r where r.status = 'pending';

  select count(distinct om.organization_id)::integer into v_trials
  from public.org_modules om
  join public.organizations o on o.id = om.organization_id
  where om.enabled and om.active_until is not null
    and not o.is_platform and o.archived_at is null
    and (om.active_until at time zone (select p.timezone from public.organizations p where p.id = v_platform))::date
      between v_today and v_today + 7;

  select count(*)::integer into v_deletions
  from public.organizations o
  where o.delete_after is not null and not o.is_platform;

  select coalesce(jsonb_agg(d.item order by d.days_late desc, d.name), '[]'::jsonb),
    coalesce(sum(d.amount), 0)
  into v_overdue, v_overdue_total
  from (
    select
      (x ->> 'name') as name,
      ((x -> 'overdue_month' ->> 'amount')::numeric) as amount,
      (v_today - (x -> 'overdue_month' ->> 'due_on')::date) as days_late,
      jsonb_build_object(
        'organization_id', x ->> 'id',
        'name', x ->> 'name',
        'package_name', x -> 'overdue_month' ->> 'package_name',
        'period', x -> 'overdue_month' ->> 'period',
        'amount', to_char((x -> 'overdue_month' ->> 'amount')::numeric(12, 2), 'FM999999999990.00'),
        'days_late', v_today - (x -> 'overdue_month' ->> 'due_on')::date,
        'state', x ->> 'state'
      ) as item
    from jsonb_array_elements(v_firms) x
    where x -> 'overdue_month' is not null and x -> 'overdue_month' <> 'null'::jsonb
  ) d;

  if private.has_platform_permission('platform.revenue.read') then
    select coalesce(sum(r.amount), 0) into v_paid
    from public.platform_payment_records r
    where r.cancelled_at is null and r.period = v_month;

    select coalesce(sum(private.package_price_on(pk, v_month)), 0) into v_expected
    from (
      select (x ->> 'this_package')::uuid as pk
      from jsonb_array_elements(v_firms) x
    ) e
    where pk is not null;

    select jsonb_agg(jsonb_build_object(
      'period', t.period,
      'paid', to_char(t.paid::numeric(12, 2), 'FM999999999990.00')
    ) order by t.period)
    into v_by_month
    from (
      select m.period, coalesce(sum(r.amount), 0) as paid
      from (
        select (v_month - (n || ' month')::interval)::date as period
        from generate_series(0, 11) n
      ) m
      left join public.platform_payment_records r
        on r.period = m.period and r.cancelled_at is null
      group by m.period
    ) t;

    v_revenue := jsonb_build_object(
      'paid', to_char(v_paid::numeric(12, 2), 'FM999999999990.00'),
      'expected', to_char(v_expected::numeric(12, 2), 'FM999999999990.00'),
      'overdue_total', to_char(v_overdue_total::numeric(12, 2), 'FM999999999990.00'),
      'by_month', v_by_month
    );
  end if;

  -- Usage: distinct users per day in the live firms' own day (member_activity_days).
  select count(distinct a.user_id)::integer into v_active_7d
  from public.member_activity_days a
  join public.organizations o on o.id = a.organization_id
  where not o.is_platform and o.archived_at is null
    and a.day > v_today - 7 and a.day <= v_today;

  select jsonb_agg(jsonb_build_object('day', d.day, 'users', d.users) order by d.day)
  into v_by_day
  from (
    select g.day::date as day,
      (select count(distinct a.user_id)
       from public.member_activity_days a
       join public.organizations o on o.id = a.organization_id
       where a.day = g.day::date and not o.is_platform and o.archived_at is null)::integer as users
    from generate_series(v_today - 29, v_today, interval '1 day') g(day)
  ) d;

  -- Problem reports: open = not resolved; the average resolution is over the
  -- reports resolved in the platform's current month.
  select count(*) filter (where r.status <> 'resolved'),
    count(*) filter (where r.status <> 'resolved' and r.category = 'slow')
  into v_open, v_slow_open
  from public.problem_reports r;

  select count(*)::integer,
    avg(extract(epoch from (r.resolved_at - r.created_at)) / 86400)
  into v_resolved, v_avg
  from public.problem_reports r
  where r.status = 'resolved' and r.resolved_at is not null
    and date_trunc('month', r.resolved_at at time zone v_tz)::date = v_month;

  return jsonb_build_object(
    'today', v_today,
    'firms', jsonb_build_object(
      'using', v_using,
      'using_last_month', v_using_last,
      'trial', v_trial,
      'active', v_active,
      'warning', v_warning,
      'overdue', v_overdue_n,
      'locked', v_locked
    ),
    'users', v_users,
    'todo', jsonb_build_object(
      'directory_requests', v_requests,
      'support_pending', v_support,
      'trials_ending', v_trials,
      'deletions_scheduled', v_deletions,
      'problem_reports_open', v_open,
      'slow_open', v_slow_open
    ),
    'overdue', v_overdue,
    'revenue', v_revenue,
    'usage', jsonb_build_object('active_7d', v_active_7d, 'by_day', v_by_day),
    'problems', jsonb_build_object(
      'open', v_open,
      'slow_open', v_slow_open,
      'resolved_this_month', v_resolved,
      'avg_resolution_days', case when v_avg is null then null
        else to_char(round(v_avg, 1), 'FM999990.0') end
    )
  );
end;
$$;

revoke all on function public.platform_home() from public, anon;
grant execute on function public.platform_home() to authenticated;
