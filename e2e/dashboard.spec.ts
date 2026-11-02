import { expect, test } from "@playwright/test";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Configurable dashboard (D-037) in test tenant B: the admin sees the widgets
// of the admin role, opens the editor, picks the "Kadrovska" role, adds a
// widget, removes one, moves one and saves for that role; then resets it.

test("admin configures the dashboard of a role", async ({ page }) => {
  test.slow();
  const admin = createAdminClient();
  const org = (
    await admin.from("organizations").select("id").eq("slug", TEST_TENANTS.b.slug).single()
  ).data!.id;
  const hr = (
    await admin.from("roles").select("id").eq("organization_id", org).eq("key", "hr").single()
  ).data!.id;
  await admin.from("dashboard_layouts").delete().eq("role_id", hr).throwOnError();

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");
  await expect(page.getByText("Nalozi po statusu")).toBeVisible();
  await expect(page.getByText("Proizvodnja danas")).toBeVisible();

  await page.getByRole("link", { name: "Uredi dashboard" }).click();
  await expectPath(page, "/dashboard/edit");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Uloga", { exact: true }).selectOption({ label: "Kadrovska" });
  await expect(page).toHaveURL(/role=/);
  await expect(page.getByText("Uloga: Kadrovska")).toBeVisible();
  await expect(page.getByTestId("layout-widget-attendance_today")).toBeVisible();
  await expect(page.getByTestId("layout-widget-attendance_requests")).toBeVisible();

  await page.getByRole("button", { name: "Dodaj Proizvodnja danas" }).click();
  await expect(page.getByTestId("layout-widget-output_today")).toContainText(
    "Uloga nema dozvolu za ove podatke",
  );
  await page.getByRole("button", { name: "Ukloni Zahtjevi radnika" }).click();
  await expect(page.getByTestId("layout-widget-attendance_requests")).toHaveCount(0);
  await page
    .getByTestId("layout-widget-output_today")
    .getByRole("button", { name: "Pomjeri naprijed" })
    .click();
  await expect(page.getByTestId("layout-widget-output_today")).toContainText(
    "1. Proizvodnja danas",
  );

  await page.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByText('Dashboard za ulogu "Kadrovska" je sačuvan.')).toBeVisible();
  const saved = await admin.from("dashboard_layouts").select("widgets").eq("role_id", hr).single();
  expect(saved.data?.widgets).toEqual([
    { key: "output_today", size: "normal" },
    { key: "attendance_today", size: "normal" },
  ]);

  await expect(page.getByText("Prilagođen raspored")).toBeVisible();
  await page.getByRole("button", { name: "Vrati zadano" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Vrati zadano" }).click();
  await expect(page.getByText('Uloga "Kadrovska" ima ponovo zadani dashboard.')).toBeVisible();
  const reset = await admin.from("dashboard_layouts").select("id").eq("role_id", hr);
  expect(reset.data).toEqual([]);
});
