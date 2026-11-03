import { expect, test } from "@playwright/test";
import { DEMO_ORG } from "../scripts/lib/demo-users";

// app.zcore.ba (D-047): only registration and "find your company"; a
// sign-in page without a company asks for the company's address.

test("sign-in without a company asks for the company's address", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Prijava u vašu firmu" })).toBeVisible();

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
});

test("app.zcore.ba sends everything except sign-in to the registration", async ({ browser }) => {
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
  expect(login.status()).toBe(200);
  await context.close();
});
