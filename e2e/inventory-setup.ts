import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database, Json } from "@/lib/supabase/types";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";

// Inventory e2e setup through the API as the admin of test tenant B. Must run
// before the browser signs in as that admin (a sign-in ends the API session).

export type SeedOptions = {
  /** Bars of 3000 mm received at M1. */
  bars?: number;
  /** Pieces ordered (100 + 2 mm per piece). */
  quantity?: number;
  /** Minimum stock of the item in mm. */
  minStock?: number;
};

/** Item, product paired with it, a receipt and a released order (see the specs). */
export async function seedOrderMaterial(code: string, options: SeedOptions = {}) {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await supabase.auth.signInWithPassword({
    email: toAuthEmail("admin", TEST_TENANTS.b.slug),
    password: testTenantPassword(),
  });
  if (signedIn.error) throw signedIn.error;
  const userOrg = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", TEST_TENANTS.b.slug)
    .single();
  if (userOrg.error) throw userOrg.error;
  const org = userOrg.data.id;

  const material = await supabase
    .from("materials")
    .select("id")
    .eq("organization_id", org)
    .eq("designation", "C45")
    .is("archived_at", null)
    .single();
  if (material.error) throw material.error;
  const location = await supabase
    .from("stock_locations")
    .select("id")
    .eq("organization_id", org)
    .eq("code", "M1")
    .is("archived_at", null)
    .single();
  if (location.error) throw location.error;
  const customer = await supabase
    .from("customers")
    .insert({ organization_id: org, name: `E2E Kupac ${code}` })
    .select("id")
    .single();
  if (customer.error) throw customer.error;

  const item = await supabase
    .from("stock_items")
    .insert({
      organization_id: org,
      code,
      name: `C45 Ø50 ${code}`,
      material_id: material.data.id,
      shape: "round_bar",
      diameter_mm: 50,
      base_unit: "mm",
      standard_length_mm: 3000,
      min_stock: options.minStock ?? null,
    })
    .select("id")
    .single();
  if (item.error) throw item.error;

  const product = await supabase.rpc("create_product", {
    p_org_id: org,
    p_product: {
      part_number: code,
      name: "E2E osovina",
      customer_id: customer.data.id,
      unit: "pcs",
    },
    p_revision: {
      revision: "A",
      material_id: material.data.id,
      blank_geometry: "round",
      blank_diameter_mm: "50",
      cut_length_mm: "100",
      kerf_mm: "2",
    } as Json,
  });
  if (product.error) throw product.error;
  const linked = await supabase
    .from("product_revisions")
    .update({ stock_item_id: item.data.id })
    .eq("product_id", product.data);
  if (linked.error) throw linked.error;

  const receipt = await supabase.rpc("post_stock_receipt", {
    p_org_id: org,
    p_idempotency_key: randomUUID(),
    p_header: { supplier: "E2E Čelik" },
    p_lines: [
      {
        item_id: item.data.id,
        location_id: location.data.id,
        pieces: options.bars ?? 2,
        length_mm: 3000,
        heat_number: `T-${code}`,
        unit_price: 2,
        price_unit: "kg",
      },
    ],
  });
  if (receipt.error) throw receipt.error;
  const lot = await supabase
    .from("stock_movements")
    .select("lot_id")
    .eq("document_id", receipt.data)
    .single();
  if (lot.error) throw lot.error;

  const order = await supabase.rpc("create_production_order", {
    p_org_id: org,
    p_order: {
      customer_id: customer.data.id,
      product_id: product.data,
      quantity: String(options.quantity ?? 50),
      due_date: "2030-06-30",
      notes: `E2E ${code}`,
    },
  });
  if (order.error) throw order.error;
  const released = await supabase.rpc("set_production_order_status", {
    p_order_id: order.data,
    p_status: "planned",
  });
  if (released.error) throw released.error;
  return {
    orderId: order.data,
    itemId: item.data.id,
    locationId: location.data.id,
    lotId: lot.data.lot_id,
  };
}
