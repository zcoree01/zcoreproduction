import { expect, test } from "@playwright/test";
import { ensureOrganization, ensureUser } from "../src/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { testTenantPassword } from "../tests/shared/test-tenants";
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
