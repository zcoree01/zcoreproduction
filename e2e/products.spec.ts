import { expect, test } from "@playwright/test";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "../scripts/lib/demo-users";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Products, routings, revisions and attachments. Reads use the seeded demo
// product (npm run seed:demo); writes go to test tenant B (its admin is not
// signed out by other tests). Each run adds one operation type and one product
// (archived at the end) with an E2E prefix.

const demoUser = (role: (typeof DEMO_USERS)[number]["role"]) => ({
  ...DEMO_USERS.find((user) => user.role === role)!,
  password: demoPassword(),
});

test("head of production opens a product with its routing", async ({ page }) => {
  await login(page, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");

  await page.locator("[data-slot=sidebar]").getByRole("link", { name: "Proizvodi" }).click();
  await expectPath(page, "/products");
  await page.getByRole("searchbox", { name: /Pretraži/ }).fill("4711");
  await expect(page).toHaveURL(/q=4711/);
  await page.getByRole("link", { name: "DM-4711-02" }).click();

  await expect(page.getByRole("heading", { name: "DM-4711-02" })).toBeVisible();
  await expect(page.getByText("C45", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Operacije/ }).click();
  await expect(page).toHaveURL(/tab=operations/);
  const rowOf = (text: string) => page.getByRole("row").filter({ hasText: text });
  await expect(rowOf("Tokarenje")).toContainText("CNC-02");
  await expect(rowOf("Cinčanje")).toContainText("Cinkara Zenica");
  // 5 + 30 + 20 + 0 min setup; 60 + 95 + 140 + 30 s per piece.
  await expect(rowOf("Ukupno")).toContainText("0 h 55 min 0 s");
  await expect(rowOf("Ukupno")).toContainText("0 h 5 min 25 s");
  await page.getByLabel("Količina (kom)").fill("100");
  await expect(page.getByText("Za 100 kom: 9 h 56 min 40 s")).toBeVisible();
});

test("warehouse reads products without editing", async ({ page }) => {
  await login(page, demoUser("warehouse"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/products");
  await expect(page.getByRole("link", { name: "DM-4711-02" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dodaj proizvod" })).toHaveCount(0);
  await page.getByRole("link", { name: "DM-4711-02" }).click();
  await expect(page.getByRole("button", { name: "Uredi" })).toHaveCount(0);
  await page.goto("/settings/operation-types");
  await expect(page.getByText("Nemate pristup")).toBeVisible();
});

test("admin builds a product with routing, drawing and a new revision", async ({ page }) => {
  const run = Date.now().toString(36).toUpperCase();
  const code = `E${run.slice(-6)}`;
  const partNumber = `E2E-${run}`;

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");

  // Operation type with abbreviation.
  await page.goto("/settings/operation-types");
  await page.getByRole("button", { name: "Dodaj operaciju" }).click();
  const typeSheet = page.getByRole("dialog");
  await typeSheet.getByLabel("Naziv").fill(`E2E Tokarenje ${run}`);
  await typeSheet.getByLabel("Skraćenica").fill(code.toLowerCase());
  await typeSheet.getByRole("button", { name: "Dodaj" }).click();
  await expect(page.getByRole("cell", { name: `E2E Tokarenje ${run}`, exact: true })).toBeVisible();
  await expect(page.getByText(code, { exact: true })).toBeVisible();

  // Product with its first revision.
  await page.goto("/products");
  await page.getByRole("button", { name: "Dodaj proizvod" }).click();
  const productSheet = page.getByRole("dialog");
  await productSheet.getByLabel("Šifra dijela").fill(partNumber);
  await productSheet.getByLabel("Naziv", { exact: true }).fill("E2E osovina");
  await productSheet.getByLabel("Materijal (kvalitet)").fill("C45");
  await productSheet.getByLabel("Presjek sirovca").selectOption("round");
  await productSheet.getByLabel("Prečnik").fill("40");
  await productSheet.getByLabel("Debljina").waitFor({ state: "detached" });
  await productSheet.getByLabel("Dužina reza po komadu").fill("120,5");
  await productSheet.getByRole("button", { name: "Dodaj proizvod" }).click();
  await expect(page.getByRole("heading", { name: partNumber })).toBeVisible();
  await expect(page.getByText("120,5 mm")).toBeVisible();

  // Operation: 30 min setup, 1,5 min per piece.
  await page.getByRole("tab", { name: /Operacije/ }).click();
  await page.getByRole("button", { name: "Dodaj operaciju" }).click();
  const operationSheet = page.getByRole("dialog");
  await expect(operationSheet.getByLabel("Redni broj")).toHaveValue("10");
  await operationSheet
    .getByLabel("Vrsta operacije")
    .selectOption({ label: `${code} – E2E Tokarenje ${run}` });
  await operationSheet.getByLabel("Priprema (min)").fill("30");
  await operationSheet.getByLabel("Ciklus po komadu (min)").fill("1,5");
  await operationSheet.getByRole("button", { name: "Dodaj operaciju" }).click();
  const operationRow = page.getByRole("row").filter({ hasText: `E2E Tokarenje ${run}` });
  await expect(operationRow).toContainText("1,5 min");
  await page.getByLabel("Količina (kom)").fill("10");
  await expect(page.getByText("Za 10 kom: 0 h 45 min 0 s")).toBeVisible();

  // Main drawing (PDF) in the private bucket.
  await page.getByRole("tab", { name: /Prilozi/ }).click();
  await page.getByLabel("Fajl").setInputFiles({
    name: "glavni-crtez.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% e2e\n"),
  });
  await page.getByRole("button", { name: "Učitaj" }).click();
  await expect(page.getByText("glavni-crtez.pdf")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Prilozi/ })).toContainText("1");

  // New revision B copies the routing and the drawing; A becomes history.
  await page.getByRole("button", { name: "Više akcija" }).click();
  await page.getByRole("menuitem", { name: "Nova revizija" }).click();
  const revisionSheet = page.getByRole("dialog");
  await expect(revisionSheet.getByLabel("Oznaka nove revizije")).toHaveValue("B");
  await revisionSheet.getByRole("button", { name: "Napravi reviziju" }).click();
  await expect(page.getByText("Rev. B", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: /Operacije/ })).toContainText("1");
  await expect(page.getByRole("tab", { name: /Prilozi/ })).toContainText("1");

  await page.getByRole("tab", { name: /Historija/ }).click();
  await expect(page.getByText("Napravljena nova revizija B")).toBeVisible();
  await expect(page.getByText(`Proizvod ${partNumber} kreiran`)).toBeVisible();

  // Old revision A is read-only.
  await page.getByRole("link", { name: "Rev. A" }).click();
  await expect(page.getByText("Pregled stare revizije A")).toBeVisible();
  await expect(page.getByRole("button", { name: "Uredi" })).toHaveCount(0);

  // Clean up: archive the product.
  await page.goto("/products");
  await page.getByRole("button", { name: `Akcije za proizvod ${partNumber}` }).click();
  await page.getByRole("menuitem", { name: "Arhiviraj" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Arhiviraj" }).click();
  await expect(page.getByRole("link", { name: partNumber })).toHaveCount(0);
});
