import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database, Json } from "@/lib/supabase/types";
import { createAdminClient, readAdminEnv } from "../scripts/lib/admin-client";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "../scripts/lib/demo-users";
import { expectPath, login } from "./helpers";

// Production reporting on the demo data: the head of production releases a
// small order (cut through the API), the operator starts, reports in parts,
// pauses with a reason and finishes the turning operation on the phone; the
// head of production sees the reports on the order. The order is cancelled
// and archived at the end.

const demoUser = (role: (typeof DEMO_USERS)[number]["role"]) => ({
  ...DEMO_USERS.find((user) => user.role === role)!,
  password: demoPassword(),
});

async function plannerClient() {
  const env = readAdminEnv();
  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email: toAuthEmail(demoUser("head_of_production").username, DEMO_ORG.slug),
    password: demoPassword(),
  });
  if (error) throw error;
  return client;
}

test("@mobile operator starts, reports in parts, pauses and finishes an operation", async ({
  page,
}) => {
  // Two roles, many steps and first compiles of the floor routes.
  test.setTimeout(180_000);
  const admin = createAdminClient();
  const org = await admin.from("organizations").select("id").eq("slug", DEMO_ORG.slug).single();
  const product = await admin
    .from("products")
    .select("id, customer_id")
    .eq("organization_id", org.data!.id)
    .eq("part_number", "DM-4711-02")
    .is("archived_at", null)
    .single();

  const planner = await plannerClient();
  const created = await planner.rpc("create_production_order", {
    p_org_id: org.data!.id,
    p_order: {
      customer_id: product.data!.customer_id,
      product_id: product.data!.id,
      quantity: "5",
      due_date: "2030-06-30",
      notes: "E2E prijava",
    } as Json,
  });
  expect(created.error).toBeNull();
  const orderId = created.data!;
  expect(
    (
      await planner.rpc("set_production_order_status", {
        p_order_id: orderId,
        p_status: "planned",
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await planner.rpc("finish_cutting", {
        p_order_id: orderId,
        p_quantity: "5" as unknown as number,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).error,
  ).toBeNull();
  const order = await admin
    .from("production_orders")
    .select("order_number")
    .eq("id", orderId)
    .single();
  // Base tables: the directory views use functions granted to app users only.
  const operations = async () =>
    (
      await admin
        .from("production_order_operations")
        .select("id, sequence, status, operation_types!inner(code)")
        .eq("order_id", orderId)
        .is("archived_at", null)
        .order("sequence")
        .throwOnError()
    ).data.map((op) => ({ id: op.id, status: op.status, code: op.operation_types.code }));
  // Demo routing: RZ → KT (inspection between operations) → GL on CNC-01 → …
  const [, inspection, milling] = await operations();
  expect([inspection?.code, milling?.code]).toEqual(["KT", "GL"]);

  try {
    // The inspector checks the cut pieces first (inspection between operations).
    await login(page, demoUser("quality_inspector"), DEMO_ORG.slug);
    await expectPath(page, "/dashboard");
    await page.goto(`/floor/operations/${inspection!.id}`);
    const panel = page.getByTestId("work-panel");
    await panel.getByRole("button", { name: "Počni kontrolu" }).click();
    await expect(page.getByText(/Rad na nalogu .* je počeo\./)).toBeVisible();
    await panel.getByRole("button", { name: "Završi kontrolu" }).click();
    let sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Dobro")).toHaveValue("5");
    await sheet.getByRole("button", { name: "Završi", exact: true }).click();
    await expect(page.getByText("Operacija je završena.").first()).toBeVisible();

    // The checked pieces have reached Omer's CNC: on his home screen.
    // Another person on the same device: start signed out.
    await page.context().clearCookies();
    await login(page, demoUser("operator"), DEMO_ORG.slug);
    await expectPath(page, "/floor");
    await expect(
      page.getByRole("link", { name: new RegExp(order.data!.order_number) }),
    ).toBeVisible();
    await page.goto(`/floor/operations/${milling!.id}`);

    await panel.getByRole("button", { name: "Počni rad" }).click();
    await expect(page.getByText(/Rad na nalogu .* je počeo\./)).toBeVisible();
    await expect(panel.getByTestId("workers-now")).toContainText("Omer");

    // Part report: 2 good, 1 scrap with a reason.
    await panel.getByRole("button", { name: "Prijavi komade" }).click();
    sheet = page.getByRole("dialog");
    await sheet.getByLabel("Dobro").fill("2");
    await sheet.getByLabel("Škart").fill("1");
    await sheet.getByLabel("Razlog škarta").selectOption({ label: "Greška u mjeri" });
    await sheet.getByRole("button", { name: "Sačuvaj prijavu" }).click();
    await expect(page.getByText("Prijava je sačuvana.")).toBeVisible();

    // Too many pieces are refused before anything is sent.
    await panel.getByRole("button", { name: "Prijavi komade" }).click();
    sheet = page.getByRole("dialog");
    await sheet.getByLabel("Dobro").fill("3");
    await sheet.getByRole("button", { name: "Sačuvaj prijavu" }).click();
    await expect(sheet.getByText(/više nego što je stiglo/)).toBeVisible();
    await page.keyboard.press("Escape");

    // Pause with a reason, then continue.
    await panel.getByRole("button", { name: "Pauza" }).click();
    sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Potvrdi pauzu" }).click();
    await expect(sheet.getByText("Izaberite razlog.")).toBeVisible();
    await sheet.getByRole("radio", { name: "Izmjena alata / pločice" }).click();
    await sheet.getByRole("button", { name: "Potvrdi pauzu" }).click();
    await expect(panel.getByText("Pauza: Izmjena alata / pločice")).toBeVisible();
    await panel.getByRole("button", { name: "Nastavi rad" }).click();
    await expect(panel.getByText("Pauza: Izmjena alata / pločice")).toHaveCount(0);

    // A tool change and a downtime that already happened.
    await panel.getByRole("button", { name: "Promjena alata" }).click();
    sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Sačuvaj promjenu alata" }).click();
    await expect(sheet.getByText("Unesite alat.")).toBeVisible();
    await sheet.getByLabel("Alat", { exact: true }).fill("Glodalo Ø10");
    await sheet.getByRole("radio", { name: "Lom" }).click();
    await sheet.getByRole("button", { name: "Sačuvaj promjenu alata" }).click();
    await expect(page.getByText("Promjena alata je zabilježena.")).toBeVisible();
    await panel.getByRole("button", { name: "Zastoj", exact: true }).click();
    sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: "Kvar mašine" }).click();
    await sheet.getByLabel("Trajanje (min)").fill("15");
    await sheet.getByRole("button", { name: "Sačuvaj zastoj" }).click();
    await expect(page.getByText("Zastoj je zabilježen.")).toBeVisible();

    // Finish: the remaining 2 pieces are suggested as good.
    await panel.getByRole("button", { name: "Završi operaciju" }).click();
    sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Dobro")).toHaveValue("2");
    await sheet.getByRole("button", { name: "Završi", exact: true }).click();
    await expect(page.getByText("Operacija je završena.").first()).toBeVisible();

    const after = await operations();
    expect(after[2]?.status).toBe("done");
    // The pieces moved on: the next inspection is ready.
    expect(after[3]).toMatchObject({ code: "KT", status: "ready" });
    const reports = await admin
      .from("production_reports")
      .select("good_quantity, scrap_quantity")
      .eq("operation_id", milling!.id)
      .is("voided_at", null)
      .throwOnError();
    const sum = (key: "good_quantity" | "scrap_quantity") =>
      reports.data.reduce((total, row) => total + Number(row[key]), 0);
    expect([sum("good_quantity"), sum("scrap_quantity")]).toEqual([4, 1]);

    // The head of production sees the reports on the order.
    // Another person on the same device: start signed out.
    await page.context().clearCookies();
    await login(page, demoUser("head_of_production"), DEMO_ORG.slug);
    await expectPath(page, "/dashboard");
    await page.goto(`/orders/${orderId}?tab=production`);
    await expect(page.getByTestId("order-good-quantity")).toContainText("0 / 5");
    await expect(page.getByRole("cell", { name: "Greška u mjeri" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Izmjena alata / pločice" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Glodalo Ø10" })).toBeVisible();
    await expect(page.getByTestId("downtime-by-reason")).toContainText("Kvar mašine");
    await expect(page.getByTestId("production-summary")).toContainText("20 %");

    // The foreman's day overview lists the reports of this order.
    await page.goto(`/production?order=${order.data!.order_number}`);
    const main = page.getByRole("main");
    await expect(main.getByTestId("day-reports")).toContainText(order.data!.order_number);
    await expect(main.getByTestId("day-downtime-by-reason")).toContainText("Kvar mašine");
  } finally {
    const cleanup = await plannerClient();
    await cleanup.rpc("set_production_order_status", {
      p_order_id: orderId,
      p_status: "cancelled",
      p_reason: "E2E prijava",
    });
    await cleanup.rpc("set_production_order_status", {
      p_order_id: orderId,
      p_status: "archived",
    });
  }
});

test("head of production filters a customer's orders and sees their progress", async ({ page }) => {
  const admin = createAdminClient();
  const org = await admin.from("organizations").select("id").eq("slug", DEMO_ORG.slug).single();
  const customer = await admin
    .from("customers")
    .select("id")
    .eq("organization_id", org.data!.id)
    .eq("name", "Demo Kupac d.o.o.")
    .single();

  await login(page, demoUser("head_of_production"), DEMO_ORG.slug);
  await expectPath(page, "/dashboard");
  // Approvers have the notification bell for requests to close with a shortage.
  await expect(page.getByTestId("notification-bell")).toBeVisible();

  await page.goto(`/customers/${customer.data!.id}`);
  const search = page.getByRole("search");
  await search.getByLabel("Nalog ili šifra").fill("-002");
  await search.getByRole("button", { name: "Traži" }).click();
  await expect(page).toHaveURL(/q=-002/);
  const progress = page.locator("[data-testid^=customer-order-progress-]");
  await expect(progress).toHaveCount(1);
  await expect(progress.getByRole("progressbar")).toBeVisible();
  // Under the bar: the operation reached (KT, the 2nd of 8) and no percent.
  await expect(progress).toContainText("KT · Kontrola");
  await expect(progress).toContainText("02/08");
  await expect(progress).not.toContainText("%");

  await search.getByLabel("Hitnost").selectOption("5");
  await search.getByRole("button", { name: "Traži" }).click();
  await expect(page.getByText("Nema naloga za ove filtere.")).toBeVisible();
  await page.getByRole("link", { name: "Poništi" }).click();
  await expect(page).toHaveURL((url) => url.search === "");
});
