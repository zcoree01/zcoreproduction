import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database, Json } from "@/lib/supabase/types";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Inventory part B: material of a production order. Setup through the API as
// the admin of test tenant B (before the browser signs in, which ends that
// API session): a product paired with a stock item, two bars received, an
// order released (reservation). In the browser: requirement with kerf, issue
// of a bar cut in the warehouse with its offcut back into stock, confirmed
// consumption and the reservation on the stock item. Rows use an E2E prefix.

const PASSWORD = () => testTenantPassword();

async function setup(code: string) {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await supabase.auth.signInWithPassword({
    email: toAuthEmail("admin", TEST_TENANTS.b.slug),
    password: PASSWORD(),
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
        pieces: 2,
        length_mm: 3000,
        heat_number: `T-${code}`,
        unit_price: 2,
        price_unit: "kg",
      },
    ],
  });
  if (receipt.error) throw receipt.error;

  const order = await supabase.rpc("create_production_order", {
    p_org_id: org,
    p_order: {
      customer_id: customer.data.id,
      product_id: product.data,
      quantity: "50",
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
  return { orderId: order.data, itemId: item.data.id };
}

test("warehouse issues a cut bar to an order and confirms the consumption", async ({ page }) => {
  const code = `E2EB-${Date.now().toString(36)}`;
  const { orderId, itemId } = await setup(code);

  await login(page, { username: "admin", password: PASSWORD() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");
  await page.goto(`/orders/${orderId}?tab=material`);
  await page.waitForLoadState("networkidle");

  // 50 × (100 + 2) mm = 5,1 m; 29 pieces per 3000 mm bar → 2 bars.
  await expect(page.getByText("50 kom × (100 mm + 2 mm rez) = 5,1 m")).toBeVisible();
  await expect(page.getByText("29 kom iz šipke od 3000 mm → 2 šipki")).toBeVisible();
  await expect(page.getByText("Nema dovoljno materijala")).toHaveCount(0);

  await page.getByRole("button", { name: "Izdaj materijal" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("Sa stanja")).toContainText(`T-${code}`);
  await expect(sheet.getByLabel("Izrezano komada iz jedne")).toHaveValue("29");
  // 3000 − 29 × 102 = 42 mm back into stock (own material).
  await expect(sheet.getByLabel("Ostatak po komadu – dužina (mm)")).toHaveValue("42");
  await sheet.getByRole("button", { name: "Izdaj" }).click();
  await expect(page.getByText("Materijal je izdat.")).toBeVisible();

  await expect(page.getByRole("row").filter({ hasText: "Ostatak u magacin" })).toContainText(
    "1 × 42 mm",
  );
  await expect(page.getByRole("row").filter({ hasText: "29 kom izrezano" })).toContainText(
    "1 × 3000 mm",
  );

  await page.getByLabel("Stvarno potrošeno (m)").fill("2,9");
  await page.getByRole("button", { name: "Potvrdi potrošnju" }).click();
  await expect(page.getByText("Potrošnja je potvrđena.")).toBeVisible();
  await expect(page.getByText("Potvrđeno: 2,9 m")).toBeVisible();

  await page.goto(`/inventory/${itemId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("row").filter({ hasText: "1 × 42 mm" })).toBeVisible();
  await page.getByRole("tab", { name: /Rezervacije/ }).click();
  // 5,1 m reserved, 2,958 m issued.
  await expect(page.getByRole("row").filter({ hasText: `E2E Kupac ${code}` })).toContainText(
    "2,142 m",
  );
});
