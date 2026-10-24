import { expect, test } from "@playwright/test";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "../scripts/lib/demo-users";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";
import { ensureFloorFixture, FLOOR_MACHINE, FLOOR_OPERATOR } from "./production-fixture";

// Machines, employees, catalogs and the operator's machine screen.
// Requires the seeded demo organization (npm run seed:demo, incl. demo
// machines) and the test tenants (npm run test:db). Writes go to test tenant B,
// whose admin and floor operator no other test signs out (Supabase sign-out
// revokes every session of that user, which would break parallel tests).

const demoUser = (role: (typeof DEMO_USERS)[number]["role"]) => ({
  ...DEMO_USERS.find((user) => user.role === role)!,
  password: demoPassword(),
});

const testAdmin = () => ({ username: "admin", password: testTenantPassword() });

test("head of production sees machines and employees and filters machines", async ({ page }) => {
  await login(page, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");

  const sidebar = page.locator("[data-slot=sidebar]");
  await expect(sidebar.getByRole("link", { name: "Radnici" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Šifarnici" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Mašine" }).click();
  await expectPath(page, "/machines");
  await expect(page.getByRole("cell", { name: "CNC-01", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dodaj mašinu" })).toBeVisible();

  await page.getByRole("searchbox", { name: /Pretraži/ }).fill("pila");
  await expect(page).toHaveURL(/q=pila/);
  await expect(page.getByRole("cell", { name: "PILA-01", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "CNC-01", exact: true })).toHaveCount(0);

  await sidebar.getByRole("link", { name: "Radnici" }).click();
  await expectPath(page, "/employees");
  const rowOf = (name: string) => page.getByRole("row").filter({ hasText: name });
  await expect(rowOf("Omer Operater")).toBeVisible();
  await page.getByRole("combobox", { name: "Vještine" }).selectOption({ label: "Zavarivanje TIG" });
  await expect(page).toHaveURL(/skill=/);
  await expect(rowOf("Benjamin Bravar")).toBeVisible();
  await expect(rowOf("Omer Operater")).toHaveCount(0);
});

test("warehouse sees machines read-only and no employees", async ({ page }) => {
  await login(page, demoUser("warehouse"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");

  const sidebar = page.locator("[data-slot=sidebar]");
  await expect(sidebar.getByRole("link", { name: "Radnici" })).toHaveCount(0);
  await sidebar.getByRole("link", { name: "Mašine" }).click();
  await expect(page.getByRole("cell", { name: "CNC-01", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dodaj mašinu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Akcije za mašinu/ })).toHaveCount(0);

  await page.goto("/employees");
  await expect(page.getByText("Nemate pristup")).toBeVisible();
  await page.goto("/settings/catalogs");
  await expect(page.getByText("Nemate pristup")).toBeVisible();
});

test("admin manages catalogs, machines and employees", async ({ page }) => {
  // Runs in a test tenant so demo data stays clean.
  const run = Date.now().toString(36).toUpperCase();
  const type = `E2E tip ${run}`;
  const skill = `E2E vještina ${run}`;
  const code = `E2E-${run}`;

  await login(page, testAdmin(), TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");

  // Catalogs: add a machine type and a skill; duplicates are refused.
  await page.goto("/settings/catalogs?kind=machine_type");
  await page.getByLabel("Novi naziv").fill(type);
  await page.getByRole("button", { name: "Dodaj", exact: true }).click();
  await expect(page.getByRole("cell", { name: type })).toBeVisible();
  await page.getByLabel("Novi naziv").fill(type.toLowerCase());
  await page.getByRole("button", { name: "Dodaj", exact: true }).click();
  await expect(page.getByText("Aktivna stavka s tim nazivom već postoji.")).toBeVisible();

  await page.getByRole("link", { name: "Vještine" }).click();
  await expect(page).toHaveURL(/kind=skill/);
  await expect(page.getByRole("link", { name: "Vještine" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByLabel("Novi naziv").fill(skill);
  await page.getByRole("button", { name: "Dodaj", exact: true }).click();
  await expect(page.getByRole("cell", { name: skill })).toBeVisible();

  // Machine: validation, create, edit.
  await page.goto("/machines");
  await page.getByRole("button", { name: "Dodaj mašinu" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Dodaj mašinu" }).click();
  await expect(sheet.getByText("Unesite oznaku (do 50 znakova).")).toBeVisible();
  await sheet.getByLabel("Oznaka").fill(code);
  await sheet.getByLabel("Naziv").fill("E2E glodalica");
  await sheet.getByLabel("Tip mašine").selectOption({ label: type });
  await sheet.getByLabel("Proizvođač").fill("Haas");
  await sheet.getByRole("button", { name: "Dodaj mašinu" }).click();
  await expect(page.getByText(`Mašina ${code} je dodana.`)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("searchbox", { name: /Pretraži/ }).fill(code);
  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toContainText(type);
  await row.getByRole("button", { name: `Akcije za mašinu ${code}` }).click();
  await page.getByRole("menuitem", { name: "Uredi" }).click();
  await page.getByRole("dialog").getByLabel("Naziv").fill("E2E glodalica 2");
  await page.getByRole("dialog").getByLabel("Status").selectOption({ label: "Održavanje" });
  await page.getByRole("button", { name: "Sačuvaj promjene" }).click();
  await expect(row).toContainText("E2E glodalica 2");
  await expect(row).toContainText("Održavanje");

  // Duplicate code is reported next to the field.
  await page.getByRole("button", { name: "Dodaj mašinu" }).click();
  await page.getByRole("dialog").getByLabel("Oznaka").fill(code.toLowerCase());
  await page.getByRole("dialog").getByLabel("Naziv").fill("Duplikat");
  await page.getByRole("dialog").getByRole("button", { name: "Dodaj mašinu" }).click();
  await expect(page.getByRole("dialog").getByText("Oznaka je već zauzeta.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Employee with a skill and the new machine.
  await page.goto("/employees");
  await page.getByRole("button", { name: "Dodaj radnika" }).click();
  const employeeSheet = page.getByRole("dialog");
  await employeeSheet.getByLabel("Ime", { exact: true }).fill("E2E");
  await employeeSheet.getByLabel("Prezime").fill(`Radnik ${run}`);
  await employeeSheet.getByLabel(`Nivo za vještinu ${skill}`).selectOption({ label: "Napredno" });
  await employeeSheet.getByText(code, { exact: false }).click();
  await employeeSheet.getByRole("button", { name: "Dodaj radnika" }).click();
  await expect(page.getByText(`Radnik E2E Radnik ${run} je dodan.`)).toBeVisible();

  await page.getByRole("searchbox", { name: /Pretraži/ }).fill(run);
  const employeeRow = page.getByRole("row").filter({ hasText: `E2E Radnik ${run}` });
  await expect(employeeRow).toContainText(`${skill} · Napredno`);
  await expect(employeeRow).toContainText(code);

  // Archive the employee and the machine; archived rows move to the archive view.
  await employeeRow.getByRole("button", { name: /Akcije za radnika/ }).click();
  await page.getByRole("menuitem", { name: "Arhiviraj" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Arhiviraj" }).click();
  await expect(page.getByText(`Radnik E2E Radnik ${run} je arhiviran.`)).toBeVisible();
  await expect(employeeRow).toHaveCount(0);

  await page.goto(`/machines?q=${code}`);
  await row.getByRole("button", { name: `Akcije za mašinu ${code}` }).click();
  await page.getByRole("menuitem", { name: "Arhiviraj" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Arhiviraj" }).click();
  await expect(page.getByText(`Mašina ${code} je arhivirana.`)).toBeVisible();
  await expect(page.getByText("Nema rezultata")).toBeVisible();
  await page.getByRole("combobox", { name: "Prikaz" }).selectOption({ label: "Arhivirane mašine" });
  await expect(page.getByRole("cell", { name: code, exact: true })).toBeVisible();
});

test.describe("shop floor", () => {
  test.beforeAll(async () => {
    // Also resets the fixture machine to 'available'.
    await ensureFloorFixture();
  });

  test("operator changes the status of an assigned machine @mobile", async ({ page }) => {
    await login(
      page,
      { username: FLOOR_OPERATOR.username, password: testTenantPassword() },
      TEST_TENANTS.b.slug,
    );
    await expectPath(page, "/floor");

    const nav = page.getByRole("navigation", { name: "Navigacija" });
    await nav.getByRole("link", { name: "Mašine" }).click();
    await expectPath(page, "/floor/machines");

    const group = page.getByRole("group", { name: `Status mašine ${FLOOR_MACHINE.code}` });
    await expect(group).toBeVisible();
    const stopped = group.getByRole("button", { name: "Stoji" });
    const available = group.getByRole("button", { name: "Dostupna" });
    await expect(available).toHaveAttribute("aria-pressed", "true");

    await stopped.click();
    await expect(page.getByText(`${FLOOR_MACHINE.code}: Stoji`)).toBeVisible();
    await expect(stopped).toHaveAttribute("aria-pressed", "true");
    const box = await stopped.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);

    await available.click();
    await expect(available).toHaveAttribute("aria-pressed", "true");
    // 'Neaktivna' is not offered to operators.
    await expect(group.getByRole("button", { name: "Neaktivna" })).toHaveCount(0);
  });
});

test("operator without an employee profile is told why there are no machines @mobile", async ({
  page,
}) => {
  // Test tenant B's own operator has no employee record outside test:db runs.
  await login(page, { username: "operater", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/floor");
  await page.goto("/floor/machines");
  await expect(page.getByText("Račun nije povezan s radnikom")).toBeVisible();
});
