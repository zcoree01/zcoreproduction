import { expect, test } from "@playwright/test";
import { ensureOrganization } from "@/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Postavke → Organizacija (D-063) in test tenant B: the admin changes the time
// zone after confirming, it survives a reload; the operator never gets there.
// The zone goes back to Europe/Sarajevo at the end.

const HOME_ZONE = "Europe/Sarajevo";

test("admin changes the organization's time zone", async ({ page }) => {
  const admin = createAdminClient();
  const org = await ensureOrganization(admin, TEST_TENANTS.b);
  const setZone = (timezone: string) =>
    admin.from("organizations").update({ timezone }).eq("id", org.id).throwOnError();
  await setZone(HOME_ZONE);

  try {
    await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
    await expectPath(page, "/dashboard");
    await page.getByRole("link", { name: "Organizacija" }).click();
    await expectPath(page, "/settings/organization");

    const zone = page.getByLabel("Vremenska zona");
    await expect(zone).toHaveValue(HOME_ZONE);
    await expect(page.getByText(/Trenutno vrijeme u izabranoj zoni/)).toBeVisible();
    const save = page.getByRole("button", { name: "Sačuvaj" });
    await expect(save).toBeDisabled();

    await zone.selectOption("Europe/London");
    await save.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("London");
    await dialog.getByRole("button", { name: "Promijeni zonu" }).click();
    await expect(page.getByText("Vremenska zona je sačuvana.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Vremenska zona")).toHaveValue("Europe/London");
    const { data } = await admin
      .from("organizations")
      .select("timezone")
      .eq("id", org.id)
      .single()
      .throwOnError();
    expect(data.timezone).toBe("Europe/London");
  } finally {
    await setZone(HOME_ZONE);
  }
});

test("operator cannot open the organization settings", async ({ page }) => {
  await login(page, { username: "operater", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/floor");
  await page.goto(`/settings/organization?org=${TEST_TENANTS.b.slug}`);
  await expectPath(page, "/floor");
});
