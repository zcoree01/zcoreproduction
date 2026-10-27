-- Company profile, shared company directory, change requests, platform
-- administration and module trials (D-023).
--
--   * companies + company_bank_accounts: ONE global directory of legal
--     entities (public business data only: name, tax/VAT number, addresses,
--     general phone/e-mail, bank accounts), identified by country + tax id.
--     It is deliberately NOT tenant data and NOT browsable: tenants reach it
--     only through search_companies() (>= 3 characters, max 8 hits) and
--     get_company(). Who added an entry and who has it as a customer is never
--     revealed to other organizations.
--   * An organization's own profile is its company row (organizations.
--     company_id, companies.owner_organization_id). The owner edits it; other
--     organizations send change requests. Changes of companies without an
--     owner (added as customers) are decided by the Zcore platform admin.
--     Taking over an existing directory entry (claim) also needs the platform
--     admin, so nobody can take over another company's bank account.
--   * customers.company_id links a customer to the directory; linked
--     customers follow directory changes automatically (sync trigger). The
--     customer number, contact person and notes stay private.
--   * Platform: organizations.is_platform marks the Zcore organization; its
--     members with platform.manage are platform admins. They see registered
--     organizations and their modules only (never tenant data) and set module
--     trials (org_modules.active_until; default trial length in
--     platform_settings).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.fold(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(
    lower(coalesce(p, '')),
    'čćđšžäöüßàáâãåèéêëìíîïòóôõùúûýÿñç',
    'ccdszaousaaaaaeeeeiiiioooouuuyync'
  )
$$;

comment on function private.fold(text) is
  'Lower case without diacritics, for search ("Čelik" ~ "celik").';

/** Tax and VAT numbers without spaces, dots, dashes or slashes, upper case. */
create function private.normalize_tax_id(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[\s./-]', '', 'g')), '')
$$;

-- ---------------------------------------------------------------------------
-- Platform organization and permission
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column is_platform boolean not null default false;

comment on column public.organizations.is_platform is
  'The Zcore organization: its members with platform.manage are platform admins.';

insert into public.modules (key, name) values ('platform', 'Platforma');

insert into public.permissions (key, module_key, description, default_roles) values
  ('platform.manage', 'platform',
    'Zcore platform: registered organizations, modules, trials, directory requests', '{}');

create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations o
    where o.is_platform
      and o.archived_at is null
      and private.has_permission(o.id, 'platform.manage')
  )
$$;

-- The Zcore organization itself (members are created by scripts/seed).
insert into public.organizations (slug, name, is_platform)
values ('zcore', 'Zcore', true)
on conflict (slug) do update set is_platform = true;

insert into public.role_permissions (organization_id, role_id, permission_key)
select o.id, r.id, 'platform.manage'
from public.organizations o
join public.roles r on r.organization_id = o.id and r.key = 'admin'
where o.slug = 'zcore'
on conflict do nothing;

insert into public.org_modules (organization_id, module_key, enabled, enabled_at)
select o.id, 'platform', true, now()
from public.organizations o
where o.slug = 'zcore'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Module trials
-- ---------------------------------------------------------------------------
alter table public.org_modules
  add column active_until timestamptz;

comment on column public.org_modules.active_until is
  'Null = active without end; otherwise the module is off after this moment (trial).';

create table public.platform_settings (
  id boolean primary key default true check (id),
  default_trial_days integer not null default 14 check (default_trial_days between 1 and 365),
  updated_at timestamptz not null default now()
);

comment on table public.platform_settings is 'Single row: platform-wide settings (Zcore).';

insert into public.platform_settings (id) values (true);

revoke all on public.platform_settings from anon, authenticated;
alter table public.platform_settings enable row level security;

create or replace function private.module_enabled(p_org_id uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_modules m
    where m.organization_id = p_org_id
      and m.module_key = p_module
      and m.enabled
      and (m.active_until is null or m.active_until > now())
  )
$$;

-- ---------------------------------------------------------------------------
-- Company directory
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  tax_id text not null check (length(tax_id) between 1 and 50 and tax_id = upper(tax_id)),
  vat_id text check (vat_id is null or (length(vat_id) between 1 and 50 and vat_id = upper(vat_id))),
  name text not null check (length(btrim(name)) between 1 and 200),
  short_name text check (short_name is null or length(btrim(short_name)) between 1 and 100),
  legal_form text check (legal_form is null or length(btrim(legal_form)) between 1 and 50),
  address text check (address is null or length(btrim(address)) between 1 and 300),
  postal_code text check (postal_code is null or length(btrim(postal_code)) between 1 and 20),
  city text check (city is null or length(btrim(city)) between 1 and 100),
  mail_address text check (mail_address is null or length(btrim(mail_address)) between 1 and 300),
  mail_postal_code text
    check (mail_postal_code is null or length(btrim(mail_postal_code)) between 1 and 20),
  mail_city text check (mail_city is null or length(btrim(mail_city)) between 1 and 100),
  phone text check (phone is null or length(btrim(phone)) between 1 and 50),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  website text check (website is null or length(btrim(website)) between 1 and 200),
  activity text check (activity is null or length(btrim(activity)) between 1 and 200),
  -- Bosnia and Herzegovina: ID number (JIB) 13 digits, VAT number 12 digits.
  constraint companies_ba_tax_id check (country <> 'BA' or tax_id ~ '^[0-9]{13}$'),
  constraint companies_ba_vat_id check (country <> 'BA' or vat_id is null or vat_id ~ '^[0-9]{12}$'),
  -- The registered organization that maintains this entry (null = Zcore decides).
  owner_organization_id uuid references public.organizations (id) on delete restrict,
  -- Who added the entry; visible to the platform admin only.
  created_by_organization_id uuid references public.organizations (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_country_tax_id_key unique (country, tax_id)
);

comment on table public.companies is
  'Global directory of legal entities (public business data). Not tenant data; reached only through RPCs.';

create unique index companies_owner_key
  on public.companies (owner_organization_id) where owner_organization_id is not null;
create index companies_name_fold_idx on public.companies (private.fold(name));

create trigger companies_set_updated_at before update on public.companies
  for each row execute function private.set_updated_at();

create table public.company_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  bank_name text not null check (length(btrim(bank_name)) between 1 and 200),
  account_number text check (account_number is null or length(account_number) between 1 and 50),
  iban text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$'),
  swift text check (swift is null or swift ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (account_number is not null or iban is not null)
);

create index company_bank_accounts_company_idx
  on public.company_bank_accounts (company_id) where archived_at is null;

alter table public.organizations
  add column company_id uuid references public.companies (id) on delete restrict;

create unique index organizations_company_key
  on public.organizations (company_id) where company_id is not null;

-- Change requests (and claims of an existing entry by a newly registered org).
create table public.company_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  kind text not null default 'update' check (kind in ('update', 'claim')),
  requested_by_organization_id uuid not null references public.organizations (id) on delete restrict,
  requested_by_user_id uuid,
  -- Field -> new value (keys of private.company_fields()); bank accounts:
  -- null = unchanged, otherwise the complete new list.
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  bank_accounts jsonb check (bank_accounts is null or jsonb_typeof(bank_accounts) = 'array'),
  reason text check (reason is null or length(btrim(reason)) between 1 and 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index company_change_requests_pending_idx
  on public.company_change_requests (company_id) where status = 'pending';
create unique index company_change_requests_one_claim
  on public.company_change_requests (requested_by_organization_id)
  where kind = 'claim' and status = 'pending';

revoke all on public.companies, public.company_bank_accounts, public.company_change_requests
  from anon, authenticated;
alter table public.companies enable row level security;
alter table public.company_bank_accounts enable row level security;
alter table public.company_change_requests enable row level security;
-- No policies: every access goes through the SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------------
-- Customers: link to the directory
-- ---------------------------------------------------------------------------
alter table public.customers
  add column company_id uuid references public.companies (id) on delete restrict,
  add column postal_code text check (postal_code is null or length(btrim(postal_code)) between 1 and 20);

create index customers_company_idx on public.customers (company_id) where company_id is not null;

-- Country as ISO code where the old free text is recognisable.
update public.customers
set country = case
  when private.fold(btrim(country)) in ('bosna i hercegovina', 'bih', 'bosnia and herzegovina', 'ba')
    then 'BA'
  when private.fold(btrim(country)) in ('hrvatska', 'croatia', 'hr') then 'HR'
  when private.fold(btrim(country)) in ('srbija', 'serbia', 'rs') then 'RS'
  when private.fold(btrim(country)) in ('crna gora', 'montenegro', 'me') then 'ME'
  when private.fold(btrim(country)) in ('slovenija', 'slovenia', 'si') then 'SI'
  when private.fold(btrim(country)) in ('njemacka', 'germany', 'deutschland', 'de') then 'DE'
  when private.fold(btrim(country)) in ('austrija', 'austria', 'osterreich', 'at') then 'AT'
  else country
end
where country is not null;

-- ---------------------------------------------------------------------------
-- Field list and helpers shared by the RPCs
-- ---------------------------------------------------------------------------
create function private.company_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'name', 'short_name', 'legal_form', 'vat_id', 'address', 'postal_code', 'city',
    'mail_address', 'mail_postal_code', 'mail_city', 'phone', 'email', 'website', 'activity'
  ]
$$;

/** Public data of a company as JSON (bank accounts included). */
create function private.company_json(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'country', c.country,
    'tax_id', c.tax_id,
    'vat_id', c.vat_id,
    'name', c.name,
    'short_name', c.short_name,
    'legal_form', c.legal_form,
    'address', c.address,
    'postal_code', c.postal_code,
    'city', c.city,
    'mail_address', c.mail_address,
    'mail_postal_code', c.mail_postal_code,
    'mail_city', c.mail_city,
    'phone', c.phone,
    'email', c.email,
    'website', c.website,
    'activity', c.activity,
    'registered', c.owner_organization_id is not null,
    'updated_at', c.updated_at,
    'bank_accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bank_name', b.bank_name,
        'account_number', b.account_number,
        'iban', b.iban,
        'swift', b.swift,
        'is_primary', b.is_primary
      ) order by b.is_primary desc, b.sort_order, b.created_at)
      from public.company_bank_accounts b
      where b.company_id = c.id and b.archived_at is null
    ), '[]'::jsonb)
  )
  from public.companies c
  where c.id = p_company_id
$$;

/** Applies field changes (only known keys; "" = clear) and optionally replaces the bank accounts. */
create function private.apply_company_changes(p_company_id uuid, p_changes jsonb, p_bank_accounts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text;
  v_key text;
  v_account jsonb;
  v_order integer := 0;
begin
  for v_key in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if not v_key = any (private.company_fields()) then
      raise exception 'unknown company field %', v_key using errcode = '22023';
    end if;
    v_value := nullif(btrim(p_changes ->> v_key), '');
    if v_key = 'vat_id' then
      v_value := private.normalize_tax_id(v_value);
    end if;
    if v_key = 'name' and v_value is null then
      raise exception 'company name is required' using errcode = '23502';
    end if;
    execute format('update public.companies set %I = $1 where id = $2', v_key)
      using v_value, p_company_id;
  end loop;

  if p_bank_accounts is not null then
    update public.company_bank_accounts
    set archived_at = now()
    where company_id = p_company_id and archived_at is null;

    for v_account in select * from jsonb_array_elements(p_bank_accounts) loop
      insert into public.company_bank_accounts
        (company_id, bank_name, account_number, iban, swift, is_primary, sort_order)
      values (
        p_company_id,
        btrim(v_account ->> 'bank_name'),
        nullif(regexp_replace(coalesce(v_account ->> 'account_number', ''), '[\s-]', '', 'g'), ''),
        private.normalize_tax_id(v_account ->> 'iban'),
        private.normalize_tax_id(v_account ->> 'swift'),
        coalesce((v_account ->> 'is_primary')::boolean, false),
        v_order
      );
      v_order := v_order + 1;
    end loop;
  end if;
end;
$$;

/** Copies directory data into every linked customer (customer name kept when it would collide). */
create function private.sync_company_customers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.customers cu
  set
    name = case
      when exists (
        select 1 from public.customers other
        where other.organization_id = cu.organization_id
          and other.id <> cu.id
          and other.archived_at is null
          and lower(btrim(other.name)) = lower(btrim(new.name))
      ) then cu.name
      else new.name
    end,
    tax_id = new.tax_id,
    address = new.address,
    postal_code = new.postal_code,
    city = new.city,
    country = new.country,
    phone = coalesce(new.phone, cu.phone),
    email = coalesce(new.email, cu.email)
  where cu.company_id = new.id;
  return null;
end;
$$;

create trigger companies_sync_customers after update on public.companies
  for each row execute function private.sync_company_customers();

create function private.write_audit_as(
  p_org_id uuid, p_action text, p_entity_type text, p_entity_id text, p_before jsonb, p_after jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (p_org_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after)
$$;

-- ---------------------------------------------------------------------------
-- Directory: search and read (any signed-in member)
-- ---------------------------------------------------------------------------
create function public.search_companies(p_query text)
returns table (id uuid, name text, city text, country text, tax_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_fold text;
  v_tax text;
begin
  if not exists (select 1 from private.user_org_ids()) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  -- Not browsable: a search needs at least three characters.
  if length(v_query) < 3 then
    return;
  end if;
  v_fold := replace(replace(replace(private.fold(v_query), '\', '\\'), '%', '\%'), '_', '\_');
  v_tax := private.normalize_tax_id(v_query);

  return query
  select c.id, c.name, c.city, c.country, c.tax_id
  from public.companies c
  where private.fold(c.name) like '%' || v_fold || '%'
     or private.fold(c.short_name) like '%' || v_fold || '%'
     or (length(v_tax) >= 3 and (c.tax_id like v_tax || '%' or c.vat_id like v_tax || '%'))
  order by (private.fold(c.name) like v_fold || '%') desc, c.name
  limit 8;
end;
$$;

comment on function public.search_companies(text) is
  'Directory suggestions while typing: >= 3 characters, at most 8 hits. Members only.';

create function public.get_company(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.user_org_ids()) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return private.company_json(p_company_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Own organization profile
-- ---------------------------------------------------------------------------
create function public.organization_profile(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_claim public.company_change_requests;
begin
  if not p_org_id in (select private.user_org_ids()) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select * into v_org from public.organizations where id = p_org_id;

  if v_org.company_id is not null then
    return jsonb_build_object('status', 'owned', 'company', private.company_json(v_org.company_id));
  end if;

  select * into v_claim
  from public.company_change_requests r
  where r.requested_by_organization_id = p_org_id and r.kind = 'claim' and r.status = 'pending';
  if found then
    return jsonb_build_object(
      'status', 'claim_pending',
      'company', (select jsonb_build_object('country', c.country, 'tax_id', c.tax_id)
                  from public.companies c where c.id = v_claim.company_id)
        || v_claim.changes
        || jsonb_build_object('bank_accounts', coalesce(v_claim.bank_accounts, '[]'::jsonb)),
      'requested_at', v_claim.created_at
    );
  end if;

  return jsonb_build_object('status', 'none');
end;
$$;

/**
 * Saves the organization's company data (org.settings.manage). Own entry:
 * updated directly. No entry yet: a new directory entry owned by the org; if
 * the tax id already exists without an owner, a claim for the platform admin
 * (data waits in the claim); owned by another org: refused.
 */
create function public.save_organization_profile(
  p_org_id uuid,
  p_country text,
  p_tax_id text,
  p_fields jsonb,
  p_bank_accounts jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_tax text := private.normalize_tax_id(p_tax_id);
  v_existing public.companies;
  v_company_id uuid;
  v_before jsonb;
begin
  if not private.has_permission(p_org_id, 'org.settings.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_tax is null or v_country !~ '^[A-Z]{2}$' then
    raise exception 'country and tax id are required' using errcode = '23502';
  end if;
  if p_bank_accounts is null or jsonb_typeof(p_bank_accounts) <> 'array' then
    raise exception 'bank accounts must be a list' using errcode = '22023';
  end if;

  select * into v_org from public.organizations where id = p_org_id for update;

  if v_org.company_id is not null then
    v_before := private.company_json(v_org.company_id);
    update public.companies set country = v_country, tax_id = v_tax where id = v_org.company_id;
    perform private.apply_company_changes(v_org.company_id, p_fields, p_bank_accounts);
    update public.organizations
    set name = coalesce(
      (select coalesce(c.short_name, c.name) from public.companies c where c.id = v_org.company_id),
      name)
    where id = p_org_id;
    perform private.write_audit_as(p_org_id, 'organizations.profile_updated', 'companies',
      v_org.company_id::text, v_before, private.company_json(v_org.company_id));
    return 'owned';
  end if;

  select * into v_existing from public.companies c where c.country = v_country and c.tax_id = v_tax;

  if not found then
    insert into public.companies (country, tax_id, name, owner_organization_id, created_by_organization_id)
    values (v_country, v_tax, coalesce(nullif(btrim(p_fields ->> 'name'), ''), v_org.name), p_org_id, p_org_id)
    returning id into v_company_id;
    perform private.apply_company_changes(v_company_id, p_fields, p_bank_accounts);
    update public.organizations set company_id = v_company_id where id = p_org_id;
    perform private.write_audit_as(p_org_id, 'organizations.profile_created', 'companies',
      v_company_id::text, null, private.company_json(v_company_id));
    return 'owned';
  end if;

  if v_existing.owner_organization_id is not null then
    raise exception 'company_owned' using errcode = 'P0001',
      hint = 'This tax id belongs to another registered organization.';
  end if;

  -- Existing entry without owner: claim, decided by the platform admin.
  update public.company_change_requests
  set status = 'withdrawn'
  where requested_by_organization_id = p_org_id and kind = 'claim' and status = 'pending';
  insert into public.company_change_requests
    (company_id, kind, requested_by_organization_id, requested_by_user_id, changes, bank_accounts)
  values (v_existing.id, 'claim', p_org_id, auth.uid(),
    (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
     from jsonb_each(coalesce(p_fields, '{}'::jsonb)) as e(k, v)
     where k = any (private.company_fields())),
    p_bank_accounts);
  perform private.write_audit_as(p_org_id, 'organizations.profile_claimed', 'companies',
    v_existing.id::text, null, jsonb_build_object('tax_id', v_tax, 'country', v_country));
  return 'claim_pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- Customers with the directory (one transaction)
-- ---------------------------------------------------------------------------
/**
 * Creates or updates a customer. With p_company_id (picked from the
 * suggestions) or a country + tax id, the customer is linked to the directory
 * (a new entry is created when none exists) and its public data come from the
 * directory. Data that differ from an existing entry become a change request
 * instead of overwriting it. Without a tax id the customer stays private.
 * Returns {id, company_id, directory: linked|created|none, change_requested}.
 */
create function public.save_customer(
  p_org_id uuid,
  p_customer_id uuid,
  p_customer jsonb,
  p_company_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text := nullif(upper(btrim(coalesce(p_customer ->> 'country', ''))), '');
  v_tax text := private.normalize_tax_id(p_customer ->> 'tax_id');
  v_company public.companies;
  v_company_id uuid := p_company_id;
  v_directory text := 'none';
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_new text;
  v_old text;
  v_id uuid;
  v_number integer := nullif(p_customer ->> 'customer_number', '')::integer;
  v_current_company uuid;
begin
  if not private.has_permission(p_org_id, 'customers.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  -- Bosnian VAT number (12 digits) = ID number without the leading 4.
  if v_country = 'BA' and v_tax ~ '^[0-9]{12}$' then
    v_tax := '4' || v_tax;
  end if;

  if p_customer_id is not null then
    select cu.company_id into v_current_company
    from public.customers cu
    where cu.id = p_customer_id and cu.organization_id = p_org_id and cu.archived_at is null;
    if not found then
      raise exception 'customer not found' using errcode = 'P0002';
    end if;
    v_company_id := coalesce(v_company_id, v_current_company);
  end if;

  if v_company_id is not null then
    select * into v_company from public.companies c where c.id = v_company_id;
    if not found then
      raise exception 'company not found' using errcode = 'P0002';
    end if;
    v_directory := 'linked';
  elsif v_tax is not null and v_country is not null then
    select * into v_company from public.companies c where c.country = v_country and c.tax_id = v_tax;
    if found then
      v_directory := 'linked';
      -- Typed data that differ from the directory: proposal, not overwrite.
      foreach v_key in array array['name', 'address', 'postal_code', 'city', 'phone', 'email'] loop
        v_new := nullif(btrim(p_customer ->> v_key), '');
        execute format('select ($1).%I::text', v_key) into v_old using v_company;
        if v_new is not null and v_new is distinct from v_old then
          v_changes := v_changes || jsonb_build_object(v_key, v_new);
        end if;
      end loop;
    else
      insert into public.companies
        (country, tax_id, name, address, postal_code, city, phone, email, created_by_organization_id)
      values (
        v_country, v_tax, btrim(p_customer ->> 'name'),
        nullif(btrim(p_customer ->> 'address'), ''),
        nullif(btrim(p_customer ->> 'postal_code'), ''),
        nullif(btrim(p_customer ->> 'city'), ''),
        nullif(btrim(p_customer ->> 'phone'), ''),
        nullif(btrim(p_customer ->> 'email'), ''),
        p_org_id
      )
      returning * into v_company;
      v_directory := 'created';
    end if;
    v_company_id := v_company.id;
  end if;

  if v_company_id is not null then
    -- Public data from the directory; contact person, notes and number stay private.
    p_customer := p_customer || jsonb_build_object(
      'name', v_company.name, 'tax_id', v_company.tax_id, 'address', v_company.address,
      'postal_code', v_company.postal_code, 'city', v_company.city, 'country', v_company.country,
      'phone', coalesce(v_company.phone, nullif(btrim(p_customer ->> 'phone'), '')),
      'email', coalesce(v_company.email, nullif(btrim(p_customer ->> 'email'), ''))
    );
  end if;

  if p_customer_id is null then
    insert into public.customers (
      organization_id, customer_number, name, tax_id, address, postal_code, city, country,
      contact_person, phone, email, notes, company_id
    )
    values (
      p_org_id,
      coalesce(v_number, 0),
      btrim(p_customer ->> 'name'),
      nullif(btrim(p_customer ->> 'tax_id'), ''),
      nullif(btrim(p_customer ->> 'address'), ''),
      nullif(btrim(p_customer ->> 'postal_code'), ''),
      nullif(btrim(p_customer ->> 'city'), ''),
      nullif(btrim(p_customer ->> 'country'), ''),
      nullif(btrim(p_customer ->> 'contact_person'), ''),
      nullif(btrim(p_customer ->> 'phone'), ''),
      nullif(btrim(p_customer ->> 'email'), ''),
      nullif(btrim(p_customer ->> 'notes'), ''),
      v_company_id
    )
    returning id into v_id;
  else
    update public.customers set
      customer_number = coalesce(v_number, customer_number),
      name = btrim(p_customer ->> 'name'),
      tax_id = nullif(btrim(p_customer ->> 'tax_id'), ''),
      address = nullif(btrim(p_customer ->> 'address'), ''),
      postal_code = nullif(btrim(p_customer ->> 'postal_code'), ''),
      city = nullif(btrim(p_customer ->> 'city'), ''),
      country = nullif(btrim(p_customer ->> 'country'), ''),
      contact_person = nullif(btrim(p_customer ->> 'contact_person'), ''),
      phone = nullif(btrim(p_customer ->> 'phone'), ''),
      email = nullif(btrim(p_customer ->> 'email'), ''),
      notes = nullif(btrim(p_customer ->> 'notes'), ''),
      company_id = v_company_id
    where id = p_customer_id and organization_id = p_org_id
    returning id into v_id;
  end if;

  if v_changes <> '{}'::jsonb and v_company.owner_organization_id is distinct from p_org_id then
    insert into public.company_change_requests
      (company_id, requested_by_organization_id, requested_by_user_id, changes, reason)
    values (v_company_id, p_org_id, auth.uid(), v_changes, 'Podaci uneseni pri spremanju kupca.');
  end if;

  return jsonb_build_object(
    'id', v_id,
    'company_id', v_company_id,
    'directory', v_directory,
    'change_requested', v_changes <> '{}'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Change requests
-- ---------------------------------------------------------------------------
/** Proposal by an organization that has the company as a customer. */
create function public.request_company_change(
  p_org_id uuid,
  p_company_id uuid,
  p_changes jsonb,
  p_bank_accounts jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
begin
  if not private.has_permission(p_org_id, 'customers.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.customers cu
    where cu.organization_id = p_org_id and cu.company_id = p_company_id and cu.archived_at is null
  ) then
    raise exception 'company is not a customer of this organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.companies c where c.id = p_company_id and c.owner_organization_id = p_org_id) then
    raise exception 'own company: edit it in the settings' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if not v_key = any (private.company_fields()) then
      raise exception 'unknown company field %', v_key using errcode = '22023';
    end if;
  end loop;
  if coalesce(p_changes, '{}'::jsonb) = '{}'::jsonb and p_bank_accounts is null then
    raise exception 'nothing to change' using errcode = '22023';
  end if;

  insert into public.company_change_requests
    (company_id, requested_by_organization_id, requested_by_user_id, changes, bank_accounts, reason)
  values (p_company_id, p_org_id, auth.uid(), coalesce(p_changes, '{}'::jsonb), p_bank_accounts,
    nullif(btrim(p_reason), ''))
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Pending requests the caller may decide: for the owner organization
 * (org.settings.manage) the proposals for its own entry, without saying who
 * sent them; for the platform admin claims and proposals for entries without
 * an owner (with the requesting organization).
 */
create function public.company_change_requests_to_decide(p_org_id uuid)
returns table (
  id uuid,
  kind text,
  company jsonb,
  changes jsonb,
  bank_accounts jsonb,
  reason text,
  requested_by text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_platform boolean := private.is_platform_admin();
  v_owner boolean := private.has_permission(p_org_id, 'org.settings.manage');
begin
  if not (v_platform or v_owner) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
  select r.id, r.kind, private.company_json(r.company_id), r.changes, r.bank_accounts, r.reason,
    case when v_platform and (r.kind = 'claim' or c.owner_organization_id is null)
      then o.name end,
    r.created_at
  from public.company_change_requests r
  join public.companies c on c.id = r.company_id
  join public.organizations o on o.id = r.requested_by_organization_id
  where r.status = 'pending'
    and (
      (v_owner and r.kind = 'update' and c.owner_organization_id = p_org_id)
      or (v_platform and exists (select 1 from public.organizations po where po.id = p_org_id and po.is_platform)
          and (r.kind = 'claim' or c.owner_organization_id is null))
    )
  order by r.created_at;
end;
$$;

/** Requests sent by the organization (status only). */
create function public.my_company_change_requests(p_org_id uuid)
returns table (
  id uuid,
  kind text,
  company_name text,
  changes jsonb,
  status text,
  decision_note text,
  created_at timestamptz,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_permission(p_org_id, 'customers.manage')
          or private.has_permission(p_org_id, 'org.settings.manage')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
  select r.id, r.kind, c.name, r.changes, r.status, r.decision_note, r.created_at, r.decided_at
  from public.company_change_requests r
  join public.companies c on c.id = r.company_id
  where r.requested_by_organization_id = p_org_id
  order by r.created_at desc
  limit 100;
end;
$$;

create function public.decide_company_change(p_org_id uuid, p_request_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.company_change_requests;
  v_company public.companies;
  v_before jsonb;
  v_platform_org boolean;
begin
  select * into v_request from public.company_change_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'request not found or already decided' using errcode = 'P0002';
  end if;
  select * into v_company from public.companies where id = v_request.company_id for update;

  select o.is_platform into v_platform_org from public.organizations o where o.id = p_org_id;
  if v_request.kind = 'claim' or v_company.owner_organization_id is null then
    if not (coalesce(v_platform_org, false) and private.is_platform_admin()) then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  elsif not (v_company.owner_organization_id = p_org_id
             and private.has_permission(p_org_id, 'org.settings.manage')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not p_approve and nullif(btrim(p_note), '') is null then
    raise exception 'a rejection needs a note' using errcode = '23502';
  end if;

  v_before := private.company_json(v_company.id);
  if p_approve then
    if v_request.kind = 'claim' then
      if v_company.owner_organization_id is not null then
        raise exception 'company_owned' using errcode = 'P0001';
      end if;
      update public.companies set owner_organization_id = v_request.requested_by_organization_id
      where id = v_company.id;
      update public.organizations set company_id = v_company.id
      where id = v_request.requested_by_organization_id;
      -- Other organizations' claims for the same entry are rejected.
      update public.company_change_requests
      set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
          decision_note = 'Firma je dodijeljena drugoj registrovanoj organizaciji.'
      where company_id = v_company.id and kind = 'claim' and status = 'pending' and id <> v_request.id;
    end if;
    perform private.apply_company_changes(v_company.id, v_request.changes, v_request.bank_accounts);
  end if;

  update public.company_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
  where id = v_request.id;

  perform private.write_audit_as(
    p_org_id,
    case when p_approve then 'companies.change_approved' else 'companies.change_rejected' end,
    'companies', v_company.id::text, v_before,
    case when p_approve then private.company_json(v_company.id) else null end);
  if v_request.requested_by_organization_id <> p_org_id then
    perform private.write_audit_as(
      v_request.requested_by_organization_id,
      case when p_approve then 'companies.change_approved' else 'companies.change_rejected' end,
      'company_change_requests', v_request.id::text, null,
      jsonb_build_object('note', nullif(btrim(p_note), '')));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform administration (platform admins of the Zcore organization only)
-- ---------------------------------------------------------------------------
create function private.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end;
$$;

/** Registered organizations with their modules: no tenant data. */
create function public.platform_organizations()
returns table (
  id uuid,
  slug text,
  name text,
  created_at timestamptz,
  archived boolean,
  member_count integer,
  company jsonb,
  claim_pending boolean,
  modules jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
  select o.id, o.slug, o.name, o.created_at, o.archived_at is not null,
    (select count(*)::integer from public.memberships m where m.organization_id = o.id and m.archived_at is null),
    case when o.company_id is null then null else
      (select jsonb_build_object('tax_id', c.tax_id, 'country', c.country, 'city', c.city, 'name', c.name)
       from public.companies c where c.id = o.company_id) end,
    exists (select 1 from public.company_change_requests r
            where r.requested_by_organization_id = o.id and r.kind = 'claim' and r.status = 'pending'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', md.key,
        'enabled', coalesce(om.enabled, false),
        'active_until', om.active_until
      ) order by md.key)
      from public.modules md
      left join public.org_modules om on om.organization_id = o.id and om.module_key = md.key
      where md.key not in ('core', 'platform')
    ), '[]'::jsonb)
  from public.organizations o
  where not o.is_platform
  order by o.created_at desc;
end;
$$;

create function public.platform_set_module(
  p_org_id uuid, p_module text, p_enabled boolean, p_active_until timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_module in ('core', 'platform') then
    raise exception 'module % cannot be changed', p_module using errcode = '22023';
  end if;
  if exists (select 1 from public.organizations o where o.id = p_org_id and o.is_platform) then
    raise exception 'platform organization' using errcode = '22023';
  end if;
  insert into public.org_modules (organization_id, module_key, enabled, enabled_at, active_until)
  values (p_org_id, p_module, p_enabled, case when p_enabled then now() end, p_active_until)
  on conflict (organization_id, module_key) do update
  set enabled = excluded.enabled,
      enabled_at = case when excluded.enabled and not public.org_modules.enabled then now()
                        else public.org_modules.enabled_at end,
      active_until = excluded.active_until;
end;
$$;

create function public.platform_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return (select jsonb_build_object('default_trial_days', s.default_trial_days)
          from public.platform_settings s);
end;
$$;

create function public.platform_set_trial_days(p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before integer;
  v_platform uuid;
begin
  perform private.require_platform_admin();
  select default_trial_days into v_before from public.platform_settings;
  update public.platform_settings set default_trial_days = p_days, updated_at = now();
  select id into v_platform from public.organizations where is_platform limit 1;
  perform private.write_audit_as(v_platform, 'platform.trial_days_changed', 'platform_settings', 'default',
    jsonb_build_object('default_trial_days', v_before), jsonb_build_object('default_trial_days', p_days));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.search_companies(text),
  public.get_company(uuid),
  public.organization_profile(uuid),
  public.save_organization_profile(uuid, text, text, jsonb, jsonb),
  public.save_customer(uuid, uuid, jsonb, uuid),
  public.request_company_change(uuid, uuid, jsonb, jsonb, text),
  public.company_change_requests_to_decide(uuid),
  public.my_company_change_requests(uuid),
  public.decide_company_change(uuid, uuid, boolean, text),
  public.platform_organizations(),
  public.platform_set_module(uuid, text, boolean, timestamptz),
  public.platform_get_settings(),
  public.platform_set_trial_days(integer)
from public, anon;

grant execute on function
  public.search_companies(text),
  public.get_company(uuid),
  public.organization_profile(uuid),
  public.save_organization_profile(uuid, text, text, jsonb, jsonb),
  public.save_customer(uuid, uuid, jsonb, uuid),
  public.request_company_change(uuid, uuid, jsonb, jsonb, text),
  public.company_change_requests_to_decide(uuid),
  public.my_company_change_requests(uuid),
  public.decide_company_change(uuid, uuid, boolean, text),
  public.platform_organizations(),
  public.platform_set_module(uuid, text, boolean, timestamptz),
  public.platform_get_settings(),
  public.platform_set_trial_days(integer)
to authenticated;

-- ---------------------------------------------------------------------------
-- Existing customers with a recognisable Bosnian ID / VAT number join the
-- directory (one entry per tax id; the oldest customer's data win).
-- ---------------------------------------------------------------------------
with candidates as (
  select distinct on (tax)
    cu.id, cu.organization_id, cu.name, cu.address, cu.city, cu.phone, cu.email,
    case
      when private.normalize_tax_id(cu.tax_id) ~ '^[0-9]{13}$' then private.normalize_tax_id(cu.tax_id)
      else '4' || private.normalize_tax_id(cu.tax_id)
    end as tax,
    case when private.normalize_tax_id(cu.tax_id) ~ '^[0-9]{12}$'
      then private.normalize_tax_id(cu.tax_id) end as vat
  from public.customers cu
  where private.normalize_tax_id(cu.tax_id) ~ '^[0-9]{12,13}$'
    and (cu.country is null or cu.country = 'BA')
  order by tax, cu.created_at
)
insert into public.companies (country, tax_id, vat_id, name, address, city, phone, email, created_by_organization_id)
select 'BA', tax, vat, name, address, city, phone, email, organization_id
from candidates
on conflict (country, tax_id) do nothing;

update public.customers cu
set company_id = c.id, country = 'BA', tax_id = c.tax_id
from public.companies c
where cu.company_id is null
  and private.normalize_tax_id(cu.tax_id) ~ '^[0-9]{12,13}$'
  and (cu.country is null or cu.country = 'BA')
  and c.country = 'BA'
  and c.tax_id = case
    when private.normalize_tax_id(cu.tax_id) ~ '^[0-9]{13}$' then private.normalize_tax_id(cu.tax_id)
    else '4' || private.normalize_tax_id(cu.tax_id)
  end;
