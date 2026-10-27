import { expect, test } from "@playwright/test";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Company registration, company data and the shared company directory
// (D-026). Requires the test tenants (npm run test:db). Every run registers
// one organization "e2e-<run>" (archived at the end) and adds directory
// entries with fresh tax ids (never deleted).

const RUN = Date.now().toString().slice(-8);
const jib = (suffix: string) => `4${RUN}${suffix.padStart(4, "0")}`.slice(0, 13);
const testAdmin = () => ({ username: "admin", password: testTenantPassword() });

test("a company registers in six steps and its administrator signs in", async ({ page }) => {
  const slug = `e2e-${RUN}`;
  const password = `Registracija-${RUN}`;
  await page.goto("/registracija");
  await expect(page.getByRole("heading", { level: 1, name: "Registracija firme" })).toBeVisible();
  await expect(page.getByText("Korak 1 od 6")).toBeVisible();

  // Step 1: validation, then the basics.
  await page.getByRole("button", { name: "Dalje" }).click();
  await expect(page.getByText("Unesite naziv (do 200 znakova).")).toBeVisible();
  await page.getByLabel("Puni naziv firme").fill(`E2E Metal ${RUN} d.o.o.`);
  await page.getByLabel("ID broj (JIB)").fill("123");
  await page.getByRole("button", { name: "Dalje" }).click();
  await expect(page.getByText("ID broj u BiH ima 13 cifara.")).toBeVisible();
  await page.getByLabel("ID broj (JIB)").fill(jib("1"));
  await page.getByRole("button", { name: "Dalje" }).click();

  // Step 2: address.
  await expect(page.getByRole("heading", { level: 2, name: "Adresa i kontakt" })).toBeVisible();
  await page.getByLabel("Ulica i broj (sjedište)").fill("Industrijska zona 5");
  await page.getByLabel("Grad", { exact: false }).first().fill("Zenica");
  await page.getByRole("button", { name: "Dalje" }).click();

  // Step 3: a bank account; the IBAN is filled from the account number.
  await expect(page.getByRole("heading", { name: "Plaćanje" })).toBeVisible();
  await page.getByRole("button", { name: "Dodaj račun" }).click();
  await page.getByLabel("Banka").fill("E2E banka");
  await page.getByLabel("Broj žiro računa").fill("1290079401028494");
  await page.getByRole("button", { name: "Popuni IBAN" }).click();
  await expect(page.getByLabel("IBAN")).toHaveValue("BA391290079401028494");
  await page.getByRole("button", { name: "Dalje" }).click();

  // Step 4: subdomain suggested from the name, then checked.
  await expect(page.getByRole("heading", { name: "Adresa u sistemu" })).toBeVisible();
  await expect(page.getByLabel("Adresa firme")).toHaveValue(`e2e-metal-${RUN}`);
  await page.getByLabel("Adresa firme").fill("zcore");
  await page.getByRole("button", { name: "Dalje" }).click();
  await expect(page.getByText("Ova adresa je rezervisana.", { exact: false })).toBeVisible();
  await page.getByLabel("Adresa firme").fill(slug);
  await page.getByRole("button", { name: "Dalje" }).click();

  // Step 5: administrator; the username is suggested from the name.
  await expect(page.getByRole("heading", { name: "Administrator" })).toBeVisible();
  await page.getByLabel("Ime i prezime").fill("Edin Testić");
  await page.getByLabel("Ime i prezime").blur();
  await expect(page.getByLabel("Korisničko ime")).toHaveValue("edin.t");
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByLabel("Ponovite lozinku").fill(password);
  await page.getByRole("button", { name: "Dalje" }).click();

  // Step 6: review, going back keeps the values, terms required.
  await expect(page.getByRole("heading", { name: "Pregled i potvrda" })).toBeVisible();
  await expect(page.getByText(`${slug}.zcore.ba`)).toBeVisible();
  await page.getByRole("button", { name: "Izmijeni" }).first().click();
  await expect(page.getByLabel("Puni naziv firme")).toHaveValue(`E2E Metal ${RUN} d.o.o.`);
  for (const next of [
    "Adresa i kontakt",
    "Plaćanje",
    "Adresa u sistemu",
    "Administrator",
    "Pregled i potvrda",
  ]) {
    await page.getByRole("button", { name: "Dalje" }).click();
    await expect(page.getByRole("heading", { level: 2, name: next })).toBeVisible();
  }
  await page.getByRole("button", { name: "Registruj firmu" }).click();
  await expect(page.getByText("Potvrdite da ste ovlašteni i da su podaci tačni.")).toBeVisible();
  await page.getByRole("checkbox", { name: /Potvrđujem/ }).click();
  await page.getByRole("button", { name: "Registruj firmu" }).click();

  await expect(page.getByRole("heading", { name: "Firma je registrovana" })).toBeVisible();
  await expect(page.getByText("14 dana", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Idi na prijavu" }).click();
  await login(page, { username: "edin.t", password }, slug);
  await expectPath(page, "/dashboard");

  // The data are in the settings and every module runs as a trial.
  await page.goto("/settings/company");
  await expect(page.getByLabel("Puni naziv firme")).toHaveValue(`E2E Metal ${RUN} d.o.o.`);
  await expect(page.getByLabel("ID broj (JIB)")).toHaveAttribute("readonly", "");
  await expect(page.getByRole("link", { name: "Radni nalozi" })).toBeVisible();

  const service = createAdminClient();
  await service
    .from("organizations")
    .update({ archived_at: new Date().toISOString() })
    .eq("slug", slug);
});

test("a customer is offered from the directory and a change can be proposed", async ({ page }) => {
  const name = `E2E Imenik ${RUN}`;
  // Tenant B adds the company first (who has it as a customer is never shown).
  await login(page, testAdmin(), TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/customers");
  await page.getByRole("button", { name: "Dodaj kupca" }).click();
  await page.getByRole("dialog").getByLabel("Naziv").fill(name);
  await page.getByRole("dialog").getByLabel("ID / PDV broj").fill(jib("2"));
  await page.getByRole("dialog").getByLabel("Adresa").fill("Imenička 7");
  await page.getByRole("dialog").getByLabel("Grad").fill("Sarajevo");
  await page.getByRole("dialog").getByRole("button", { name: "Dodaj kupca" }).click();
  await expect(page.getByText("Firma je upisana i u zajednički imenik firmi.")).toBeVisible();
  await page.context().clearCookies();

  // Tenant A types the name: the suggestion fills the public data.
  await login(page, testAdmin(), TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/customers");
  await page.getByRole("button", { name: "Dodaj kupca" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Naziv").fill("E2");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await sheet.getByLabel("Naziv").fill(`imenik ${RUN}`);
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(sheet.getByText("Podaci iz zajedničkog imenika firmi")).toBeVisible();
  await expect(sheet.getByLabel("Naziv")).toHaveValue(name);
  await expect(sheet.getByLabel("Grad")).toHaveValue("Sarajevo");
  await sheet.getByLabel("Kontakt osoba").fill("Samo naše");
  await sheet.getByRole("button", { name: "Dodaj kupca" }).click();

  // Detail: directory card and a proposal.
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Podaci iz imenika firmi")).toBeVisible();
  await page.getByRole("button", { name: "Predloži izmjenu" }).click();
  await page.getByRole("dialog").getByLabel("Telefon").fill("033 777 888");
  await page.getByRole("dialog").getByLabel("Razlog", { exact: false }).fill("Novi broj");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Pošalji prijedlog/ })
    .click();
  await expect(page.getByText("Prijedlog izmjene je poslan.")).toBeVisible();
});

test("the administrator edits the company data in the settings", async ({ page }) => {
  await login(page, testAdmin(), TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/settings/company");
  await expect(page.getByRole("heading", { level: 1, name: "Podaci o firmi" })).toBeVisible();
  // Typing before the (dev) page is hydrated would be reset by React.
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Osnovne informacije", { exact: true })).toBeVisible();
  await expect(page.getByText("Plaćanje", { exact: true })).toBeVisible();
  await page.getByLabel("Web stranica").fill(`https://e2e-${RUN}.ba`);
  await page.getByRole("button", { name: "Sačuvaj promjene" }).click();
  await expect(page.getByText("Podaci o firmi su sačuvani.")).toBeVisible();
});
