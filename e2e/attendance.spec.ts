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
  // Employee #1 (another employee may share the name).
  const row = manager.getByTestId("attendance-row").filter({ hasText: /Omer Operater\s*#1 ·/ });
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

  // The rules form enables saving once a value changes (and saves it).
  const save = page.getByRole("button", { name: "Spremi pravila", exact: true });
  const tolerance = page.getByLabel("Tolerancija kašnjenja (min)");
  const original = await tolerance.inputValue();
  await expect(save).toBeDisabled();
  await tolerance.fill(original === "11" ? "12" : "11");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("Pravila prisustva su spremljena.")).toBeVisible();
  await tolerance.fill(original);
  await save.click();
  await expect(save).toBeDisabled();

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
  // A week before any rotation starts, so the demo data (also changed by
  // hand) is not touched.
  const saturday = addDays(mondayOf("2025-01-08"), 5);
  await login(page, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");

  await page.goto("/attendance/schedule?view=week&date=2025-01-08");
  await expect(page.getByRole("heading", { name: "Raspored" })).toBeVisible();
  // The grid renders every active employee (the demo data may be changed by hand).
  await expect(page.getByTestId("schedule-row").first()).toBeVisible();

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

test("@mobile worker asks for leave and a correction; the head of production decides", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const today = zonedDate(new Date(), "Europe/Sarajevo");
  const yesterday = addDays(today, -1);
  // A different future day per run (rejected at the end; an interrupted run
  // leaves its request on another day).
  const leaveDay = addDays("2030-01-01", Math.floor(Date.now() / 60_000) % 3000);

  await login(page, demoUser("operator"), DEMO_ORG.slug);
  await expectPath(page, "/floor");
  await page.goto("/floor/attendance");
  await expect(page.getByTestId("leave-balance")).toBeVisible();

  await page.getByRole("button", { name: "Zatraži odsustvo" }).click();
  let sheet = page.getByRole("dialog");
  await sheet.getByLabel("Od", { exact: true }).fill(leaveDay);
  await sheet.getByLabel("Do", { exact: true }).fill(leaveDay);
  await sheet.getByLabel("Napomena (vidi šef)").fill("E2E godišnji");
  await sheet.getByRole("button", { name: "Pošalji" }).click();
  await expect(page.getByText("Zahtjev je poslan.")).toBeVisible();
  await expect(page.getByTestId("my-requests")).toContainText("Na čekanju");

  // Sick leave is reported with its first day only; while open it can only be closed.
  await page.getByRole("button", { name: "Prijavi bolovanje" }).click();
  sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("Do", { exact: true })).toBeHidden();
  await sheet.getByRole("button", { name: "Pošalji" }).click();
  await expect(page.getByText("Bolovanje je prijavljeno.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prijavi bolovanje" })).toHaveCount(0);
  await page.getByRole("button", { name: "Zatvori bolovanje" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pošalji" }).click();
  await expect(page.getByText("Bolovanje je zatvoreno.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prijavi bolovanje" })).toBeVisible();
  // Withdrawn, so a later run can report the same day again.
  const sickItem = page
    .getByTestId("my-requests")
    .getByRole("listitem")
    .filter({ hasText: "Bolovanje" })
    .filter({ hasText: "Na čekanju" })
    .first();
  await sickItem.getByRole("button", { name: "Povuci zahtjev" }).click();
  await expect(page.getByText("Povučeno.").first()).toBeVisible();

  await page.getByRole("button", { name: "Zaboravio sam prijavu – dodaj" }).click();
  sheet = page.getByRole("dialog");
  await sheet.getByLabel("Dolazak").fill(`${yesterday}T05:00`);
  await sheet.getByLabel("Odlazak").fill(`${yesterday}T05:30`);
  await sheet.getByLabel("Razlog ispravke").fill("E2E ispravka");
  await sheet.getByRole("button", { name: "Pošalji" }).click();
  await expect(page.getByText("Zahtjev za ispravku je poslan.")).toBeVisible();

  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await login(manager, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(manager, "/dashboard");
  await manager.goto("/attendance/requests");
  await expect(manager.getByRole("heading", { name: "Odsustva i zahtjevi" })).toBeVisible();
  // Reject every E2E request (also ones left by an interrupted earlier run).
  for (const testId of ["pending-absence", "pending-correction"]) {
    const items = manager
      .getByTestId(testId)
      .filter({ hasText: "Omer Operater" })
      .filter({ hasText: /E2E/ });
    await expect(items.first()).toBeVisible();
    for (let count = await items.count(); count > 0; count -= 1) {
      const item = items.first();
      // No reject without a reason.
      await expect(item.getByRole("button", { name: "Odbij" })).toBeDisabled();
      await item.getByLabel("Napomena (obavezna kod odbijanja)").fill("E2E odbijeno");
      await item.getByRole("button", { name: "Odbij" }).click();
      await expect(items).toHaveCount(count - 1);
    }
  }
  await expect(manager.getByTestId("leave-row").first()).toBeVisible();
  await managerContext.close();

  await page.reload();
  await expect(page.getByTestId("my-requests")).toContainText("Odbijeno");
  await expect(page.getByTestId("my-requests")).toContainText("Odgovor: E2E odbijeno");
});

test("monthly overview, exports, specification, holidays and pay settings by HR", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  // Head of production: hours, but no pay.
  await login(page, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/attendance/monthly?all=1");
  await expect(page.getByRole("heading", { name: "Mjesečni pregled" })).toBeVisible();
  await expect(page.getByTestId("monthly-table")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Neto zarada" })).toHaveCount(0);
  const csv = await page.request.get("/attendance/monthly/export?month=2026-10&format=csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Radnik");
  const xlsx = await page.request.get("/attendance/monthly/export?month=2026-10&format=xlsx");
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  await page.goto("/attendance/specification?month=2026-10");
  await expect(page.getByText("SPECIFIKACIJA UZ ISPLATU PLAĆE")).toBeVisible();
  await expect(page.getByText("1.10.2026. – 31.10.2026.")).toBeVisible();

  await page.goto("/settings/holidays?year=2026");
  await expect(page.getByRole("heading", { name: "Praznici" })).toBeVisible();
  const statehood = page
    .getByTestId("holiday-row")
    .filter({ has: page.locator('input[value="Dan državnosti"]') });
  await expect(statehood).toHaveCount(1);
  await expect(
    page.getByTestId("holiday-row").filter({ has: page.locator('input[value="Kurban-bajram"]') }),
  ).toContainText("provjeriti datum");

  // HR sets the default net hourly rate and sees net pay; the rate is restored at the end.
  const hrContext = await browser.newContext();
  const hr = await hrContext.newPage();
  await login(hr, demoUser("hr"), DEMO_ORG.slug);
  await expectPath(hr, "/dashboard");
  await hr.goto("/settings/shifts");
  await expect(hr.getByText("Uvećanja i satnica", { exact: true })).toBeVisible();
  await expect(hr.getByRole("button", { name: "Dodaj smjenu" })).toHaveCount(0);
  const rate = hr.getByLabel("Početna neto satnica (KM)");
  const original = await rate.inputValue();
  await rate.fill("8,5");
  await hr.getByRole("button", { name: "Spremi uvećanja" }).click();
  await expect(hr.getByText("Uvećanja i satnica su spremljeni.")).toBeVisible();
  await hr.goto("/attendance/monthly?all=1");
  await expect(hr.getByRole("columnheader", { name: "Neto zarada" })).toBeVisible();
  await hr.goto("/settings/shifts");
  await hr.getByLabel("Početna neto satnica (KM)").fill(original);
  await hr.getByRole("button", { name: "Spremi uvećanja" }).click();
  await expect(hr.getByText("Uvećanja i satnica su spremljeni.")).toBeVisible();
  await hrContext.close();
});
