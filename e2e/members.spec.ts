import { expect, test } from "@playwright/test";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// User management (D-044) in test tenant B: the admin edits a member's name
// and role, deactivates them (sign-in refused), then reactivates them.

const MEMBER = { username: "e2e.clan", fullName: "E2E Član" };

test("admin edits, deactivates and reactivates a user", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const admin = createAdminClient();
  const org = await ensureOrganization(admin, TEST_TENANTS.b);
  const userId = await ensureUser(admin, org, {
    ...MEMBER,
    password: testTenantPassword(),
    role: "operator",
  });
  const operatorRole = (
    await admin
      .from("roles")
      .select("id")
      .eq("organization_id", org.id)
      .eq("key", "operator")
      .single()
  ).data!.id;
  await admin
    .from("memberships")
    .update({ role_id: operatorRole, archived_at: null })
    .eq("user_id", userId)
    .throwOnError();
  await admin
    .from("profiles")
    .update({ full_name: MEMBER.fullName, must_change_password: false })
    .eq("id", userId)
    .throwOnError();

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");
  await page.goto(`/admin/users?q=${MEMBER.username}`);
  const row = page.getByRole("row", { name: new RegExp(MEMBER.username) });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: `Akcije za ${MEMBER.username}` }).click();
  await page.getByRole("menuitem", { name: "Uredi" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Ime i prezime").fill("E2E Član Magacin");
  await sheet.getByLabel("Uloga").selectOption({ label: "Skladištar" });
  await sheet.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByText(`Korisnik ${MEMBER.username} je sačuvan.`)).toBeVisible();
  await expect(row).toContainText("E2E Član Magacin");
  await expect(row).toContainText("Skladištar");

  await row.getByRole("button", { name: `Akcije za ${MEMBER.username}` }).click();
  await page.getByRole("menuitem", { name: "Deaktiviraj" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Deaktiviraj" }).click();
  await expect(page.getByText(`Korisnik ${MEMBER.username} je deaktiviran.`)).toBeVisible();
  await expect(row).toContainText("Neaktivan");

  // The deactivated user cannot sign in.
  const other = await browser.newPage();
  await login(
    other,
    { username: MEMBER.username, password: testTenantPassword() },
    TEST_TENANTS.b.slug,
  );
  await expect(
    other.getByText("Vaš nalog nije aktivan. Obratite se administratoru."),
  ).toBeVisible();
  await other.close();

  await row.getByRole("button", { name: `Akcije za ${MEMBER.username}` }).click();
  await page.getByRole("menuitem", { name: "Aktiviraj ponovo" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aktiviraj ponovo" }).click();
  await expect(page.getByText(`Korisnik ${MEMBER.username} je ponovo aktivan.`)).toBeVisible();
  await expect(row).toContainText("Aktivan");
});
