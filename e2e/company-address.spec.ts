import { expect, test } from "@playwright/test";
import { DEMO_ORG } from "../scripts/lib/demo-users";

// app.zcore.ba (D-047) serves only the registration; prijava.zcore.ba is the
// sign-in page without a company, which asks for the company's address.

test("sign-in without a company asks for the company's address", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Prijava u vašu firmu" })).toBeVisible();
  const register = page.getByRole("link", { name: "Registrujte firmu" });
  await expect(register).toBeVisible();

  await page.getByLabel("Adresa firme").fill("ne-postoji-firma");
  await page.getByRole("button", { name: "Nastavi na prijavu" }).click();
  await expect(page.getByText("Firma s tom adresom ne postoji.")).toBeVisible();
  await expect(page.getByLabel("Adresa firme")).toHaveValue("ne-postoji-firma");

  await page.getByLabel("Adresa firme").fill(`${DEMO_ORG.slug}.zcore.ba`);
  await page.getByRole("button", { name: "Nastavi na prijavu" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/login" && url.searchParams.get("org") === DEMO_ORG.slug,
  );
  await expect(page.getByLabel("Korisničko ime")).toBeVisible();
  // A company's own sign-in page does not offer registering another company.
  await expect(register).toHaveCount(0);
});

test("app.zcore.ba sends sign-in to prijava.zcore.ba, everything else to the registration", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-host": "app.zcore.ba" },
  });
  const page = await context.newPage();
  const response = await page.request.get("/dashboard", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(/\/registracija$/);
  const root = await page.request.get("/", { maxRedirects: 0 });
  expect(root.headers().location).toMatch(/\/registracija$/);
  const login = await page.request.get("/login", { maxRedirects: 0 });
  expect(login.status()).toBe(307);
  expect(login.headers().location).toBe("https://prijava.zcore.ba/login");
  const registration = await page.request.get("/registracija", { maxRedirects: 0 });
  expect(registration.status()).toBe(200);
  await context.close();
});

test("prijava.zcore.ba serves only the sign-in without a company", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-host": "prijava.zcore.ba" },
  });
  const page = await context.newPage();
  const root = await page.request.get("/", { maxRedirects: 0 });
  expect(root.status()).toBe(307);
  expect(root.headers().location).toMatch(/\/login$/);
  const registration = await page.request.get("/registracija", { maxRedirects: 0 });
  expect(registration.headers().location).toBe("https://app.zcore.ba/registracija");
  const login = await page.request.get("/login", { maxRedirects: 0 });
  expect(login.status()).toBe(200);
  expect(await login.text()).toContain("Adresa firme");
  await context.close();
});
