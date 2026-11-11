-- Visible "purge failed" state (D-055, follow-up of D-050). A firm whose
-- permanent deletion failed used to fail every night with only a log line:
-- it can be neither cancelled (not_cancellable) nor restored
-- (deletion_scheduled), and its files may already be gone. The daily cron now
-- records each failure here; the Zcore team sees it on the platform home, in
-- the firm list and on the firm's page.
--
-- Platform data about a firm, written only by the cron (service role) and read
-- only through platform_purge_failures(). The row goes with the firm when a
-- later purge succeeds (purge_organization_rows clears every table with
-- organization_id; the foreign key cascades as well).

create table public.organization_purge_failures (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts > 0),
  error text not null check (length(error) between 1 and 2000)
);
comment on table public.organization_purge_failures is
  'Last failed permanent deletion of a firm (D-055); written by the purge cron only.';

-- No policies: neither tenants nor platform members read the table directly.
alter table public.organization_purge_failures enable row level security;
revoke all on table public.organization_purge_failures from public, anon, authenticated;
grant select, insert, update, delete on table public.organization_purge_failures to service_role;

-- Every table with organization_id carries the lock guard (D-049). The service
-- role skips it, so the cron is never blocked.
create trigger lock_guard before insert or update or delete on public.organization_purge_failures
  for each row execute function private.lock_guard();

-- Called by the cron after a firm could not be purged. The first failure also
-- leaves an audit row in the Zcore organization.
create function public.record_purge_failure(p_org_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text := left(coalesce(nullif(btrim(p_error), ''), 'unknown error'), 2000);
  v_first boolean;
  v_org public.organizations;
begin
  select * into v_org from public.organizations o where o.id = p_org_id;
  if v_org.id is null then
    return;
  end if;

  insert into public.organization_purge_failures (organization_id, error)
  values (p_org_id, v_error)
  on conflict (organization_id) do update
    set last_failed_at = now(),
        attempts = public.organization_purge_failures.attempts + 1,
        error = excluded.error
  returning (xmax = 0) into v_first;

  if v_first and private.platform_org_id() is not null then
    perform private.billing_audit(
      private.platform_org_id(), 'organization.purge_failed', p_org_id::text, null,
      jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'error', v_error)
    );
  end if;
end;
$$;
revoke all on function public.record_purge_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.record_purge_failure(uuid, text) to service_role;

-- Firms whose permanent deletion failed, newest failure first.
create function public.platform_purge_failures()
returns table (
  organization_id uuid,
  name text,
  slug text,
  delete_after timestamptz,
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  attempts integer,
  error text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_permission('platform.read');
  return query
  select o.id, o.name, o.slug, o.delete_after,
    f.first_failed_at, f.last_failed_at, f.attempts, f.error
  from public.organization_purge_failures f
  join public.organizations o on o.id = f.organization_id
  order by f.last_failed_at desc;
end;
$$;
revoke all on function public.platform_purge_failures() from public, anon;
grant execute on function public.platform_purge_failures() to authenticated;
