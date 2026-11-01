-- Finished goods follow-up (D-034): the customer position is set when the
-- order is created (same function as in 20261101100000, plus customer_position).

create or replace function public.create_production_order(p_org_id uuid, p_order jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product public.products;
  v_revision public.product_revisions;
  v_id uuid;
begin
  perform private.require_orders_manage(p_org_id);

  select * into v_product from public.products p
  where p.id = (p_order ->> 'product_id')::uuid and p.organization_id = p_org_id
    and p.archived_at is null;
  if v_product.id is null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  select * into v_revision from public.product_revisions r
  where r.product_id = v_product.id
    and (r.id = (p_order ->> 'revision_id')::uuid
      or (p_order ->> 'revision_id' is null and r.is_current));
  if v_revision.id is null then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;

  insert into public.production_orders (
    organization_id, customer_id, product_id, revision_id, unit, quantity, due_date, priority,
    planned_start, planned_end, notes, piece_length_mm, kerf_mm, bar_length_mm, bar_remnant_mm,
    stock_item_id, sheet_pieces_per_sheet, customer_position,
    -- Overwritten by private.assign_order_number().
    order_number, order_year, order_sequence
  ) values (
    p_org_id, (p_order ->> 'customer_id')::uuid, v_product.id, v_revision.id, v_product.unit,
    (p_order ->> 'quantity')::numeric, (p_order ->> 'due_date')::date,
    (p_order ->> 'priority')::smallint, (p_order ->> 'planned_start')::date,
    (p_order ->> 'planned_end')::date, p_order ->> 'notes',
    coalesce((p_order ->> 'piece_length_mm')::numeric, v_revision.cut_length_mm),
    coalesce((p_order ->> 'kerf_mm')::numeric, v_revision.kerf_mm),
    (p_order ->> 'bar_length_mm')::numeric, (p_order ->> 'bar_remnant_mm')::numeric,
    coalesce((p_order ->> 'stock_item_id')::uuid, v_revision.stock_item_id),
    (p_order ->> 'sheet_pieces_per_sheet')::integer,
    nullif(btrim(p_order ->> 'customer_position'), ''),
    '-', 2000, 1
  )
  returning id into v_id;

  perform private.snapshot_routing(p_org_id, v_id, v_revision.id);
  perform private.snapshot_drawings(p_org_id, v_id, v_revision.id);
  if p_order ? 'needs_cutting' and jsonb_typeof(p_order -> 'needs_cutting') = 'boolean' then
    perform private.apply_order_cutting(v_id, (p_order ->> 'needs_cutting')::boolean);
  end if;
  return v_id;
end;
$$;
