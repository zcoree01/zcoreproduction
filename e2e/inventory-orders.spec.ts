import { expect, test } from "@playwright/test";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";
import { seedOrderMaterial } from "./inventory-setup";

// Inventory part B: material of a production order. Setup through the API as
// the admin of test tenant B (before the browser signs in, which ends that
// API session): a product paired with a stock item, two bars received, an
// order released (reservation). In the browser: requirement with kerf, issue
// of a bar cut in the warehouse with its offcut back into stock, confirmed
// consumption and the reservation on the stock item. Rows use an E2E prefix.

const PASSWORD = () => testTenantPassword();

test("warehouse issues a cut bar to an order and confirms the consumption", async ({ page }) => {
  const code = `E2EB-${Date.now().toString(36)}`;
  const { orderId, itemId } = await seedOrderMaterial(code);

  await login(page, { username: "admin", password: PASSWORD() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");
  await page.goto(`/orders/${orderId}?tab=material`);
  await page.waitForLoadState("networkidle");

  // 50 × (100 + 2) mm = 5,1 m; 29 pieces per 3000 mm bar → 2 bars.
  await expect(page.getByText("50 kom × (100 mm + 2 mm rez) = 5,1 m")).toBeVisible();
  await expect(page.getByText("29 kom iz šipke od 3000 mm → 2 šipki")).toBeVisible();
  await expect(page.getByText("Nema dovoljno materijala")).toHaveCount(0);

  await page.getByRole("button", { name: "Izdaj materijal" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("Sa stanja")).toContainText(`T-${code}`);
  await expect(sheet.getByLabel("Izrezano komada iz jedne")).toHaveValue("29");
  // 3000 − 29 × 102 = 42 mm back into stock (own material).
  await expect(sheet.getByLabel("Ostatak po komadu – dužina (mm)")).toHaveValue("42");
  await sheet.getByRole("button", { name: "Izdaj" }).click();
  await expect(page.getByText("Materijal je izdat.")).toBeVisible();

  await expect(page.getByRole("row").filter({ hasText: "Ostatak u magacin" })).toContainText(
    "1 × 42 mm",
  );
  await expect(page.getByRole("row").filter({ hasText: "29 kom izrezano" })).toContainText(
    "1 × 3000 mm",
  );

  await page.getByLabel("Stvarno potrošeno (m)").fill("2,9");
  await page.getByRole("button", { name: "Potvrdi potrošnju" }).click();
  await expect(page.getByText("Potrošnja je potvrđena.")).toBeVisible();
  await expect(page.getByText("Potvrđeno: 2,9 m")).toBeVisible();

  await page.goto(`/inventory/${itemId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("row").filter({ hasText: "1 × 42 mm" })).toBeVisible();
  await page.getByRole("tab", { name: /Rezervacije/ }).click();
  // 5,1 m reserved, 2,958 m issued.
  await expect(page.getByRole("row").filter({ hasText: `E2E Kupac ${code}` })).toContainText(
    "2,142 m",
  );
});
