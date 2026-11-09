-- Prepaid subscription: a month is paid first, then used. A month is due on its
-- first day plus the grace days; firms that existed before this change get a
-- transition deadline (prepaid_since + grace) so nothing locks at once.
-- Payments are also kept in a permanent record that survives cancelling (the
-- record has no organization_id on purpose: purging a firm must not delete it).

alter table public.platform_settings
  add column prepaid_since date not null default current_date;
comment on column public.platform_settings.prepaid_since is
  'Day the prepaid rule started; no month is due before this day plus the grace days.';

create table public.platform_payment_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  firm_name text not null,
  firm_slug text not null,
  period date not null check (extract(day from period) = 1),
  amount numeric(12, 2) not null check (amount >= 0),
  paid_on date not null,
  note text check (length(note) <= 200),
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid
);
comment on table public.platform_payment_records is
  'Permanent record of firm payments (D-049). firm_id has no FK and the table no organization_id: it outlives the firm.';
create unique index platform_payment_records_active_idx
  on public.platform_payment_records (firm_id, period) where cancelled_at is null;
create index platform_payment_records_period_idx on public.platform_payment_records (period);

alter table public.platform_payment_records enable row level security;
revoke all on public.platform_payment_records from anon, authenticated;

-- Existing payments (every billed month has a package; a missing price counts as 0).
do $$
declare
  v_missing integer;
begin
  insert into public.platform_payment_records
    (firm_id, firm_name, firm_slug, period, amount, paid_on, note, recorded_by, recorded_at)
  select bp.organization_id, o.name, o.slug, bp.period,
    coalesce(private.package_price_on(private.org_package_on(bp.organization_id, bp.period), bp.period), 0),
    bp.paid_on, bp.note, bp.recorded_by, bp.recorded_at
  from public.billing_payments bp
  join public.organizations o on o.id = bp.organization_id;
  select count(*) into v_missing
  from public.billing_payments bp
  where private.package_price_on(private.org_package_on(bp.organization_id, bp.period), bp.period) is null;
  raise notice 'payment records backfilled; % without a price (amount 0)', v_missing;
end
$$;

-- Due = first day of the month + grace days, but not before the transition day + grace.
create or replace function private.billing_months(p_org uuid)
returns table (
  period date,
  package_id uuid,
  package_name text,
  amount numeric,
  due_on date,
  paid_on date,
  note text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (select min(op.valid_from) from public.organization_packages op
       where op.organization_id = p_org and op.package_id is not null) as first_month,
      date_trunc('month', private.org_today(p_org))::date as this_month,
      private.org_grace_days(p_org) as grace,
      (select s.prepaid_since from public.platform_settings s) as prepaid_since
  ),
  months as (
    select m::date as period, b.grace, b.prepaid_since
    from bounds b, generate_series(b.first_month, b.this_month, interval '1 month') as m
    where b.first_month is not null
  ),
  billed as (
    select m.period, m.grace, m.prepaid_since, private.org_package_on(p_org, m.period) as package_id
    from months m
  )
  select
    b.period,
    b.package_id,
    p.name,
    private.package_price_on(b.package_id, b.period),
    greatest(b.period + b.grace, b.prepaid_since + b.grace),
    pay.paid_on,
    pay.note
  from billed b
  join public.billing_packages p on p.id = b.package_id
  left join public.billing_payments pay on pay.organization_id = p_org and pay.period = b.period
  order by b.period
$$;

create or replace function public.platform_set_payment(
  p_org_id uuid, p_period date, p_paid boolean, p_paid_on date, p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_amount numeric;
  v_name text;
  v_slug text;
  v_note text := nullif(btrim(p_note), '');
begin
  if p_paid is null then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  perform private.require_platform_permission(
    case when p_paid then 'platform.payments.record' else 'platform.payments.cancel' end);
  perform private.assert_billable_org(p_org_id);
  if p_period is null or extract(day from p_period) <> 1
    or (p_paid and p_paid_on is null) or length(coalesce(p_note, '')) > 200 then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  select to_jsonb(bp) - 'organization_id' into v_before
  from public.billing_payments bp where bp.organization_id = p_org_id and bp.period = p_period;
  if p_paid then
    v_amount := private.package_price_on(private.org_package_on(p_org_id, p_period), p_period);
    if v_amount is null then
      raise exception 'not_billed' using errcode = '22023';
    end if;
    select o.name, o.slug into v_name, v_slug from public.organizations o where o.id = p_org_id;
    insert into public.billing_payments (organization_id, period, paid_on, note, recorded_by)
    values (p_org_id, p_period, p_paid_on, v_note, auth.uid())
    on conflict (organization_id, period) do update
      set paid_on = excluded.paid_on, note = excluded.note,
          recorded_by = excluded.recorded_by, recorded_at = now();
    update public.platform_payment_records
    set paid_on = p_paid_on, note = v_note
    where firm_id = p_org_id and period = p_period and cancelled_at is null;
    if not found then
      insert into public.platform_payment_records
        (firm_id, firm_name, firm_slug, period, amount, paid_on, note, recorded_by)
      values (p_org_id, v_name, v_slug, p_period, v_amount, p_paid_on, v_note, auth.uid());
    end if;
  else
    delete from public.billing_payments where organization_id = p_org_id and period = p_period;
    update public.platform_payment_records
    set cancelled_at = now(), cancelled_by = auth.uid()
    where firm_id = p_org_id and period = p_period and cancelled_at is null;
  end if;
  perform private.billing_audit(p_org_id,
    case when p_paid then 'billing.payment_recorded' else 'billing.payment_cancelled' end,
    p_period::text, v_before,
    case when p_paid then jsonb_build_object('period', p_period, 'paid_on', p_paid_on, 'note', p_note) end);
end;
$$;
