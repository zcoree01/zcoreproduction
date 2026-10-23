import { expect, test } from "@playwright/test";
import { homePathFor } from "@/lib/auth/home";
import { DEMO_ORG, DEMO_USERS } from "../scripts/lib/demo-users";
import { TEST_TENANT_PASSWORD, TEST_TENANTS } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Requires the seeded demo organization (npm run seed:demo) and the test
// tenants (created by npm run test:db).

test.describe("login of every seeded role", () => {
  for (const user of DEMO_USERS) {
    const home = homePathFor(user.role);
    const tag = user.role === "operator" ? " @mobile" : "";

    test(`${user.role} (${user.username}) lands on ${home}${tag}`, async ({ page }) => {
      await login(page, user, DEMO_ORG.slug);
      await expectPath(page, home);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(user.fullName);
      await expect(page.getByRole("banner").getByText(DEMO_ORG.name)).toBeVisible();
    });
  }
});

test("wrong password shows an error and stays on /login", async ({ page }) => {
  await login(page, { username: "admin", password: "pogresna-lozinka" }, DEMO_ORG.slug);
  await expect(
    page.getByRole("alert").filter({ hasText: "Pogrešno korisničko ime ili lozinka." }),
  ).toBeVisible();
  await expectPath(page, "/login");
  await expect(page.getByLabel("Korisničko ime")).toHaveValue("admin");
});

test("protected routes redirect to /login without a session", async ({ page }) => {
  await page.goto("/dashboard?org=demo");
  await expectPath(page, "/login");
  // ?org is remembered in a cookie, so the login screen still knows the tenant.
  await expect(page.getByText(DEMO_ORG.name)).toBeVisible();
});

test("operator cannot open the management app", async ({ page }) => {
  const operator = DEMO_USERS.find((u) => u.role === "operator")!;
  await login(page, operator, DEMO_ORG.slug);
  await expectPath(page, "/floor");

  await page.goto("/dashboard");
  await expectPath(page, "/floor");
  await page.goto("/admin/users");
  await expectPath(page, "/floor");
});

test.describe("tenant from subdomain", () => {
  test.use({ baseURL: "http://demo.localhost:3000" });

  test("demo.localhost resolves the tenant without ?org", async ({ page }) => {
    const admin = DEMO_USERS.find((u) => u.role === "admin")!;
    await login(page, admin, null);
    await expectPath(page, "/dashboard");
    await expect(page.getByRole("banner").getByText(DEMO_ORG.name)).toBeVisible();
  });
});

test("director sees users but cannot add them", async ({ page }) => {
  const director = DEMO_USERS.find((u) => u.role === "director")!;
  await login(page, director, DEMO_ORG.slug);
  await expectPath(page, "/dashboard");

  await page.getByRole("link", { name: "Korisnici" }).click();
  await expectPath(page, "/admin/users");
  await expect(page.getByRole("cell", { name: "operater", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dodaj korisnika" })).toHaveCount(0);
});

test("admin adds a user who can then sign in", async ({ page }) => {
  // Runs in a test tenant so demo data stays clean. Each run adds one user there.
  const username = `e2e.${Date.now().toString(36)}`;
  const password = "Pocetna-Lozinka-1";

  await login(page, { username: "admin", password: TEST_TENANT_PASSWORD }, TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/admin/users");

  await page.getByLabel("Korisničko ime").fill(username);
  await page.getByLabel("Ime i prezime").fill("E2E Radnik");
  await page.getByLabel("Uloga").selectOption({ label: "Operater" });
  await page.getByLabel("Početna lozinka").fill(password);
  await page.getByRole("button", { name: "Dodaj korisnika" }).click();

  await expect(page.getByRole("status").filter({ hasText: username })).toBeVisible();
  await expect(page.getByRole("cell", { name: username, exact: true })).toBeVisible();

  // Duplicate username is rejected with a field-level message.
  await page.getByLabel("Korisničko ime").fill(username);
  await page.getByLabel("Ime i prezime").fill("Duplikat");
  await page.getByLabel("Uloga").selectOption({ label: "Operater" });
  await page.getByLabel("Početna lozinka").fill(password);
  await page.getByRole("button", { name: "Dodaj korisnika" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Korisničko ime je već zauzeto." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Odjava" }).click();
  await expectPath(page, "/login");

  await login(page, { username, password }, TEST_TENANTS.a.slug);
  await expectPath(page, "/floor");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Radnik");
});
