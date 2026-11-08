import { expect, test } from "@playwright/test";
import { ensureOrganization, ensureUser } from "../src/modules/organizations/provision";
import { SELLABLE_MODULES } from "../src/modules/platform/modules";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Packages and locking (D-049). The platform admin (db.platform, active only
// during the run) creates a package, gives it to tenant B and locks the firm;
// tenant B sees the lock in the management app and on the floor. Cleanup puts
// tenant B back without billing and with every module.

const PLATFORM_USER = { username: "db.platform", password: testTenantPassword() };
const TENANT_ADMIN = { username: "admin", password: testTenantPassword() };
const TENANT_OPERATOR = { username: "operater", password: testTenantPassword() };
const PACKAGE = `E2E paket ${Date.now().toString(36)}`;
let platformUserId = "";
let tenantId = "";

async function resetTenant() {
  const service = createAdminClient();
  await service.from("billing_payments").delete().eq("organization_id", tenantId);
  await service.from("organization_packages").delete().eq("organization_id", tenantId);
  await service.from("organization_billing").delete().eq("organization_id", tenantId);
  await service
    .from("org_modules")
    .update({ enabled: true, active_until: null })
    .eq("organization_id", tenantId)
    .in("module_key", ["core", ...SELLABLE_MODULES]);
  const packages = await service.from("billing_packages").select("id").like("name", "E2E paket%");
  const ids = (packages.data ?? []).map((row) => row.id);
  if (ids.length > 0) {
    await service.from("organization_packages").delete().in("package_id", ids);
    await service.from("billing_package_modules").delete().in("package_id", ids);
    await service.from("billing_package_prices").delete().in("package_id", ids);
    await service.from("billing_packages").delete().in("id", ids);
  }
}

test.beforeAll(async () => {
  const service = createAdminClient();
  const zcore = await ensureOrganization(service, { slug: "zcore", name: "Zcore" });
  platformUserId = await ensureUser(service, zcore, {
    username: PLATFORM_USER.username,
    password: PLATFORM_USER.password,
    fullName: "DB Platform",
    role: "admin",
  });
  await service.from("memberships").update({ archived_at: null }).eq("user_id", platformUserId);
  const tenant = await ensureOrganization(service, TEST_TENANTS.b);
  tenantId = tenant.id;
  await resetTenant();
});

test.afterAll(async () => {
  await resetTenant();
  await createAdminClient()
    .from("memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", platformUserId);
});

test("platform admin creates a package, locks a firm and unlocks it", async ({ page, browser }) => {
  await login(page, PLATFORM_USER, "zcore");
  await expectPath(page, "/dashboard");

  // Package in the platform settings.
  await page.goto("/platform/settings");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Novi paket" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Naziv").fill(PACKAGE);
  await sheet.getByLabel("Mjesečna cijena (KM)").fill("120");
  // Planning needs production: checking it checks production as well.
  await sheet.getByRole("checkbox", { name: "Planiranje" }).click();
  await expect(sheet.getByRole("checkbox", { name: "Proizvodnja" })).toBeChecked();
  await sheet.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByText(`Paket ${PACKAGE} je sačuvan.`)).toBeVisible();

  // The firm gets the package and is locked by hand.
  await page.goto("/platform");
  await page.getByRole("link", { name: TEST_TENANTS.b.name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: TEST_TENANTS.b.name })).toBeVisible();
  await page.getByLabel("Paket", { exact: true }).selectOption({ label: PACKAGE });
  await expect(page.getByText("Paket je promijenjen.")).toBeVisible();
  await page.getByRole("button", { name: "Zaključaj" }).click();
  await page.getByRole("dialog").getByLabel("Razlog").fill("E2E provjera zaključavanja");
  await page.getByRole("dialog").getByRole("button", { name: "Zaključaj" }).click();
  await expect(page.getByText(`Firma ${TEST_TENANTS.b.name} je zaključana.`)).toBeVisible();

  // The firm's admin sees the lock and cannot create an order.
  const orgContext = await browser.newContext();
  const org = await orgContext.newPage();
  await login(org, TENANT_ADMIN, TEST_TENANTS.b.slug);
  await expectPath(org, "/dashboard");
  await expect(org.getByTestId("billing-notice")).toContainText("Firma je zaključana.");
  await org.goto("/orders");
  await org.waitForLoadState("networkidle");
  await expect(org.getByRole("button", { name: "Novi nalog" })).toHaveCount(0);

  // Unlocked: the strip is gone on the next page.
  await page.getByRole("button", { name: "Otključaj" }).click();
  await expect(page.getByText(`Firma ${TEST_TENANTS.b.name} je otključana.`)).toBeVisible();
  await org.reload();
  await expect(org.getByTestId("billing-notice")).toHaveCount(0);
  await orgContext.close();
});

test("@mobile the operator of a locked firm still opens the floor", async ({ page }) => {
  const service = createAdminClient();
  await service.from("organization_billing").upsert(
    {
      organization_id: tenantId,
      locked_at: new Date().toISOString(),
      locked_reason: "E2E",
    },
    { onConflict: "organization_id" },
  );
  try {
    await login(page, TENANT_OPERATOR, TEST_TENANTS.b.slug);
    await expectPath(page, "/floor");
    await expect(page.getByTestId("billing-notice")).toContainText("završiti započete naloge");
  } finally {
    await service
      .from("organization_billing")
      .update({ locked_at: null, locked_reason: null })
      .eq("organization_id", tenantId);
  }
});
