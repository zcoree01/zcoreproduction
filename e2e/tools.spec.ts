import { expect, test } from "@playwright/test";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Tool warehouse (D-035) in test tenant B: the admin adds an insert with
// cutting edges, receives 10 pieces into the warehouse and issues 4 to a
// machine (its location is created), then cannot issue more than is left.
// The machine is created with the service role; rows use an E2E prefix.

test("admin adds an insert, receives it and issues it to a machine", async ({ page }) => {
  test.slow();
  const run = Date.now().toString(36).toUpperCase();
  const code = `E2ET-${run}`;
  const admin = createAdminClient();
  const org = (
    await admin.from("organizations").select("id").eq("slug", TEST_TENANTS.b.slug).single()
  ).data!.id;
  const machineCode = `E2E-T${run.slice(-5)}`;
  await admin
    .from("machines")
    .insert({ organization_id: org, code: machineCode, name: `E2E strug ${run}` })
    .throwOnError();

  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
  await expectPath(page, "/dashboard");
  await page.goto("/inventory/tools");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Novi alat" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Šifra").fill(code);
  await form.getByLabel("Naziv").fill("Pločica VBMT 160404");
  await form.getByLabel("Vrsta").selectOption({ label: "Pločica" });
  await form.getByLabel("Broj reznih ivica").fill("3");
  await form.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByText("Alat je sačuvan.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toContainText("3 rezne ivice");
  await expect(row).toContainText("nema na stanju");

  await row.getByRole("button", { name: "Kretanje" }).click();
  const move = page.getByRole("dialog");
  await expect(move.getByLabel("Vrsta kretanja")).toHaveValue("receipt");
  await move.getByLabel("Broj komada").fill("10");
  await move.getByLabel("Na lokaciju").selectOption({ label: "M1 — Magacin" });
  await move.getByRole("button", { name: "Knjiži" }).click();
  await expect(page.getByText("Kretanje je knjiženo.")).toBeVisible();
  await expect(row).toContainText("M1 — Magacin: 10 kom");

  await row.getByRole("button", { name: "Kretanje" }).click();
  await move.getByLabel("Vrsta kretanja").selectOption({ label: "Izdaj na mašinu" });
  await move.getByLabel("Broj komada").fill("4");
  await move.getByLabel("Mašina").selectOption({ label: `${machineCode} · E2E strug ${run}` });
  await move.getByRole("button", { name: "Knjiži" }).click();
  await expect(page.getByText("Kretanje je knjiženo.")).toBeVisible();
  await expect(row).toContainText("M1 — Magacin: 6 kom");
  await expect(row).toContainText(`${machineCode} — E2E strug ${run}: 4 kom`);

  await row.getByRole("button", { name: "Kretanje" }).click();
  await move.getByLabel("Vrsta kretanja").selectOption({ label: "Izdaj na mašinu" });
  await move.getByLabel("Broj komada").fill("7");
  await move.getByLabel("Sa lokacije").selectOption({ label: "M1 — Magacin (6 kom)" });
  await move.getByLabel("Mašina").selectOption({ label: `${machineCode} · E2E strug ${run}` });
  await move.getByRole("button", { name: "Knjiži" }).click();
  await expect(move.getByText("Na toj lokaciji nema toliko komada.")).toBeVisible();
});
