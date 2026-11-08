import { expect, test } from "@playwright/test";

test("login page renders in Bosnian for the tenant @mobile", async ({ page }) => {
  await page.goto("/login?org=demo");
  await expect(page.locator("html")).toHaveAttribute("lang", "bs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prijava");
  await expect(page.getByText("Demo Metal d.o.o.")).toBeVisible();
  // Zcore logo as the tab icon; the hint about forgotten passwords is for companies.
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", /icon\.svg/);
  await expect(page.getByText("Zaboravili ste lozinku?", { exact: false })).toBeVisible();
});

test("the Zcore sign-in page has no forgotten-password hint", async ({ page }) => {
  await page.goto("/login?org=zcore");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prijava");
  await expect(page.getByText("Zaboravili ste lozinku?", { exact: false })).toHaveCount(0);
});

test("unknown tenant is reported instead of showing a login form", async ({ page }) => {
  await page.goto("/login?org=nepostojeca-firma");
  await expect(page.getByText("Firma nije pronađena")).toBeVisible();
  await expect(page.getByLabel("Lozinka")).toHaveCount(0);
});

test("without a tenant the user is asked for the company address", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Prijava u vašu firmu" })).toBeVisible();
});
