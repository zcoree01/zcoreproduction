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

test("admin adds a user who sets their own password at the first sign-in", async ({ page }) => {
  // Runs in a test tenant so demo data stays clean. Each run adds one user there.
  const username = `e2e.${Date.now().toString(36)}`;
  // Random per run: e2e users stay in the test tenant, so their password must not be in the repo.
  const ownPassword = `Moja-${randomUUID()}`;

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/admin/users");

  // Client-side validation: errors next to the fields, nothing sent.
  await page.getByRole("button", { name: "Dodaj korisnika" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Kreiraj korisnika" }).click();
  // Bosnian field messages, never the validator's English defaults.
  await expect(sheet.getByText("Unesite ime i prezime.")).toBeVisible();
  await expect(sheet.getByText("Odaberite ulogu.")).toBeVisible();

  // No password field: the server generates a temporary one.
  await expect(sheet.getByLabel("Početna lozinka")).toHaveCount(0);
  await sheet.getByLabel("Ime i prezime").fill("E2E Radnik");
  // Preview of the generated username (ime + first letter of the last name).
  await expect(sheet.getByLabel("Korisničko ime")).toHaveAttribute("placeholder", /e2e\.r/);
  await sheet.getByLabel("Korisničko ime").fill(username);
  await sheet.getByLabel("Uloga").selectOption({ label: "Operater" });
  await sheet.getByRole("button", { name: "Kreiraj korisnika" }).click();

  const credentials = page.getByRole("alertdialog", { name: "Pristupni podaci" });
  await expect(credentials.getByTestId("temp-username")).toHaveText(username);
  const tempPassword = (await credentials.getByTestId("temp-password").textContent()) ?? "";
  // A simple word and three digits.
  expect(tempPassword).toMatch(/^[a-z]+[2-9]{3}$/);
  await credentials.getByRole("button", { name: "Gotovo" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.getByRole("searchbox", { name: /Pretraži/ }).fill(username);
  await expect(page.getByRole("cell", { name: username, exact: true })).toBeVisible();
  await expect(page.getByText("Privremena lozinka")).toBeVisible();

  // Duplicate username: server error shown next to the field.
  await page.getByRole("button", { name: "Dodaj korisnika" }).click();
  const again = page.getByRole("dialog");
  await again.getByLabel("Ime i prezime").fill("Duplikat");
  await again.getByLabel("Korisničko ime").fill(username);
  await again.getByLabel("Uloga").selectOption({ label: "Operater" });
  await again.getByRole("button", { name: "Kreiraj korisnika" }).click();
  await expect(again.getByText("Korisničko ime je već zauzeto.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await signOutFromApp(page, "Test Tenant A Admin");

  // First sign-in: kept on /change-password until a new password is chosen.
  await login(page, { username, password: tempPassword }, TEST_TENANTS.a.slug);
  await expectPath(page, "/change-password");
  await page.goto("/floor");
  await expectPath(page, "/change-password");
  await expect(page.getByRole("heading", { name: "Postavite svoju lozinku" })).toBeVisible();

  await page.getByLabel("Nova lozinka").fill(username);
  await page.getByLabel("Ponovite novu lozinku").fill(username);
  await page.getByRole("button", { name: "Spremi i nastavi" }).click();
  await expect(page.getByText("Lozinka ne smije biti isto što i korisničko ime.")).toBeVisible();

  await page.getByLabel("Nova lozinka").fill(ownPassword);
  await page.getByLabel("Ponovite novu lozinku").fill(`${ownPassword}x`);
  await page.getByRole("button", { name: "Spremi i nastavi" }).click();
  await expect(page.getByText("Lozinke se ne podudaraju.")).toBeVisible();

  await page.getByLabel("Ponovite novu lozinku").fill(ownPassword);
  await page.getByRole("button", { name: "Spremi i nastavi" }).click();
  await expectPath(page, "/floor");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Radnik");

  // The temporary password no longer works; the own one does.
  await page.context().clearCookies();
  await login(page, { username, password: tempPassword }, TEST_TENANTS.a.slug);
  await expect(page.getByText("Pogrešno korisničko ime ili lozinka.")).toBeVisible();
  await login(page, { username, password: ownPassword }, TEST_TENANTS.a.slug);
  await expectPath(page, "/floor");
});

test("operator opens their profile from the floor header @mobile", async ({ page }) => {
  const operator = demoUser("operator");
  await login(page, operator, DEMO_ORG.slug);
  await expectPath(page, FLOOR_HOME);
  await page.getByRole("link", { name: "Moj profil" }).click();
  await expectPath(page, "/floor/profile");
  await expect(page.getByRole("heading", { name: "Moj profil", level: 1 })).toBeVisible();
  await expect(page.getByText(operator.username, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Trenutna lozinka")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Velika" })).toBeVisible();
});

test("admin resets a password; the user changes it again in the profile", async ({ page }) => {
  const username = `e2e.${Date.now().toString(36)}`;
  const ownPassword = `Moja-${randomUUID()}`;
  const nextPassword = `Druga-${randomUUID()}`;

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Dodaj korisnika" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Ime i prezime").fill("E2E Reset");
  await sheet.getByLabel("Korisničko ime").fill(username);
  await sheet.getByLabel("Uloga").selectOption({ label: "Skladištar" });
  await sheet.getByRole("button", { name: "Kreiraj korisnika" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Gotovo" }).click();

  // Reset from the users table: a new temporary password, shown once.
  await page.getByRole("searchbox", { name: /Pretraži/ }).fill(username);
  await page.getByRole("button", { name: `Akcije za ${username}` }).click();
  await page.getByRole("menuitem", { name: "Resetuj lozinku" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Resetuj lozinku" }).click();
  const credentials = page.getByRole("alertdialog", { name: "Pristupni podaci" });
  const resetPassword = (await credentials.getByTestId("temp-password").textContent()) ?? "";
  expect(resetPassword).toMatch(/^[a-z]+[2-9]{3}$/);
  await credentials.getByRole("button", { name: "Gotovo" }).click();
  await signOutFromApp(page, "Test Tenant A Admin");

  await login(page, { username, password: resetPassword }, TEST_TENANTS.a.slug);
  await expectPath(page, "/change-password");
  await page.getByLabel("Nova lozinka").fill(ownPassword);
  await page.getByLabel("Ponovite novu lozinku").fill(ownPassword);
  await page.getByRole("button", { name: "Spremi i nastavi" }).click();
  await expectPath(page, "/dashboard");

  // Profile: the current password is required.
  await page.getByRole("button", { name: /E2E Reset/ }).click();
  await page.getByRole("menuitem", { name: "Moj profil" }).click();
  await expectPath(page, "/profile");
  await expect(page.getByText(username, { exact: true })).toBeVisible();
  await page.getByLabel("Trenutna lozinka").fill("pogresna-lozinka");
  await page.getByLabel("Nova lozinka", { exact: true }).fill(nextPassword);
  await page.getByLabel("Ponovite novu lozinku").fill(nextPassword);
  await page.getByRole("button", { name: "Promijeni lozinku" }).click();
  await expect(page.getByText("Trenutna lozinka nije tačna.")).toBeVisible();

  await page.getByLabel("Trenutna lozinka").fill(ownPassword);
  await page.getByRole("button", { name: "Promijeni lozinku" }).click();
  await expect(page.getByText("Lozinka je promijenjena.")).toBeVisible();

  // Text size is saved on the profile.
  await page.getByRole("radio", { name: "Velika" }).click();
  await expect(page.locator("[data-text-size=large]")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("radio", { name: "Velika" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Normalna" }).click();
  await expect(page.locator("[data-text-size=large]")).toHaveCount(0);

  await signOutFromApp(page, "E2E Reset");
  await login(page, { username, password: nextPassword }, TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");
});
