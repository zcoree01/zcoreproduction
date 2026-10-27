import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "../scripts/lib/demo-users";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Customers, products, routings, revisions and attachments. Reads use the
// seeded demo product (npm run seed:demo); writes go to test tenant B (its
// admin is not signed out by other tests). Each run adds two operation types,
// a customer and a product (archived at the end) with an E2E prefix.

const demoUser = (role: (typeof DEMO_USERS)[number]["role"]) => ({
  ...DEMO_USERS.find((user) => user.role === role)!,
  password: demoPassword(),
});

/** Types into a search select and picks the first option matching `option`. */
async function pick(page: Page, input: Locator, query: string, option: RegExp) {
  await input.fill(query);
  await page.getByRole("option", { name: option }).first().click();
}

test("head of production opens a product with its routing and customer", async ({ page }) => {
  await login(page, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");

  await page.locator("[data-slot=sidebar]").getByRole("link", { name: "Proizvodi" }).click();
  await expectPath(page, "/products");
  await page.getByRole("searchbox", { name: /Pretraži/ }).fill("4711");
  await expect(page).toHaveURL(/q=4711/);
  await expect(page.getByRole("row").filter({ hasText: "DM-4711-02" })).toContainText(
    "Demo Kupac d.o.o.",
  );
  await page.getByRole("link", { name: "DM-4711-02" }).click();

  await expect(page.getByRole("heading", { name: "DM-4711-02" })).toBeVisible();
  // C45, Ø45 × 125 mm: 1,561 kg raw piece.
  await expect(page.getByText("(Čelik)")).toBeVisible();
  await expect(page.getByText("1,561 kg")).toBeVisible();
  await page.getByRole("tab", { name: /Operacije/ }).click();
  await expect(page).toHaveURL(/tab=operations/);
  const rowOf = (text: string) => page.getByRole("row").filter({ hasText: text });
  await expect(rowOf("Tokarenje")).toContainText("CNC-02");
  await expect(rowOf("Tokarenje")).toContainText("1,6 min");
  await expect(rowOf("Cinčanje")).toContainText("Cinkara Zenica");
  // 5 + 30 + 20 + 0 min setup; 60 + 95 + 140 + 30 s per piece.
  await expect(rowOf("Ukupno")).toContainText("0 h 55 min 0 s");
  await expect(rowOf("Ukupno")).toContainText("0 h 5 min 25 s");
  await page.getByLabel("Količina (kom)").fill("100");
  await expect(page.getByText("Za 100 kom: 9 h 56 min 40 s")).toBeVisible();

  await page.getByRole("link", { name: "Demo Kupac d.o.o." }).first().click();
  await expect(page.getByRole("heading", { name: "Demo Kupac d.o.o." })).toBeVisible();
  await expect(page.getByRole("link", { name: "DM-4711-02" })).toBeVisible();
});

test("warehouse reads products and customers without editing", async ({ page }) => {
  await login(page, demoUser("warehouse"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/products");
  await expect(page.getByRole("link", { name: "DM-4711-02" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dodaj proizvod" })).toHaveCount(0);
  await page.getByRole("link", { name: "DM-4711-02" }).click();
  await expect(page.getByRole("button", { name: "Uredi" })).toHaveCount(0);
  await page.goto("/customers");
  await expect(page.getByRole("link", { name: "Demo Kupac d.o.o." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dodaj kupca" })).toHaveCount(0);
  await page.goto("/settings/materials");
  await expect(page.getByText("Nemate pristup")).toBeVisible();
});

test("admin builds a product with customer, material, drawing, routing and a revision", async ({
  page,
}) => {
  const run = Date.now().toString(36).toUpperCase();
  const code = `E${run.slice(-6)}`;
  const partNumber = `E2E-${run}`;
  const customer = `E2E Kupac ${run}`;

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");

  // Two operation types with abbreviations.
  await page.goto("/settings/operation-types");
  for (const [suffix, name] of [
    ["T", `E2E Tokarenje ${run}`],
    ["G", `E2E Glodanje ${run}`],
  ] as const) {
    await page.getByRole("button", { name: "Dodaj operaciju" }).click();
    const typeSheet = page.getByRole("dialog");
    await typeSheet.getByLabel("Naziv").fill(name);
    await typeSheet.getByLabel("Skraćenica").fill(`${code}${suffix}`.slice(-10).toLowerCase());
    await typeSheet.getByRole("button", { name: "Dodaj" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }

  // Customer.
  await page.goto("/customers");
  await page.getByRole("button", { name: "Dodaj kupca" }).click();
  const customerSheet = page.getByRole("dialog");
  await customerSheet.getByLabel("Naziv").fill(customer);
  await customerSheet.getByLabel("Grad").fill("Zenica");
  await customerSheet.getByRole("button", { name: "Dodaj kupca" }).click();
  await expect(page.getByRole("heading", { name: customer })).toBeVisible();

  // Product: customer and material picked by typing, weight computed, drawing attached.
  await page.goto("/products");
  await page.getByRole("button", { name: "Dodaj proizvod" }).click();
  const productSheet = page.getByRole("dialog");
  await productSheet.getByLabel("Šifra dijela").fill(partNumber);
  await productSheet.getByLabel("Naziv", { exact: true }).fill("E2E osovina");
  await pick(page, productSheet.getByLabel("Kupac"), customer, new RegExp(customer));
  await pick(page, productSheet.getByLabel("Materijal"), "inox 304", /1\.4301/);
  await productSheet.getByLabel("Oblik sirovog komada").selectOption("round");
  await expect(productSheet.getByLabel("Debljina")).toHaveCount(0);
  await productSheet.getByLabel("Prečnik").fill("40");
  await productSheet.getByLabel("Dužina komada").fill("125");
  // π/4 · 40² · 125 mm · 7,9 kg/dm³.
  await expect(productSheet.getByText("Težina sirovog komada: 1,241 kg")).toBeVisible();
  await productSheet.getByLabel("Fajlovi (PDF, slike)").setInputFiles({
    name: "glavni-crtez.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% e2e\n"),
  });
  await expect(productSheet.getByLabel("Vrsta priloga za glavni-crtez.pdf")).toHaveValue(
    "main_drawing",
  );
  await productSheet.getByRole("button", { name: "Dodaj proizvod" }).click();
  await expect(page.getByRole("heading", { name: partNumber })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Prilozi/ })).toContainText("1");
  await expect(page.getByText("1,241 kg")).toBeVisible();

  // Routing: two operations, reordered by drag & drop and with the arrows.
  await page.getByRole("tab", { name: /Operacije/ }).click();
  for (const [suffix, name, cycle] of [
    ["T", `E2E Tokarenje ${run}`, "1,5"],
    ["G", `E2E Glodanje ${run}`, "2,5"],
  ] as const) {
    const typeCode = `${code}${suffix}`.slice(-10).toUpperCase();
    await page.getByRole("button", { name: "Dodaj operaciju" }).first().click();
    const operationSheet = page.getByRole("dialog");
    await operationSheet
      .getByLabel("Vrsta operacije")
      .selectOption({ label: `${typeCode} – ${name}` });
    await operationSheet.getByLabel("Priprema (min)").fill("30");
    await operationSheet.getByLabel("Ciklus po komadu (min)").fill(cycle);
    await operationSheet.getByRole("button", { name: "Dodaj operaciju" }).click();
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText(`${cycle} min`);
  }
  const names = () =>
    page
      .getByRole("row")
      .filter({ hasText: "E2E " })
      .evaluateAll((rows) =>
        rows.map((row) => (row.textContent?.includes("Glodanje") ? "G" : "T")),
      );
  await expect.poll(names).toEqual(["T", "G"]);

  await page
    .getByRole("row")
    .filter({ hasText: `E2E Glodanje ${run}` })
    .dragTo(page.getByRole("row").filter({ hasText: `E2E Tokarenje ${run}` }), {
      targetPosition: { x: 20, y: 4 },
    });
  await expect.poll(names).toEqual(["G", "T"]);
  await page.getByRole("button", { name: `Pomjeri operaciju E2E Glodanje ${run} dolje` }).click();
  await expect.poll(names).toEqual(["T", "G"]);
  await page.getByLabel("Količina (kom)").fill("10");
  // 60 min setup + (1,5 + 2,5) min × 10.
  await expect(page.getByText("Za 10 kom: 1 h 40 min 0 s")).toBeVisible();

  // First revision had no label; the new one is suggested as A.
  await page.getByRole("button", { name: "Više akcija" }).click();
  await page.getByRole("menuitem", { name: "Nova revizija" }).click();
  const revisionSheet = page.getByRole("dialog");
  await expect(revisionSheet.getByLabel("Oznaka nove revizije")).toHaveValue("A");
  await revisionSheet.getByRole("button", { name: "Napravi reviziju" }).click();
  await expect(page.getByText("Rev. A", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: /Operacije/ })).toContainText("2");
  await expect(page.getByRole("tab", { name: /Prilozi/ })).toContainText("1");

  await page.getByRole("tab", { name: /Historija/ }).click();
  await expect(page.getByText("Napravljena nova revizija A")).toBeVisible();
  await expect(page.getByText("Promijenjen redoslijed operacija").first()).toBeVisible();
  await expect(page.getByText(`Proizvod ${partNumber} kreiran`)).toBeVisible();

  await page.getByRole("link", { name: "Rev. bez oznake" }).click();
  await expect(page.getByText("Pregled stare revizije bez oznake")).toBeVisible();
  await expect(page.getByRole("button", { name: "Uredi" })).toHaveCount(0);

  // Clean up: archive the product (searched, so leftovers of earlier runs never push it off page 1).
  await page.goto(`/products?q=${partNumber}`);
  await page.getByRole("button", { name: `Akcije za proizvod ${partNumber}` }).click();
  await page.getByRole("menuitem", { name: "Arhiviraj" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Arhiviraj" }).click();
  await expect(page.getByRole("link", { name: partNumber })).toHaveCount(0);
});
