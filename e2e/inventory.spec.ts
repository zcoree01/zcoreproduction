import { expect, test } from "@playwright/test";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Inventory part A: stock item, receipt with VAT, balance and value, a
// correction that waits for approval. Writes go to test tenant B with an E2E
// prefix; the item is archived at the end (the ledger is never deleted).

test("admin creates an item, receives bars and approves a correction", async ({ page }) => {
  const code = `E2E-${Date.now().toString(36)}`;
  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");

  await expect(
    page.locator("[data-slot=sidebar]").getByRole("link", { name: "Materijal na stanju" }),
  ).toBeVisible();
  await page.goto("/inventory");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Novi artikal" }).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Kvalitet").fill("C45");
  await page.getByRole("option", { name: /^C45/ }).first().click();
  await sheet.getByLabel("Prečnik (mm)").fill("50");
  // Ø50 steel: π/4 · 50² · 7,85 / 1000 kg/m.
  await expect(sheet.getByText("Pretvaranje: 1 m = 15,4134 kg")).toBeVisible();
  await sheet.getByRole("button", { name: "Prijedlog: C45 Ø50" }).click();
  await sheet.getByLabel("Šifra").fill(code);
  await sheet.getByLabel("Standardna dužina komada (mm)").fill("3000");
  await sheet.getByLabel("Minimalna zaliha (m)").fill("20");
  await sheet.getByRole("button", { name: "Sačuvaj" }).click();

  await expect(page.getByRole("heading", { name: "C45 Ø50" })).toBeVisible();
  const itemUrl = page.url();
  await expect(page.getByText("Nema stanja")).toBeVisible();

  await page.goto("/inventory/receipts/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Dobavljač").fill("E2E Čelik d.o.o.");
  await page.getByLabel("Broj otpremnice").fill(code);
  await page.getByLabel("Artikal").fill(code);
  await page
    .getByRole("option", { name: new RegExp(code) })
    .first()
    .click();
  await page.getByLabel("Lokacija").selectOption({ label: "M1 — Magacin" });
  await page.getByLabel("Komada").fill("3");
  await expect(page.getByLabel("Dužina (mm)")).toHaveValue("3000");
  await page.getByLabel("Broj taline / šarža dobavljača").fill("T-4711");
  await page.getByLabel("Cijena (KM)").fill("2,5");
  // 3 × 3000 mm = 9 m, 138,7 kg; 2,5 KM/kg incl. 17 % VAT → 296,41 KM net.
  await expect(page.getByText("9 m · 138,7 kg · 296,41 KM bez PDV-a")).toBeVisible();
  await page.getByRole("button", { name: "Knjiži prijem" }).click();
  await expectPath(page, "/inventory/receipts");
  await expect(page.getByRole("row").filter({ hasText: code })).toContainText("296,41 KM");

  await page.goto(itemUrl);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Ispod minimuma").first()).toBeVisible();
  await expect(page.getByText("296,41 KM").first()).toBeVisible();
  const balanceRow = page.getByRole("row").filter({ hasText: "M1 — Magacin" });
  await expect(balanceRow).toContainText("3 × 3000 mm");
  await expect(balanceRow).toContainText("T-4711");

  await balanceRow.getByRole("button", { name: "Korekcija" }).click();
  const correction = page.getByRole("dialog");
  await correction.getByLabel("Broj komada").fill("1");
  await correction.getByLabel("Razlog").fill("E2E popis");
  await correction.getByRole("button", { name: "Pošalji na potvrdu" }).click();
  await expect(page.getByText("Korekcija je poslana na potvrdu.")).toBeVisible();
  // Stock changes only on approval.
  await expect(balanceRow).toContainText("3 × 3000 mm");

  await page.goto("/inventory/adjustments");
  // A click before the (dev) page is hydrated would not reach the action.
  await page.waitForLoadState("networkidle");
  const card = page.locator("[data-slot=card]").filter({ hasText: code }).first();
  await card.getByRole("button", { name: "Potvrdi i knjiži" }).click();
  await expect(page.getByText("Korekcija je knjižena.")).toBeVisible();

  await page.goto(itemUrl);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("row").filter({ hasText: "M1 — Magacin" })).toContainText(
    "2 × 3000 mm",
  );
  await page.getByRole("tab", { name: /Kretanja/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "Korekcija" })).toContainText("-3 m");

  await page.getByRole("button", { name: "Arhiviraj" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Arhiviraj" }).click();
  await expect(page.getByText(`Artikal C45 Ø50 je arhiviran.`)).toBeVisible();
});

test("operators cannot open the warehouse", async ({ page }) => {
  await login(page, { username: "operater", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/floor");
  // The management app sends operators back to the floor; RLS hides stock anyway.
  await page.goto("/inventory");
  await expectPath(page, "/floor");
});
