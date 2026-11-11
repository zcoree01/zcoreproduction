import { expect, test } from "@playwright/test";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// A locked firm (D-049) keeps inventory.move for issues on orders, but
// receipts and counts are refused by the database: their buttons are hidden
// instead of failing with "denied" (D-059). Tenant A is locked only here.

const ADMIN = { username: "admin", password: testTenantPassword() };

test("a locked firm sees no receipt or count buttons", async ({ page }) => {
  const service = createAdminClient();
  const tenant = await service
    .from("organizations")
    .select("id")
    .eq("slug", TEST_TENANTS.a.slug)
    .single()
    .throwOnError();
  const lock = (locked: boolean) =>
    service
      .from("organization_billing")
      .upsert(
        {
          organization_id: tenant.data.id,
          locked_at: locked ? new Date().toISOString() : null,
          locked_reason: locked ? "E2E" : null,
        },
        { onConflict: "organization_id" },
      )
      .throwOnError();

  await lock(true);
  try {
    await login(page, ADMIN, TEST_TENANTS.a.slug);
    await expectPath(page, "/dashboard");
    await expect(page.getByTestId("billing-notice")).toContainText("Firma je zaključana.");
    await page.goto("/inventory/receipts");
    await expect(page.getByRole("heading", { name: "Prijem materijala" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Novi prijem" })).toHaveCount(0);
    await page.goto("/inventory/counts");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Novi popis" })).toHaveCount(0);
  } finally {
    await lock(false);
  }

  // Unlocked again: the buttons are back.
  await page.goto("/inventory/receipts");
  // The header button, and again in the empty state when there are no receipts.
  await expect(page.getByRole("link", { name: "Novi prijem" }).first()).toBeVisible();
  await page.goto("/inventory/counts");
  await expect(page.getByRole("button", { name: "Novi popis" })).toBeVisible();
});
