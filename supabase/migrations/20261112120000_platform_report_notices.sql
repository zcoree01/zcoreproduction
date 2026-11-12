-- The Zcore bell reads problem report notices through this RPC (D-061)
-- instead of the service role in the app. It checks platform.reports.manage
-- itself, skips archived firms and returns at most 200 characters of a report
-- or reply, which is all the bell shows.
-- New reports (status new) and user replies of the last 14 days, newest first,
-- at most 50.

create function public.platform_report_notices()
returns table (kind text, notice_key text, report_id uuid, detail text, at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_since timestamptz := now() - interval '14 days';
begin
  perform private.require_platform_permission('platform.reports.manage');
  return query
  select n.kind, n.notice_key, n.report_id, n.detail, n.at
  from (
    (
      select 'new'::text as kind,
        'report:' || pr.id::text as notice_key,
        pr.id as report_id,
        left(o.name || ' · ' || coalesce(nullif(btrim(pr.description), ''), pr.category::text), 200) as detail,
        pr.created_at as at
      from public.problem_reports pr
      join public.organizations o on o.id = pr.organization_id and o.archived_at is null
      where pr.status = 'new' and pr.created_at >= v_since
      order by pr.created_at desc
      limit 50
    )
    union all
    (
      select 'reply'::text,
        'report:' || pm.id::text,
        pm.report_id,
        left(o.name || ' · ' || pm.body, 200),
        pm.created_at
      from public.problem_report_messages pm
      join public.problem_reports pr on pr.id = pm.report_id
      join public.organizations o on o.id = pr.organization_id and o.archived_at is null
      where not pm.from_zcore and pm.created_at >= v_since
      order by pm.created_at desc
      limit 50
    )
  ) n
  order by n.at desc
  limit 50;
end;
$$;
revoke all on function public.platform_report_notices() from public, anon;
grant execute on function public.platform_report_notices() to authenticated;
