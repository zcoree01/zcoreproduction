-- Inventory part A follow-up (D-031): a proposed correction that removes
-- stock must name its lot already when it is proposed (it was only refused on
-- approval). Same function otherwise.

create or replace function public.request_stock_adjustment(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_reason text,
  p_lines jsonb,
  p_post boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_id uuid;
  v_line jsonb;
  v_no integer;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_post then
    perform private.assert_inventory_access(p_org_id, 'inventory.adjust.approve');
  elsif private.has_permission(p_org_id, 'inventory.adjust.approve') then
    perform private.assert_inventory_access(p_org_id, 'inventory.adjust.approve');
  else
    perform private.assert_inventory_access(p_org_id, 'inventory.move');
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;

  select d.id into v_doc_id from public.stock_documents d
  where d.organization_id = p_org_id and d.idempotency_key = p_idempotency_key;
  if found then return v_doc_id; end if;

  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;

  insert into public.stock_documents (
    organization_id, kind, number, status, document_date, reason, idempotency_key
  ) values (
    p_org_id, 'adjustment', private.next_stock_number(p_org_id, 'KO', 'stock_adjustment'),
    'pending', current_date, v_reason, p_idempotency_key
  )
  returning id into v_doc_id;

  for v_line, v_no in select e.value, e.ordinality from jsonb_array_elements(p_lines) with ordinality e loop
    -- Validates item, unit and piece size now; posting validates again.
    perform private.stock_line_for_item(p_org_id, (v_line ->> 'item_id')::uuid,
      (v_line ->> 'pieces')::integer, (v_line ->> 'length_mm')::numeric,
      (v_line ->> 'width_mm')::numeric, (v_line ->> 'quantity')::numeric, true);
    perform private.assert_stock_location(p_org_id, (v_line ->> 'location_id')::uuid);
    -- A missing piece comes out of a known lot; only found stock may come without.
    if (v_line ->> 'lot_id') is null
      and coalesce((v_line ->> 'pieces')::numeric, (v_line ->> 'quantity')::numeric) < 0 then
      raise exception 'lot_not_found' using errcode = 'P0002';
    end if;
    if (v_line ->> 'lot_id') is not null and not exists (
      select 1 from public.stock_lots l
      where l.id = (v_line ->> 'lot_id')::uuid and l.organization_id = p_org_id
        and l.item_id = (v_line ->> 'item_id')::uuid
    ) then
      raise exception 'lot_not_found' using errcode = 'P0002';
    end if;

    insert into public.stock_adjustment_lines (
      organization_id, document_id, line_no, item_id, lot_id, location_id,
      length_mm, width_mm, pieces, quantity
    ) values (
      p_org_id, v_doc_id, v_no, (v_line ->> 'item_id')::uuid, (v_line ->> 'lot_id')::uuid,
      (v_line ->> 'location_id')::uuid, (v_line ->> 'length_mm')::numeric,
      (v_line ->> 'width_mm')::numeric, (v_line ->> 'pieces')::integer,
      case when (v_line ->> 'pieces') is null then (v_line ->> 'quantity')::numeric end
    );
  end loop;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
  values (p_org_id, auth.uid(), 'stock.adjustment_requested', 'stock_documents', v_doc_id::text,
    jsonb_build_object('reason', v_reason, 'lines', jsonb_array_length(p_lines)));

  if p_post then
    perform private.post_stock_adjustment(v_doc_id);
    update public.stock_documents
      set status = 'posted', decided_by = auth.uid(), decided_at = now()
      where id = v_doc_id;
    insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, after)
    values (p_org_id, auth.uid(), 'stock.adjustment_posted', 'stock_documents', v_doc_id::text,
      jsonb_build_object('direct', true));
  end if;

  return v_doc_id;
end;
$$;
