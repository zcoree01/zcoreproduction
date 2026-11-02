-- Notification state per user (D-038). The bell shows items derived from
-- pending work (close requests, attendance alerts, requests to decide); this
-- table only remembers which of them a user has read or removed from the
-- bell. Keys are "<kind>:<uuid>" (close / alert / approval). The pending
-- work itself is unchanged: a removed item still waits for its decision.

create table public.notification_reads (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null,
  item_key text not null check (item_key ~ '^[a-z_]{1,30}:[0-9a-f-]{36}$'),
  read_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (organization_id, user_id, item_key),
  foreign key (organization_id, user_id)
    references public.profiles (organization_id, id) on delete restrict
);

revoke all on public.notification_reads from anon, authenticated;
grant select on public.notification_reads to authenticated;

alter table public.notification_reads enable row level security;

create policy notification_reads_select on public.notification_reads
  for select to authenticated
  using (user_id = auth.uid() and organization_id in (select private.user_org_ids()));

-- Marks the caller's items as read, or removes them from the bell
-- (p_dismiss). Idempotent; at most 200 keys per call.
create function public.mark_notifications(p_org_id uuid, p_keys text[], p_dismiss boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_org_id not in (select private.user_org_ids()) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_keys is null or cardinality(p_keys) > 200 then
    raise exception 'invalid_keys' using errcode = '22023';
  end if;

  insert into public.notification_reads (organization_id, user_id, item_key, dismissed_at)
  select p_org_id, auth.uid(), k, case when p_dismiss then now() end
  from unnest(p_keys) as k
  on conflict (organization_id, user_id, item_key) do update
    set dismissed_at = coalesce(public.notification_reads.dismissed_at, excluded.dismissed_at);
end;
$$;

revoke execute on function public.mark_notifications(uuid, text[], boolean) from public, anon;
grant execute on function public.mark_notifications(uuid, text[], boolean) to authenticated;
