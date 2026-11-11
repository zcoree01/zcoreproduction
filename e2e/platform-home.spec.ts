import { expect, test } from "@playwright/test";
import { ensureOrganization, ensureUser } from "../src/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Zcore home page (/dashboard for the platform organization). The Zcore users
// are active only during the run.

const ADMIN = { username: "e2e.home.admin", password: testTenantPassword() };
const TECH = { username: "e2e.home.tech", password: testTenantPassword() };
const userIds: string[] = [];

test.beforeAll(async () => {
  const service = createAdminClient();
  const zcore = await ensureOrganization(service, { slug: "zcore", name: "Zcore" });
  for (const [user, role] of [
    [ADMIN, "platform_admin"],
    [TECH, "platform_technician"],
  ] as const) {
    const id = await ensureUser(service, zcore, {
      username: user.username,
      password: user.password,
      fullName: user.username,
      role,
    });
    await service.from("memberships").update({ archived_at: null }).eq("user_id", id);
    userIds.push(id);
  }
});

test.afterAll(async () => {
  const service = createAdminClient();
  for (const id of userIds) {
    await service
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", id);
  }
});

test("Administrator sees revenue, firm states and the to-do tiles", async ({ page }) => {
  await login(page, ADMIN, "zcore");
  await expectPath(page, "/dashboard");
  await expect(page.getByText("Prihod ovaj mjesec", { exact: true })).toBeVisible();
  await expect(page.getByText("Stanje firmi", { exact: true })).toBeVisible();
  await expect(page.getByText("Za riješiti", { exact: true })).toBeVisible();
  await expect(page.getByText("Firme koje kasne s uplatom", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Prihod po mjesecima", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Zahtjevi za imenik \d+ Otvori/ }).click();
  await expectPath(page, "/platform/requests");
});

test("Tehničar sees no revenue", async ({ page }) => {
  await login(page, TECH, "zcore");
  await expectPath(page, "/dashboard");
  await expect(page.getByText("Za riješiti", { exact: true })).toBeVisible();
  // Zcore does not report problems to itself: no "?" button.
  await expect(page.getByRole("button", { name: "Pomoć i prijava problema" })).toHaveCount(0);
  await expect(page.getByText("Prihod ovaj mjesec")).toHaveCount(0);
  await expect(page.getByText("Prihod po mjesecima")).toHaveCount(0);
});

test("a failed permanent deletion is shown on the home, the list and the firm page", async ({
  page,
}) => {
  // The cron records failures with the service role (D-055); tenant B stands in.
  const service = createAdminClient();
  const firm = await service
    .from("organizations")
    .select("id, name")
    .eq("slug", TEST_TENANTS.b.slug)
    .single()
    .throwOnError();
  const error = `E2E rows left after purge: ${Date.now()}`;
  await service
    .rpc("record_purge_failure", { p_org_id: firm.data.id, p_error: error })
    .throwOnError();
  try {
    await login(page, ADMIN, "zcore");
    await expectPath(page, "/dashboard");
    await page.getByTestId("todo-purgeFailed").click();
    await expect(page).toHaveURL(/filter=purge_failed/);
    const row = page.getByRole("row").filter({ hasText: firm.data.name });
    await expect(row.getByText("Brisanje nije uspjelo")).toBeVisible();
    await row.getByRole("link", { name: firm.data.name }).click();
    const strip = page.getByTestId("purge-failed-strip");
    await expect(strip).toContainText("Trajno brisanje nije uspjelo");
    await expect(strip).toContainText(error);
  } finally {
    await service
      .from("organization_purge_failures")
      .delete()
      .eq("organization_id", firm.data.id)
      .throwOnError();
  }
});

test("the trials tile and the list filter it opens show the same firms", async ({ page }) => {
  // Tenant B gets one module trial ending in 3 days for this test only.
  const service = createAdminClient();
  const firm = await service
    .from("organizations")
    .select("id, name")
    .eq("slug", TEST_TENANTS.b.slug)
    .single()
    .throwOnError();
  const trial = await service
    .from("org_modules")
    .select("module_key, active_until")
    .eq("organization_id", firm.data.id)
    .eq("enabled", true)
    // A sellable module: core and platform never have a trial end.
    .not("module_key", "in", "(core,platform)")
    .order("module_key")
    .limit(1)
    .single()
    .throwOnError();
  const restore = trial.data.active_until;
  const setUntil = (value: string | null) =>
    service
      .from("org_modules")
      .update({ active_until: value })
      .eq("organization_id", firm.data.id)
      .eq("module_key", trial.data.module_key)
      .throwOnError();
  await setUntil(new Date(Date.now() + 3 * 86_400_000).toISOString());
  try {
    await login(page, ADMIN, "zcore");
    await expectPath(page, "/dashboard");
    const tile = page.getByTestId("todo-trialsEnding");
    const count = (await tile.locator("span.text-2xl").textContent())?.trim() ?? "";
    expect(Number(count)).toBeGreaterThanOrEqual(1);
    await tile.click();
    await expect(page).toHaveURL(/filter=trial_ending/);
    await expect(
      page.getByRole("link", { name: `Probe ističu (7 dana) (${count})` }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: firm.data.name, exact: true })).toBeVisible();
  } finally {
    await setUntil(restore);
  }
});
