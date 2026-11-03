import { expect, test } from "@playwright/test";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Role editor (D-046) in test tenant B: the admin copies a system role,
// renames it, removes a permission, saves and archives the new role.

const ROLE = "E2E Magacin bez alata";

test("admin copies a system role into a custom role and archives it", async ({ page }) => {
  test.setTimeout(120_000);
  const admin = createAdminClient();
  const org = (
    await admin.from("organizations").select("id").eq("slug", TEST_TENANTS.b.slug).single()
  ).data!.id;
  const old = await admin
    .from("roles")
    .select("id")
    .eq("organization_id", org)
    .like("name", "E2E %");
  for (const role of old.data ?? []) {
    await admin.from("role_permissions").delete().eq("role_id", role.id);
    await admin.from("dashboard_layouts").delete().eq("role_id", role.id);
    await admin.from("roles").delete().eq("id", role.id);
  }

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");
  await page.getByRole("link", { name: "Uloge i dozvole" }).click();
  await expectPath(page, "/settings/roles");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("role-link").filter({ hasText: "Skladištar" }).click();
  await expect(page).toHaveURL(/role=/);
  await expect(page.getByTestId("role-link").filter({ hasText: "Skladištar" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("11 dozvola")).toBeVisible();
  await expect(page.getByText("Sistemska uloga se ne mijenja.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Pregled alata", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Pregled alata", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Kopiraj kao novu ulogu" }).click();
  await page.getByLabel("Naziv uloge").fill(ROLE);
  await page.getByRole("checkbox", { name: "Pregled alata", exact: true }).click();
  await page.getByRole("checkbox", { name: "Upravljanje alatima", exact: true }).click();
  await page.getByRole("button", { name: "Sačuvaj ulogu" }).click();
  await expect(page.getByText(`Uloga „${ROLE}“ je sačuvana.`)).toBeVisible();
  await expect(page).toHaveURL(/role=/);

  const role = await admin
    .from("roles")
    .select("id")
    .eq("organization_id", org)
    .eq("name", ROLE)
    .single();
  const permissions = (
    await admin.from("role_permissions").select("permission_key").eq("role_id", role.data!.id)
  ).data!.map((row) => row.permission_key);
  expect(permissions).toContain("inventory.read");
  expect(permissions).not.toContain("tools.read");
  expect(permissions).not.toContain("tools.manage");
  expect(permissions).not.toContain("users.manage");
  expect(permissions).toHaveLength(9);

  await page.screenshot({ path: "test-results/roles-editor.png", fullPage: true });
  await page.getByRole("button", { name: "Arhiviraj ulogu" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Arhiviraj ulogu" }).click();
  await expect(page.getByText(`Uloga „${ROLE}“ je arhivirana.`)).toBeVisible();
  await expect(page.getByTestId("role-link").filter({ hasText: ROLE })).toHaveCount(0);
});
