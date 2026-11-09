import { expect, test } from "@playwright/test";
import { ensureOrganization, ensureUser } from "../src/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Archive, restore, scheduled deletion (D-049). The firm e2e-arch-<random> is
// created for the run (service role) and purged in afterAll. The Zcore users
// are active only during the run.

const SUFFIX = crypto.randomUUID().slice(0, 8);
const SLUG = `e2e-arch-${SUFFIX}`;
const NAME = `Arhiva E2E ${SUFFIX} d.o.o.`;
const ADMIN = { username: "e2e.arch.admin", password: testTenantPassword() };
const TECH = { username: "e2e.arch.tech", password: testTenantPassword() };
let orgId = "";
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
  const org = await ensureOrganization(service, { slug: SLUG, name: NAME });
  orgId = org.id;
  await service.from("organizations").update({ name: NAME }).eq("id", orgId);
});

test.afterAll(async () => {
  const service = createAdminClient();
  await service.rpc("purge_test_organization", { p_org_id: orgId });
  for (const id of userIds) {
    await service
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", id);
  }
});

test("admin archives a firm, schedules deletion with the exact name, cancels and restores", async ({
  page,
}) => {
  await login(page, ADMIN, "zcore");
  await expectPath(page, "/dashboard");
  await page.goto(`/platform/organizations/${orgId}`);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();

  // Archive with a reason.
  await page.getByRole("button", { name: "Arhiviraj firmu" }).click();
  await page.getByRole("dialog").getByLabel("Razlog").fill("E2E zatvaranje firme");
  await page.getByRole("dialog").getByRole("button", { name: "Arhiviraj" }).click();
  await expect(page.getByText(`Firma ${NAME} je arhivirana.`)).toBeVisible();
  await expect(page.getByTestId("archived-strip")).toContainText("E2E zatvaranje firme");

  // The list: archived firms only under "Arhiva".
  await page.goto("/platform");
  await expect(page.getByRole("link", { name: NAME, exact: true })).toHaveCount(0);
  await page.goto("/platform?filter=archived");
  await expect(page.getByRole("link", { name: NAME, exact: true })).toBeVisible();

  // Delete: first dialog, then the exact name.
  await page.goto(`/platform/organizations/${orgId}`);
  await page.getByRole("button", { name: "Obriši firmu" }).click();
  const first = page.getByRole("alertdialog", {
    name: `Da li ste sigurni da želite obrisati firmu ${NAME}?`,
  });
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: "Da, nastavi" }).click();
  const second = page.getByRole("alertdialog", { name: "Potvrdite brisanje" });
  await expect(second).toContainText(NAME);
  const field = second.getByLabel("Potvrdite brisanje ponovnim upisom punog imena firme");
  const submit = second.getByRole("button", { name: "Obriši", exact: true });
  await expect(submit).toBeDisabled();
  await field.fill(NAME.toLowerCase());
  await expect(submit).toBeDisabled();
  await field.fill(`  ${NAME}  `);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(/Zakazana za brisanje .+/).first()).toBeVisible();
  await expect(page.getByTestId("deletion-strip")).toContainText("Zakazana za brisanje");
  await expect(page.getByRole("button", { name: "Vrati iz arhive" })).toHaveCount(0);

  // Cancel the deletion, then restore.
  await page.getByRole("button", { name: "Opozovi brisanje" }).click();
  await expect(page.getByText(`Brisanje firme ${NAME} je opozvano.`)).toBeVisible();
  await expect(page.getByTestId("deletion-strip")).toHaveCount(0);
  await page.getByRole("button", { name: "Vrati iz arhive" }).click();
  await expect(page.getByText(`Firma ${NAME} je vraćena iz arhive.`)).toBeVisible();
  await expect(page.getByTestId("archived-strip")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Arhiviraj firmu" })).toBeVisible();
});

test("Tehničar sees no archive or delete buttons", async ({ page }) => {
  await login(page, TECH, "zcore");
  await expectPath(page, "/dashboard");
  await page.goto(`/platform/organizations/${orgId}`);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(page.getByRole("button", { name: "Arhiviraj firmu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Obriši firmu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Vrati iz arhive" })).toHaveCount(0);
});
