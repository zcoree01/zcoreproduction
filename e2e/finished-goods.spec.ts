import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Inventory part D: finished goods and delivery notes in test tenant B. Setup
// with the service role (no sign-in): a customer, a product with one
// operation, a released order with customer position "Poz. 10" and 12 good
// pieces reported. In the browser the admin receives 8 pieces, issues a
// delivery note for 5 and prints it. Rows use an E2E prefix.

async function seed(code: string) {
  const admin = createAdminClient();
  const org = (
    await admin.from("organizations").select("id").eq("slug", TEST_TENANTS.b.slug).single()
  ).data!.id;
  const customer = (
    await admin
      .from("customers")
      .insert({ organization_id: org, name: `E2E Kupac ${code}` })
      .select("id")
      .single()
      .throwOnError()
  ).data;
  const type = (
    await admin
      .from("operation_types")
      .insert({
        organization_id: org,
        code: code.slice(-8).toUpperCase(),
        name: `E2E Tokarenje ${code}`,
      })
      .select("id")
      .single()
      .throwOnError()
  ).data;
  const product = (
    await admin
      .from("products")
      .insert({
        organization_id: org,
        part_number: code,
        name: "E2E čep",
        customer_id: customer.id,
        unit: "pcs",
      })
      .select("id")
      .single()
      .throwOnError()
  ).data;
  const revision = (
    await admin
      .from("product_revisions")
      .insert({
        organization_id: org,
        product_id: product.id,
        is_current: true,
        drawing_number: `CRT-${code}`,
      })
      .select("id")
      .single()
      .throwOnError()
  ).data;
  await admin
    .from("product_operations")
    .insert({
      organization_id: org,
      revision_id: revision.id,
      sequence: 1,
      operation_type_id: type.id,
    })
    .throwOnError();
  const order = (
    await admin
      .from("production_orders")
      .insert({
        organization_id: org,
        customer_id: customer.id,
        product_id: product.id,
        revision_id: revision.id,
        unit: "pcs",
        quantity: 12,
        due_date: "2030-06-30",
        customer_position: "Poz. 10",
        notes: `E2E ${code}`,
        order_number: "-",
        order_year: 2000,
        order_sequence: 1,
      })
      .select("id")
      .single()
      .throwOnError()
  ).data;
  await admin
    .from("production_order_operations")
    .insert({ organization_id: org, order_id: order.id, sequence: 1, operation_type_id: type.id })
    .throwOnError();
  await admin
    .from("production_orders")
    .update({ status: "planned" })
    .eq("id", order.id)
    .throwOnError();
  const op = (
    await admin
      .from("production_order_operations")
      .select("id")
      .eq("order_id", order.id)
      .single()
      .throwOnError()
  ).data;
  await admin
    .from("production_reports")
    .insert({
      organization_id: org,
      order_id: order.id,
      operation_id: op.id,
      good_quantity: 12,
      scrap_quantity: 0,
      idempotency_key: randomUUID(),
    })
    .throwOnError();
  return { orderId: order.id, customer: `E2E Kupac ${code}` };
}

test("head of production receives good pieces and issues a delivery note", async ({ page }) => {
  test.slow();
  const code = `E2ED-${Date.now().toString(36)}`;
  const { orderId, customer } = await seed(code);

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");
  await page.goto(`/orders/${orderId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Može se primiti: 12 kom")).toBeVisible();
  await page.getByLabel("Količina za prijem").fill("8");
  await page.getByRole("button", { name: "Primi u magacin" }).click();
  await expect(page.getByText("Komadi su primljeni u magacin gotovih proizvoda.")).toBeVisible();
  await expect(page.getByText("Može se primiti: 4 kom")).toBeVisible();

  await page.getByRole("link", { name: "Nova otpremnica" }).click();
  await expectPath(page, "/inventory/delivery-notes/new");
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Kupac")).toHaveValue(/.+/);
  await expect(page.getByLabel("Pozicija kupca")).toHaveValue("Poz. 10");
  await page.getByLabel("Količina (na stanju 8)").fill("5");
  await page.getByRole("button", { name: "Izdaj otpremnicu" }).click();
  await expect(page.getByText("Otpremnica je izdata.")).toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(`· ${customer}$`) })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Poz. 10" })).toContainText("5 kom");
  await expect(page.getByRole("row").filter({ hasText: "Poz. 10" })).toContainText(`CRT-${code}`);
  const noteUrl = page.url();

  await page.goto(`${noteUrl}/print`);
  await expect(page.getByRole("heading", { name: "Otpremnica" })).toBeVisible();
  await expect(page.getByText(customer)).toBeVisible();
  await expect(page.getByText("Preuzeo")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Poz. 10" })).toBeVisible();

  await page.goto("/inventory/finished");
  await expect(page.getByRole("row").filter({ hasText: code })).toContainText("3 kom");

  await page.goto("/settings/delivery-notes");
  await expect(page.getByText(/^Primjer: 03-\d{4}-122$/)).toBeVisible();
});
