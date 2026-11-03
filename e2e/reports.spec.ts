import { expect, test } from "@playwright/test";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "../scripts/lib/demo-users";
import { expectPath, login } from "./helpers";

// Reports (D-043) on the demo data: the head of production opens every tab,
// groups production by machine, filters a machine and downloads the Excel
// export. The operator has no reports.

const user = (role: (typeof DEMO_USERS)[number]["role"]) => ({
  ...DEMO_USERS.find((u) => u.role === role)!,
  password: demoPassword(),
});

test("head of production reads the reports and exports them", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, user("head_of_production"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  await page.getByRole("link", { name: "Izvještaji" }).click();
  await expectPath(page, "/reports");
  await expect(page.getByRole("heading", { name: "Izvještaji", level: 1 })).toBeVisible();
  await expect(page.getByTestId("report-totals")).toContainText("Dobro");

  const filters = page.getByTestId("report-filters");
  await filters.getByLabel("Od", { exact: true }).fill("2026-01-01");
  await filters.getByLabel("Grupiši po").selectOption("machine");
  await filters.getByRole("button", { name: "Prikaži" }).click();
  await expect(page).toHaveURL(/group=machine/);
  const table = page.getByTestId("report-production-table");
  await expect(table.getByRole("columnheader", { name: "Mašina" })).toBeVisible();
  await expect(table).toContainText("CNC-01");

  await page.getByRole("link", { name: "Mašine i zastoji" }).click();
  await expect(page).toHaveURL(/tab=machines/);
  await expect(page.getByTestId("report-machine-table")).toContainText("PILA-01");
  await filters.getByLabel("Mašina").selectOption({ label: "PILA-01 · Tračna pila" });
  await filters.getByRole("button", { name: "Prikaži" }).click();
  await expect(page.getByTestId("report-machine-table")).not.toContainText("CNC-01");

  await page.getByRole("link", { name: "Nalozi i rokovi" }).click();
  await expect(page.getByTestId("report-totals")).toContainText("Na vrijeme");
  await page.getByRole("link", { name: "Magacin i troškovi" }).click();
  await expect(page.getByText("Trošak završenih naloga")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Izvezi u Excel" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^izvjestaj-costs-2026-01-01-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test("@mobile operators have no reports", async ({ page }) => {
  await login(page, user("operator"), DEMO_ORG.slug);
  await expectPath(page, "/floor");
  const response = await page.request.get("/reports/export?tab=production");
  expect(response.status()).toBe(403);
});
