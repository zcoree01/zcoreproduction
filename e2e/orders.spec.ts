import { expect, test, type Page } from "@playwright/test";
import { createAdminClient } from "../scripts/lib/admin-client";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "../scripts/lib/demo-users";
import { expectPath, login } from "./helpers";

// Production orders on the seeded demo data (npm run seed:demo): list, detail,
// print with QR codes, a new order (cancelled and archived at the end), the
// warehouse's material statuses and the operator's floor queue.

const demoUser = (role: (typeof DEMO_USERS)[number]["role"]) => ({
  ...DEMO_USERS.find((user) => user.role === role)!,
  password: demoPassword(),
});

async function openOrders(page: Page) {
  await page.locator("[data-slot=sidebar]").getByRole("link", { name: "Radni nalozi" }).click();
  await expectPath(page, "/orders");
}

test("head of production creates, prints and cancels an order", async ({ page }) => {
  await login(page, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  await openOrders(page);

  // Most urgent first: the demo order with priority 1.
  const firstRow = page.getByRole("row").nth(1);
  await expect(firstRow).toContainText("ekstremno hitno");

  await page.getByRole("button", { name: "Novi nalog" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Proizvod").fill("4711");
  await page
    .getByRole("option", { name: /DM-4711-02/ })
    .first()
    .click();
  await expect(sheet.getByLabel("Kupac")).toHaveValue("Demo Kupac d.o.o.");
  await sheet.getByLabel("Naručena količina").fill("12,5");
  await sheet.getByLabel("Rok isporuke").fill("2030-06-30");
  await sheet.getByLabel("Napomena").fill("E2E nalog");
  await sheet.getByRole("button", { name: "Kreiraj nalog" }).click();
  await expect(sheet.getByText("Komadi se unose kao cijeli broj.")).toBeVisible();
  await sheet.getByLabel("Naručena količina").fill("10");
  await sheet.getByLabel("Dužina šipke").fill("3000");
  await sheet.getByLabel("Ostatak po šipci").fill("200");
  // Ø45 × 125 mm piece + 2 mm kerf → 22 pieces from 2800 mm.
  await expect(sheet.getByTestId("bar-plan")).toContainText("22 kom");
  await sheet.getByRole("button", { name: "Kreiraj nalog" }).click();

  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^RN\d+-\d{4}-\d{3,}$/);
  await expect(page.getByText("Nacrt").first()).toBeVisible();
  await expect(page.getByTestId("pieces-per-bar")).toContainText("22 kom");

  await page.getByRole("tab", { name: /Operacije/ }).click();
  await expect(page.getByTestId("order-operation-RZ")).toContainText("PILA-01");

  // Skipping steps is not offered; completion waits for production reporting.
  await page.getByRole("button", { name: "Promijeni status" }).click();
  await expect(page.getByRole("menuitem", { name: "U radu" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Planiran" }).click();
  await expect(page.getByText(/: Planiran\./)).toBeVisible();

  // Print: one QR code for the whole order.
  const orderUrl = new URL(page.url()).pathname;
  await page.goto(`${orderUrl}/print`);
  await expect(page.getByRole("heading", { name: "Radni nalog" })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR kod naloga/ })).toHaveCount(1);

  // Cancel (reason required), then archive.
  await page.goto(orderUrl);
  await page.getByRole("button", { name: "Promijeni status" }).click();
  await page.getByRole("menuitem", { name: "Otkazan" }).click();
  const cancel = page.getByRole("dialog");
  await cancel.getByRole("button", { name: "Otkaži nalog" }).click();
  await expect(cancel.getByText("Unesite razlog")).toBeVisible();
  await cancel.getByLabel("Razlog otkazivanja").fill("E2E test");
  await cancel.getByRole("button", { name: "Otkaži nalog" }).click();
  await expect(page.getByText(/: Otkazan\./)).toBeVisible();
  await page.getByRole("button", { name: "Promijeni status" }).click();
  await page.getByRole("menuitem", { name: "Arhiviran" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Arhiviran" }).click();
  await expect(page.getByText(/: Arhiviran\./)).toBeVisible();

  await page.getByRole("tab", { name: "Historija" }).click();
  await expect(page.getByText("E2E test")).toBeVisible();
});

test("warehouse moves an order through the material statuses only", async ({ page }) => {
  await login(page, demoUser("warehouse"), DEMO_ORG.slug);
  await openOrders(page);
  await page.getByRole("link", { name: /-001$/ }).first().click();
  await expect(page.getByText("Čeka materijal").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Još akcija" })).toHaveCount(0);

  await page.getByRole("button", { name: "Promijeni status" }).click();
  await expect(page.getByRole("menuitem", { name: "Otkazan" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Odsijecanje" }).click();
  await expect(page.getByText(/: Odsijecanje\./)).toBeVisible();

  // Back to the seeded state.
  await page.getByRole("button", { name: "Promijeni status" }).click();
  await page.getByRole("menuitem", { name: "Čeka materijal" }).click();
  await expect(page.getByText(/: Čeka materijal\./)).toBeVisible();
});

test("@mobile operator sees the queue of a machine and only their operations", async ({ page }) => {
  await login(page, demoUser("operator"), DEMO_ORG.slug);
  await expectPath(page, "/floor");
  await page.getByRole("link", { name: "Svi nalozi za moje mašine" }).click();
  await expectPath(page, "/floor/operations");

  // Omer is qualified for CNC-01 and CNC-02; the released demo order is there.
  await page.getByRole("link", { name: "CNC-02" }).click();
  const card = page.getByRole("link", { name: /-002/ }).first();
  await expect(card).toContainText("ekstremno hitno");
  await card.click();
  await expect(page.getByRole("heading", { name: /-002$/ })).toBeVisible();
  await expect(page.getByText("Treba uraditi")).toBeVisible();
  await expect(page.getByText("Tok naloga")).toBeVisible();

  // The saw operation of the same order belongs to someone else (QR scan).
  const admin = createAdminClient();
  const org = await admin.from("organizations").select("id").eq("slug", DEMO_ORG.slug).single();
  const urgent = await admin
    .from("production_orders")
    .select("id")
    .eq("organization_id", org.data!.id)
    .eq("priority", 1)
    .eq("status", "ready")
    .limit(1)
    .single();
  // Base table: the directory view uses functions granted to app users only.
  const saw = await admin
    .from("production_order_operations")
    .select("id, operation_types!inner(code)")
    .eq("order_id", urgent.data!.id)
    .eq("operation_types.code", "RZ")
    .single();
  expect(saw.error).toBeNull();
  // The order's QR code: Omer has two operations here; the cut pieces wait
  // for the inspection, so none has arrived yet.
  await page.goto(`/floor/orders/${urgent.data!.id}`);
  await expect(page.getByText("Izaberite svoju operaciju.")).toBeVisible();
  await page.goto(`/floor/operations/${saw.data!.id}`);
  await expect(page.getByText("Operacija vam nije dodijeljena")).toBeVisible();
  await expect(page.getByText("Sljedeća operacija naloga")).toBeVisible();
});
