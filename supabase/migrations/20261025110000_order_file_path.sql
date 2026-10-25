-- Storage path of a drawing for the caller, or null when they may not open it:
-- products.read in its organization, or a floor user who sees an operation
-- of an order the drawing is on (same rule as the storage policy
-- product_files_select_orders). Operators cannot read product_attachments.
create function public.order_file_path(p_attachment_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.storage_path
  from public.product_attachments a
  where a.id = p_attachment_id
    and a.organization_id in (select private.user_org_ids())
    and (
      private.has_permission(a.organization_id, 'products.read')
      or private.can_read_order_file(a.storage_path)
    )
$$;

revoke execute on function public.order_file_path(uuid) from public, anon;
grant execute on function public.order_file_path(uuid) to authenticated;
