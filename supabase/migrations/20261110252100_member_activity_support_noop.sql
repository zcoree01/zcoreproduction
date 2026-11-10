-- record_member_activity: a support account is a no-op even when it is not (or
-- no longer) a member through an approved session (user_org_ids leaves it out),
-- so the support check comes before the membership check.

create or replace function public.record_member_activity(p_org uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or p_org is null then
    raise exception 'not a member of the organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p
             where p.organization_id = p_org and p.id = v_user and p.is_support) then
    return;
  end if;
  if not (p_org in (select private.user_org_ids())) then
    raise exception 'not a member of the organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations o where o.id = p_org and o.is_platform) then
    return;
  end if;
  insert into public.member_activity_days (organization_id, user_id, day)
  values (p_org, v_user, private.org_today(p_org))
  on conflict do nothing;
end;
$$;

revoke all on function public.record_member_activity(uuid) from public, anon;
grant execute on function public.record_member_activity(uuid) to authenticated;
