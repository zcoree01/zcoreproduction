-- Self-registration of organizations (D-023).
--   * register_organization(): service role only (called by the registration
--     server action after its own validation and rate limit). One transaction:
--     organization (system roles by the bootstrap trigger), its company data
--     (new directory entry, or a claim for the platform admin when the tax id
--     already exists without an owner), and every sellable module as a trial
--     (platform_settings.default_trial_days). The first admin user is created
--     by the server through the Auth Admin API afterwards; if that fails the
--     server archives the organization (archived, never deleted).
--   * registration_attempts: hashed client address per attempt, for the rate
--     limit (service role only; no personal data in clear).

create table public.registration_attempts (
  id bigint generated always as identity primary key,
  client_hash text not null check (length(client_hash) between 16 and 128),
  kind text not null check (kind in ('slug_check', 'register')),
  created_at timestamptz not null default now()
);

create index registration_attempts_client_idx
  on public.registration_attempts (client_hash, kind, created_at desc);

revoke all on public.registration_attempts from anon, authenticated;
alter table public.registration_attempts enable row level security;

/**
 * Records an attempt and says whether the client is still within the limit
 * (max attempts of this kind in the last hour). Old rows are pruned.
 */
create function public.registration_attempt(p_client_hash text, p_kind text, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.registration_attempts where created_at < now() - interval '1 day';
  select count(*) into v_count
  from public.registration_attempts
  where client_hash = p_client_hash and kind = p_kind and created_at > now() - interval '1 hour';
  if v_count >= p_max then
    return false;
  end if;
  insert into public.registration_attempts (client_hash, kind) values (p_client_hash, p_kind);
  return true;
end;
$$;

create function public.register_organization(
  p_slug text,
  p_timezone text,
  p_country text,
  p_tax_id text,
  p_fields jsonb,
  p_bank_accounts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text := upper(btrim(p_country));
  v_tax text := private.normalize_tax_id(p_tax_id);
  v_org_id uuid;
  v_company_id uuid;
  v_existing public.companies;
  v_trial_days integer;
  v_name text := btrim(p_fields ->> 'name');
  v_short text := nullif(btrim(p_fields ->> 'short_name'), '');
  v_claim boolean := false;
begin
  if v_country = 'BA' and v_tax ~ '^[0-9]{12}$' then
    v_tax := '4' || v_tax;
  end if;
  if exists (select 1 from public.organizations o where o.slug = lower(btrim(p_slug))) then
    raise exception 'slug_taken' using errcode = '23505';
  end if;

  select * into v_existing from public.companies c where c.country = v_country and c.tax_id = v_tax;
  if found and v_existing.owner_organization_id is not null then
    raise exception 'company_owned' using errcode = 'P0001';
  end if;

  insert into public.organizations (slug, name, timezone)
  values (lower(btrim(p_slug)), coalesce(v_short, v_name), p_timezone)
  returning id into v_org_id;

  if v_existing.id is null then
    insert into public.companies (country, tax_id, name, owner_organization_id, created_by_organization_id)
    values (v_country, v_tax, v_name, v_org_id, v_org_id)
    returning id into v_company_id;
    perform private.apply_company_changes(v_company_id, p_fields, p_bank_accounts);
    update public.organizations set company_id = v_company_id where id = v_org_id;
  else
    -- The tax id is already in the directory (added as someone's customer):
    -- the platform admin confirms before the entry changes hands.
    insert into public.company_change_requests
      (company_id, kind, requested_by_organization_id, changes, bank_accounts, reason)
    values (v_existing.id, 'claim', v_org_id,
      (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
       from jsonb_each(coalesce(p_fields, '{}'::jsonb)) as e(k, v)
       where k = any (private.company_fields())),
      p_bank_accounts,
      'Registracija nove firme.');
    v_claim := true;
  end if;

  select default_trial_days into v_trial_days from public.platform_settings;
  insert into public.org_modules (organization_id, module_key, enabled, enabled_at, active_until)
  select v_org_id, m.key, true, now(), now() + make_interval(days => v_trial_days)
  from public.modules m
  where m.key not in ('core', 'platform')
  on conflict (organization_id, module_key) do nothing;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (v_org_id, null, 'organizations.registered', 'organizations', v_org_id::text,
    jsonb_build_object('slug', lower(btrim(p_slug)), 'tax_id', v_tax, 'country', v_country,
      'trial_days', v_trial_days, 'claim', v_claim));

  return jsonb_build_object('organization_id', v_org_id, 'claim', v_claim, 'trial_days', v_trial_days);
end;
$$;

revoke execute on function
  public.registration_attempt(text, text, integer),
  public.register_organization(text, text, text, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function
  public.registration_attempt(text, text, integer),
  public.register_organization(text, text, text, text, jsonb, jsonb)
to service_role;
