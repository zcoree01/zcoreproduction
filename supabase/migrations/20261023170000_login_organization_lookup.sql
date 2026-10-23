-- Login screen needs to show which organization the user is signing into
-- (and say so when the subdomain is wrong) before anyone is authenticated.
-- Returns only the display name of an active organization; nothing else is
-- readable by anon.
create function public.get_login_organization(p_slug text)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from public.organizations o
  where o.slug = lower(p_slug) and o.archived_at is null
$$;

revoke execute on function public.get_login_organization(text) from public;
grant execute on function public.get_login_organization(text) to anon, authenticated;
