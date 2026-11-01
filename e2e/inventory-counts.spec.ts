import { expect, test } from "@playwright/test";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";
import { seedOrderMaterial } from "./inventory-setup";

// Inventory part C: warnings, labels, scanning and a stock count. Setup through
// the API (tenant B admin): an item with a minimum above its stock (2 bars of
// 3000 mm, minimum 20 m) and a released order needing more than there is
// (100 × 102 mm). In the browser: dashboard warnings and the order list
// badge, the label page, a typed label code in the mobile scanner, then a
// count of the item that finds one bar missing and is posted by the admin.

test("warnings, labels, scanning and a stock count of an item", async ({ page }) => {
  test.slow();
  const code = `E2EC-${Date.now().toString(36)}`;
  const { itemId, lotId } = await seedOrderMaterial(code, {
    bars: 2,
    quantity: 100,
    minStock: 20000,
  });

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");
  await expect(page.getByRole("link", { name: new RegExp(`^${code} ·`) })).toBeVisible();
  // 100 × 102 mm = 10,2 m needed, 6 m in stock.
  await expect(page.getByRole("link", { name: new RegExp(`${code}: fali 4,2 m`) })).toBeVisible();

  await page.goto(`/orders?q=${code}`);
  await expect(page.getByRole("row").filter({ hasText: "Fali materijal" })).toHaveCount(1);

  await page.goto(`/inventory/labels?item=${itemId}&size=50x30`);
  await expect(page.getByTestId("stock-label")).toHaveCount(1);
  await expect(page.getByTestId("stock-label")).toContainText("3000 mm");
  await expect(page.getByTestId("stock-label").locator("svg")).toBeVisible();

  await page.goto("/floor/warehouse/scan");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Kod s naljepnice").fill(`https://b.zcore.ba/floor/warehouse/lot/${lotId}`);
  await page.getByRole("button", { name: "Otvori" }).click();
  await expect(page).toHaveURL(new RegExp(`/floor/warehouse/lot/${lotId}$`));
  await expect(page.getByText("2 × 3000 mm")).toBeVisible();

  // Count of this item at M1: one bar missing.
  await page.goto("/inventory/counts");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Novi popis" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Lokacija").selectOption({ label: "M1 — Magacin" });
  await sheet.getByLabel("Samo artikal (opciono)").fill(code);
  await page
    .getByRole("option", { name: new RegExp(code) })
    .first()
    .click();
  await sheet.getByRole("button", { name: "Otvori popis" }).click();
  await expect(page.getByText("Popis je otvoren.")).toBeVisible();
  await expect(page.getByText("0 od 1 redova izbrojano")).toBeVisible();
  await page.waitForLoadState("networkidle");

  const counted = page.getByLabel(/^Izbrojano za/);
  await counted.fill("1");
  await counted.press("Tab");
  await expect(page.getByText("1 od 1 redova izbrojano · 1 razlika")).toBeVisible();
  await page.getByRole("button", { name: "Pošalji na potvrdu" }).click();
  await expect(page.getByText("Popis je poslan na potvrdu.")).toBeVisible();
  await page.getByRole("button", { name: "Potvrdi i knjiži razlike" }).click();
  await expect(page.getByText("Razlike su knjižene korekcijom.").first()).toBeVisible();

  await page.goto(`/inventory/${itemId}`);
  await expect(page.getByRole("row").filter({ hasText: "M1 — Magacin" })).toContainText(
    "1 × 3000 mm",
  );
});
