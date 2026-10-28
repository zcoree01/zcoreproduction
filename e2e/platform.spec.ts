import { expect, test } from "@playwright/test";
import { ensureOrganization, ensureUser } from "../src/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Zcore platform admin and support access (D-026, D-028). Uses the platform
// test user db.platform (also used by test:db), active only during the run.
// Two browsers: the platform admin and the organization's admin.

const PLATFORM_USER = { username: "db.platform", password: testTenantPassword() };
const TENANT_ADMIN = { username: "admin", password: testTenantPassword() };
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

test("support access: dialog for the organization, countdown, ended by the organization, back to Zcore", async ({
  page,
  browser,
}) => {
  // The organization's admin is signed in in another browser.
  const orgContext = await browser.newContext();
  const org = await orgContext.newPage();
  await login(org, TENANT_ADMIN, TEST_TENANTS.a.slug);
  await expectPath(org, "/dashboard");

  // The platform admin sees organizations and modules only; no company settings of its own.
  await login(page, PLATFORM_USER, "zcore");
  await expectPath(page, "/dashboard");
  await expect(page.getByRole("link", { name: "Podaci o firmi" })).toHaveCount(0);
  await page.getByRole("link", { name: "Firme" }).click();
  await expectPath(page, "/platform");
  await page.waitForLoadState("networkidle");
  const card = page.locator("[data-slot=card]").filter({ hasText: TEST_TENANTS.a.name });
  await expect(card.getByText("Proizvodnja")).toBeVisible();
  await card.getByRole("button", { name: "Zatraži pristup" }).click();
  await card.getByLabel("Razlog (vidi ga firma)").fill("E2E provjera podrške");
  await card.getByRole("button", { name: "Pošalji zahtjev" }).click();
  await expect(card.getByText("Čeka odobrenje firme")).toBeVisible();

  // The request pops up for the organization's admin without opening any page.
  const prompt = org.getByRole("alertdialog", { name: "Zcore podrška traži pristup" });
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt.getByText("E2E provjera podrške")).toBeVisible();
  await prompt.getByLabel("Trajanje pristupa").selectOption({ label: "30 minuta" });
  await prompt.getByRole("button", { name: "Odobri pristup" }).click();
  await expect(org.getByText("Pristup je odobren na 30 minuta.")).toBeVisible();

  // The platform admin's page shows the answer by itself and enters.
  const enter = card.getByRole("button", { name: "Uđi u firmu" });
  await expect(enter).toBeVisible({ timeout: 30_000 });
  await enter.click();
  await expectPath(page, "/dashboard");
  await expect(
    page.getByText("Zcore podrška (DB Platform) je prijavljena", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/Preostalo: (29|30):\d\d/)).toBeVisible();

  // The organization ends it: the platform admin is back in Zcore with a notice, no new sign-in.
  await org.goto("/settings/support");
  await org.waitForLoadState("networkidle");
  await org.getByRole("button", { name: "Završi pristup odmah" }).click();
  await expect(org.getByText("Pristup podrške je završen.")).toBeVisible();

  await expectPath(page, "/platform");
  await expect(page.getByText("Sesija podrške je završena. Vraćeni ste u Zcore.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Registrovane firme" })).toBeVisible();

  await orgContext.close();
});
