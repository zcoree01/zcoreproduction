-- customers.customer_number: 0 (the default) means "next number", so inserts
-- may leave it out (also in the generated API types). The trigger replaces
-- it before the CHECK (1..999999) and NOT NULL are evaluated.
alter table public.customers alter column customer_number set default 0;

create or replace function private.assign_customer_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_number is null or new.customer_number = 0 then
    new.customer_number := case
      when tg_op = 'UPDATE' then old.customer_number
      else private.next_counter(new.organization_id, 'customer_number')
    end;
  elsif tg_op = 'INSERT' or new.customer_number is distinct from old.customer_number then
    perform private.raise_counter(new.organization_id, 'customer_number', new.customer_number);
  end if;
  return new;
end;
$$;
