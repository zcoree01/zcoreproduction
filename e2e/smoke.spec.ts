import { expect, test } from "@playwright/test";

test("login page renders in Bosnian for the tenant @mobile", async ({ page }) => {
  await page.goto("/login?org=demo");
  await expect(page.locator("html")).toHaveAttribute("lang", "bs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prijava");
  await expect(page.getByText("Demo Metal d.o.o.")).toBeVisible();
});

test("unknown tenant is reported instead of showing a login form", async ({ page }) => {
  await page.goto("/login?org=nepostojeca-firma");
  await expect(page.getByText("Firma nije pronađena")).toBeVisible();
  await expect(page.getByLabel("Lozinka")).toHaveCount(0);
});

test("without a tenant the user is told to open the company address", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Otvorite adresu svoje firme")).toBeVisible();
});
