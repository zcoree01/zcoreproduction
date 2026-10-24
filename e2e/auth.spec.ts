import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { FLOOR_HOME, homePathFor } from "@/lib/auth/home";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "../scripts/lib/demo-users";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login, signOutFromApp } from "./helpers";

// Requires the seeded demo organization (npm run seed:demo) and the test
// tenants (created by npm run test:db).

const demoUser = (role: (typeof DEMO_USERS)[number]["role"]) => ({
  ...DEMO_USERS.find((user) => user.role === role)!,
  password: demoPassword(),
});

// The app shell shows the organization in the breadcrumb (its header lives
// inside <main>); the floor shell in the page banner.
function organizationLabel(page: Page, home: string) {
  return home === FLOOR_HOME
    ? page.getByRole("banner").getByText(DEMO_ORG.name)
    : page.getByRole("navigation", { name: "breadcrumb" }).getByText(DEMO_ORG.name);
}

test.describe("login of every seeded role", () => {
  for (const user of DEMO_USERS) {
    const home = homePathFor(user.role);
    const tag = user.role === "operator" ? " @mobile" : "";

    test(`${user.role} (${user.username}) lands on ${home}${tag}`, async ({ page }) => {
      await login(page, { ...user, password: demoPassword() }, DEMO_ORG.slug);
      await expectPath(page, home);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(user.fullName);
      await expect(organizationLabel(page, home)).toBeVisible();
    });
  }
});

test("wrong password shows an error and stays on /login", async ({ page }) => {
  await login(page, { username: "admin", password: "pogresna-lozinka" }, DEMO_ORG.slug);
  await expect(page.getByText("Pogrešno korisničko ime ili lozinka.")).toBeVisible();
  await expectPath(page, "/login");
  await expect(page.getByLabel("Korisničko ime")).toHaveValue("admin");
});

test("empty login fields show errors next to the fields", async ({ page }) => {
  await page.goto(`/login?org=${DEMO_ORG.slug}`);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page.getByText("Unesite korisničko ime.")).toBeVisible();
  await expect(page.getByText("Unesite lozinku.")).toBeVisible();
});

test("protected routes redirect to /login without a session", async ({ page }) => {
  await page.goto("/dashboard?org=demo");
  await expectPath(page, "/login");
  // ?org is remembered in a cookie, so the login screen still knows the tenant.
  await expect(page.getByText(DEMO_ORG.name)).toBeVisible();
});

test("operator cannot open the management app", async ({ page }) => {
  await login(page, demoUser("operator"), DEMO_ORG.slug);
  await expectPath(page, "/floor");

  await page.goto("/dashboard");
  await expectPath(page, "/floor");
  await page.goto("/admin/users");
  await expectPath(page, "/floor");
});

test("operator signs out from the bottom navigation after confirming @mobile", async ({ page }) => {
  await login(page, demoUser("operator"), DEMO_ORG.slug);
  await expectPath(page, "/floor");

  const nav = page.getByRole("navigation", { name: "Navigacija" });
  await expect(nav.getByRole("link", { name: "Početna" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("button", { name: "Odjava" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Odjaviti se?");
  await dialog.getByRole("button", { name: "Odustani" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expectPath(page, "/floor");

  await nav.getByRole("button", { name: "Odjava" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Odjava" }).click();
  await expectPath(page, "/login");
});

test.describe("tenant from subdomain", () => {
  test.use({ baseURL: "http://demo.localhost:3000" });

  test("demo.localhost resolves the tenant without ?org", async ({ page }) => {
    await login(page, demoUser("admin"), null);
    await expectPath(page, "/dashboard");
    await expect(organizationLabel(page, "/dashboard")).toBeVisible();
  });
});

test("sidebar shows only modules the role may use", async ({ page }) => {
  await login(page, demoUser("warehouse"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  const sidebar = page.locator("[data-slot=sidebar]");
  await expect(sidebar.getByRole("link", { name: "Početna" })).toBeVisible();
  // Warehouse has no users.read.
  await expect(sidebar.getByRole("link", { name: "Korisnici" })).toHaveCount(0);
  await page.goto("/admin/users");
  await expect(page.getByText("Nemate pristup")).toBeVisible();
});

test("director sees users but cannot add them", async ({ page }) => {
  await login(page, demoUser("director"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");

  await page.getByRole("link", { name: "Korisnici" }).click();
  await expectPath(page, "/admin/users");
  await expect(page.getByRole("cell", { name: "operater", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dodaj korisnika" })).toHaveCount(0);
});

test("users table searches and filters on the server", async ({ page }) => {
  await login(page, demoUser("admin"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/admin/users");
  // Demo data may contain extra users created by hand; assert relative to the seed.
  await expect(page.getByRole("cell", { name: "skladiste", exact: true })).toBeVisible();

  const search = page.getByRole("searchbox", { name: /Pretraži/ });
  await search.fill("oper");
  await expect(page).toHaveURL(/q=oper/);
  await expect(page.getByRole("cell", { name: "operater", exact: true })).toBeVisible();
  await expect(page.getByText("1–1 od 1")).toBeVisible();

  await search.fill("");
  await expect(page).not.toHaveURL(/q=/);
  await page.getByRole("combobox", { name: "Uloga" }).selectOption({ label: "Direktor" });
  await expect(page).toHaveURL(/role=director/);
  await expect(page.getByRole("cell", { name: "direktor", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "operater", exact: true })).toHaveCount(0);
  for (const cell of await page
    .getByRole("row")
    .filter({ hasNot: page.getByRole("columnheader") })
    .all()) {
    await expect(cell).toContainText("Direktor");
  }

  await page.getByRole("combobox", { name: "Status" }).selectOption({ label: "Neaktivan" });
  await expect(page.getByText("Nema rezultata")).toBeVisible();
});

test("theme can be switched to dark", async ({ page }) => {
  await login(page, demoUser("admin"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  await page.getByRole("button", { name: "Promijeni temu" }).click();
  await page.getByRole("menuitemradio", { name: "Tamna" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("admin adds a user who can then sign in", async ({ page }) => {
  // Runs in a test tenant so demo data stays clean. Each run adds one user there.
  const username = `e2e.${Date.now().toString(36)}`;
  // Random per run: e2e users stay in the test tenant, so their password must not be in the repo.
  const password = `Pocetna-${randomUUID()}`;

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/admin/users");

  // Client-side validation: errors next to the fields, nothing sent.
  await page.getByRole("button", { name: "Dodaj korisnika" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Kreiraj korisnika" }).click();
  // Bosnian field messages, never the validator's English defaults.
  await expect(sheet.getByText("Neispravno korisničko ime.")).toBeVisible();
  await expect(sheet.getByText("Unesite ime i prezime.")).toBeVisible();
  await expect(sheet.getByText("Odaberite ulogu.")).toBeVisible();

  await sheet.getByLabel("Korisničko ime").fill(username);
  await sheet.getByLabel("Ime i prezime").fill("E2E Radnik");
  await sheet.getByLabel("Uloga").selectOption({ label: "Operater" });
  await sheet.getByLabel("Početna lozinka").fill(password);
  await sheet.getByRole("button", { name: "Kreiraj korisnika" }).click();

  await expect(page.getByText(`Korisnik ${username} je dodan.`, { exact: false })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("searchbox", { name: /Pretraži/ }).fill(username);
  await expect(page.getByRole("cell", { name: username, exact: true })).toBeVisible();

  // Duplicate username: server error shown next to the field.
  await page.getByRole("button", { name: "Dodaj korisnika" }).click();
  const again = page.getByRole("dialog");
  await again.getByLabel("Korisničko ime").fill(username);
  await again.getByLabel("Ime i prezime").fill("Duplikat");
  await again.getByLabel("Uloga").selectOption({ label: "Operater" });
  await again.getByLabel("Početna lozinka").fill(password);
  await again.getByRole("button", { name: "Kreiraj korisnika" }).click();
  await expect(again.getByText("Korisničko ime je već zauzeto.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await signOutFromApp(page, "Test Tenant A Admin");

  await login(page, { username, password }, TEST_TENANTS.a.slug);
  await expectPath(page, "/floor");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Radnik");
});
