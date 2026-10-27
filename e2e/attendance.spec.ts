import { expect, test, type Page } from "@playwright/test";
import { formatDay } from "@/lib/format";
import { zonedDate } from "@/lib/timezone";
import { addDays, mondayOf } from "@/modules/attendance/schedule-rules";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "../scripts/lib/demo-users";
import { expectPath, login } from "./helpers";

// Attendance on the demo data: the operator clocks in and out on the phone
// with one big button; the head of production sees them on the attendance
// board; the admin defines a shift whose unpaid break is added on top so it
// keeps 8 working hours (archived at the end).

const demoUser = (role: (typeof DEMO_USERS)[number]["role"]) => ({
  ...DEMO_USERS.find((user) => user.role === role)!,
  password: demoPassword(),
});

async function attendanceState(page: Page) {
  return page.getByTestId("attendance-state");
}

test("@mobile operator clocks in and out; the head of production sees the presence", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await login(page, demoUser("operator"), DEMO_ORG.slug);
  await expectPath(page, "/floor");

  await page.goto("/floor/attendance");
  await expect(page.getByRole("heading", { name: "Dolazak i odlazak" })).toBeVisible();
  // An earlier run (or starting work on an operation) may have clocked in.
  const clockOut = page.getByRole("button", { name: "Odjava s posla" });
  if (await clockOut.isVisible()) {
    await clockOut.click();
    await expect(await attendanceState(page)).toHaveText("Niste prijavili dolazak");
  }

  await page.getByRole("button", { name: "Prijava dolaska" }).click();
  await expect(await attendanceState(page)).toContainText("U firmi od");
  await expect(page.getByRole("button", { name: "Odjava s posla" })).toBeVisible();
  await expect(page.getByText("Vrijeme bilježi server, ne telefon.")).toBeVisible();

  // Home no longer asks to clock in.
  await page.goto("/floor");
  await expect(page.getByTestId("clock-in-notice")).toHaveCount(0);

  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await login(manager, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(manager, "/dashboard");
  await manager.goto("/attendance");
  await expect(manager.getByRole("heading", { name: "Prisustvo" })).toBeVisible();
  const row = manager.getByTestId("attendance-row").filter({ hasText: "Omer Operater" });
  await expect(row).toContainText("U firmi");
  await expect(row).toContainText("još u firmi");
  await managerContext.close();

  await page.goto("/floor/attendance");
  await page.getByRole("button", { name: "Odjava s posla" }).click();
  await expect(await attendanceState(page)).toHaveText("Niste prijavili dolazak");
  await page.goto("/floor");
  await expect(page.getByTestId("clock-in-notice")).toBeVisible();
});

test("admin defines a shift that keeps 8 working hours with an unpaid break", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, demoUser("admin"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/settings/shifts");
  await expect(page.getByRole("heading", { name: "Smjene i radno vrijeme" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "I smjena", exact: true })).toBeVisible();
  await expect(page.getByText("Pravila prisustva", { exact: true })).toBeVisible();

  const name = `E2E smjena ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Dodaj smjenu" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Naziv", { exact: true }).fill(name);
  await sheet.getByLabel("Oznaka").fill(`E${Date.now().toString(36).slice(-4)}`);
  await sheet.getByLabel("Početak", { exact: true }).fill("07:00");
  await sheet.getByLabel("Kraj", { exact: true }).fill("15:00");
  await sheet.getByRole("checkbox", { name: "Plaćena pauza" }).click();
  await expect(sheet.getByText("radno vrijeme 7:30 h")).toBeVisible();
  await sheet.getByRole("button", { name: "Produži do 15:30" }).click();
  await expect(sheet.getByLabel("Kraj", { exact: true })).toHaveValue("15:30");
  await expect(sheet.getByText("radno vrijeme 8:00 h")).toBeVisible();
  await sheet.getByRole("button", { name: "Dodaj smjenu" }).click();
  await expect(page.getByText(`Smjena ${name} je dodana.`)).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("07:00–15:30");
  await expect(row).toContainText("30 min neplaćena");
  await expect(row).toContainText("8:00");

  await row.getByRole("button", { name: `Arhiviraj ${name}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Arhiviraj" }).click();
  await expect(page.getByText(`Smjena ${name} je arhivirana.`)).toBeVisible();
});

test("head of production plans a day by hand, applies rotations and sees crews", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const today = zonedDate(new Date(), "Europe/Sarajevo");
  const saturday = addDays(mondayOf(today), 5);
  await login(page, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");

  await page.goto("/attendance/schedule");
  await expect(page.getByRole("heading", { name: "Raspored" })).toBeVisible();
  // Seeded rotation: the crews work the I or II shift on weekdays.
  const omer = page.getByTestId("schedule-row").filter({ hasText: "Omer Operater" });
  await expect(omer.getByText(/^(I|II)$/).first()).toBeVisible();

  const cell = (shift: string) =>
    page.getByRole("button", { name: `Kenan Kontrolor, ${formatDay(saturday)}: ${shift}` });
  await cell("Slobodan dan").click();
  await page.getByRole("menuitem", { name: /III smjena/ }).click();
  await expect(page.getByText("Raspored je sačuvan.").first()).toBeVisible();
  await expect(cell("III smjena")).toBeVisible();

  await page.getByRole("button", { name: "Primijeni rotacije" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Primijeni" }).click();
  await expect(page.getByText(/Rotacije su primijenjene/)).toBeVisible();
  // The manual day survives the rotation.
  await expect(cell("III smjena")).toBeVisible();
  await cell("III smjena").click();
  await page.getByRole("menuitem", { name: "Slobodan dan" }).click();
  await expect(cell("Slobodan dan")).toBeVisible();

  await page.getByRole("link", { name: "Ekipe i rotacije" }).first().click();
  await expect(page.getByRole("heading", { name: "Ekipe i rotacije" })).toBeVisible();
  await expect(page.getByText("Ekipa A").first()).toBeVisible();
  await expect(page.getByText("Sedmična izmjena I/II").first()).toBeVisible();
});
