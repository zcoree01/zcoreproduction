import { expect, test } from "@playwright/test";
import { ensureOrganization, ensureUser } from "../src/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login, signOutFromApp } from "./helpers";

// Zcore platform admin and support access (D-026). Uses the platform test
// user db.platform (also used by test:db), active only during the run.

const PLATFORM_USER = { username: "db.platform", password: testTenantPassword() };
let platformUserId = "";

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
  const tenantA = await service
    .from("organizations")
    .select("id")
    .eq("slug", TEST_TENANTS.a.slug)
    .single();
  await service
    .from("support_access_requests")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("organization_id", tenantA.data?.id ?? "")
    .in("status", ["pending", "approved", "active"]);
});

test.afterAll(async () => {
  await createAdminClient()
    .from("memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", platformUserId);
});

test("platform admin gets support access only after the organization approves it", async ({
  page,
}) => {
  // The platform admin sees organizations and modules, not their data.
  await login(page, PLATFORM_USER, "zcore");
  await expectPath(page, "/dashboard");
  await page.getByRole("link", { name: "Firme" }).click();
  await expectPath(page, "/platform");
  await page.waitForLoadState("networkidle");
  const card = page.locator("[data-slot=card]").filter({ hasText: TEST_TENANTS.a.name });
  await expect(card.getByText("Proizvodnja")).toBeVisible();
  await card.getByRole("button", { name: "Zatraži pristup" }).click();
  await card.getByLabel("Razlog (vidi ga firma)").fill("E2E provjera podrške");
  await card.getByRole("button", { name: "Pošalji zahtjev" }).click();
  await expect(card.getByText("Čeka odobrenje firme")).toBeVisible();
  await expect(card.getByRole("button", { name: "Uđi u firmu" })).toHaveCount(0);
  await signOutFromApp(page, "DB Platform");

  // The organization's admin approves for 30 minutes.
  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");
  await page.getByRole("link", { name: "Zcore podrška" }).click();
  await expect(page.getByText("E2E provjera podrške").first()).toBeVisible();
  await page.getByLabel("Trajanje pristupa").selectOption({ label: "30 minuta" });
  await page.getByRole("button", { name: "Odobri pristup" }).click();
  await expect(page.getByText("Pristup je odobren.")).toBeVisible();
  await signOutFromApp(page, `${TEST_TENANTS.a.name} Admin`);

  // The platform admin enters: banner inside the organization, then ends it.
  await login(page, PLATFORM_USER, "zcore");
  await expectPath(page, "/dashboard");
  await page.goto("/platform");
  // Clicking before the (dev) page is hydrated would do nothing.
  await page.waitForLoadState("networkidle");
  await page
    .locator("[data-slot=card]")
    .filter({ hasText: TEST_TENANTS.a.name })
    .getByRole("button", { name: "Uđi u firmu" })
    .click();
  await expectPath(page, "/dashboard");
  await expect(
    page.getByText("Zcore podrška (DB Platform) je prijavljena", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Završi podršku" }).click();
  await expectPath(page, "/login");

  // Access is gone: the organization sees the session as ended.
  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/settings/support");
  await expect(page.getByText("Završeno").first()).toBeVisible();
});
