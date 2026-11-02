import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database, Json } from "@/lib/supabase/types";
import { createAdminClient, readAdminEnv } from "../scripts/lib/admin-client";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "../scripts/lib/demo-users";
import { expectPath, login } from "./helpers";

// Production planning (D-041) on the demo data: the head of production puts
// the milling operation of an urgent order on CNC-01 with an operator, a
// second, less urgent order lands on the same day, the day is overloaded and
// the program moves the less urgent work to the next day on request; then
// that card is dragged one day further. Orders are cancelled and archived.

const headOfProduction = {
  ...DEMO_USERS.find((user) => user.role === "head_of_production")!,
  password: demoPassword(),
};
const DAY = "2030-06-04"; // Tuesday
const NEXT = "2030-06-05";
const AFTER = "2030-06-06";

async function plannerClient() {
  const env = readAdminEnv();
  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email: toAuthEmail(headOfProduction.username, DEMO_ORG.slug),
    password: demoPassword(),
  });
  if (error) throw error;
  return client;
}

test("head of production plans by days and moves work out of an overloaded day", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const admin = createAdminClient();
  const org = (await admin.from("organizations").select("id").eq("slug", DEMO_ORG.slug).single())
    .data!.id;
  const product = (
    await admin
      .from("products")
      .select("id, customer_id")
      .eq("organization_id", org)
      .eq("part_number", "DM-4711-02")
      .is("archived_at", null)
      .single()
  ).data!;
  const planner = await plannerClient();
  const close = async (id: string) => {
    await planner.rpc("set_production_order_status", {
      p_order_id: id,
      p_status: "cancelled",
      p_reason: "E2E planiranje",
    });
    await planner.rpc("set_production_order_status", { p_order_id: id, p_status: "archived" });
  };
  // Leftovers of an interrupted run.
  const leftovers = await admin
    .from("production_orders")
    .select("id")
    .eq("organization_id", org)
    .eq("notes", "E2E planiranje")
    .neq("status", "archived")
    .throwOnError();
  for (const order of leftovers.data) await close(order.id);

  const orderIds: string[] = [];
  const createOrder = async (quantity: string, priority: number) => {
    const created = await planner.rpc("create_production_order", {
      p_org_id: org,
      p_order: {
        customer_id: product.customer_id,
        product_id: product.id,
        quantity,
        due_date: "2030-06-28",
        priority,
        notes: "E2E planiranje",
      } as Json,
    });
    expect(created.error).toBeNull();
    orderIds.push(created.data!);
    const order = (
      await admin.from("production_orders").select("order_number").eq("id", created.data!).single()
    ).data!;
    const milling = (
      await admin
        .from("production_order_operations")
        .select("id, operation_types!inner(code)")
        .eq("order_id", created.data!)
        .eq("operation_types.code", "GL")
        .single()
        .throwOnError()
    ).data;
    return { id: created.data!, number: order.order_number, milling: milling.id };
  };

  try {
    // 20 min + 250 × 140 s ≈ 9,7 h: more than one day on CNC-01.
    const urgent = await createOrder("250", 1);
    const later = await createOrder("10", 5);

    await login(page, headOfProduction, DEMO_ORG.slug);
    await expectPath(page, "/dashboard");
    await page.goto("/planning?from=2030-06-03");
    await expect(page.getByRole("heading", { name: "Planiranje proizvodnje" })).toBeVisible();

    const unplanned = page.getByTestId("plan-unplanned");
    const urgentCard = unplanned.locator(`[data-operation-id="${urgent.milling}"]`);
    await expect(urgentCard).toContainText(urgent.number);
    await urgentCard.getByRole("button", { name: "Akcije za operaciju" }).click();
    await page.getByRole("menuitem", { name: "Premjesti…" }).click();
    const sheet = page.getByRole("dialog");
    const cnc = (
      await admin
        .from("machines")
        .select("id")
        .eq("organization_id", org)
        .eq("code", "CNC-01")
        .is("archived_at", null)
        .single()
    ).data!.id;
    await sheet.getByLabel("Mašina").selectOption(cnc);
    await sheet.getByLabel("Dan").fill(DAY);
    await sheet.getByRole("checkbox").first().click();
    await sheet.getByRole("button", { name: "Sačuvaj" }).click();
    await expect(page.getByText("Plan je sačuvan.")).toBeVisible();

    const cell = (day: string) =>
      page.locator(`[data-testid="plan-cell"][data-machine="CNC-01"][data-day="${day}"]`);
    await expect(cell(DAY).locator(`[data-operation-id="${urgent.milling}"]`)).toBeVisible();
    // The rest of the job goes on the next day.
    await expect(cell(NEXT)).toContainText(`${urgent.number} · GL`);

    // A less urgent order on the same day: it cannot start, the day is overloaded.
    const workers = (
      await admin
        .from("production_order_operation_workers")
        .select("employee_id")
        .eq("operation_id", urgent.milling)
        .throwOnError()
    ).data.map((w) => w.employee_id);
    expect(workers.length).toBe(1);
    const planned = await planner.rpc("plan_operations", {
      p_org_id: org,
      p_moves: [
        { operation_id: later.milling, plan_day: DAY, position: 2, employee_ids: workers },
      ] as Json,
    });
    expect(planned.error).toBeNull();
    await page.reload();
    await expect(cell(DAY)).toHaveAttribute("data-overloaded", "true");
    const alert = page.getByTestId("plan-overload");
    await expect(alert).toContainText(`${later.number} · GL → 5.6.`);
    await expect(
      cell(DAY).locator(`[data-operation-id="${later.milling}"]`).getByTestId("plan-card-warnings"),
    ).toContainText("Ne može početi ovog dana");

    await alert.getByRole("button", { name: "Prebaci posao u sljedeće dane" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Prebaci" }).click();
    await expect(page.getByText(/Prebačen.* operacij/)).toBeVisible();
    const moved = async () =>
      (
        await admin
          .from("production_order_operations")
          .select("plan_day")
          .eq("id", later.milling)
          .single()
          .throwOnError()
      ).data.plan_day;
    expect(await moved()).toBe(NEXT);
    await expect(cell(NEXT).locator(`[data-operation-id="${later.milling}"]`)).toBeVisible();

    // Dragging the card one day further (same machine and operator: no questions).
    await cell(NEXT).locator(`[data-operation-id="${later.milling}"]`).dragTo(cell(AFTER));
    await expect(
      page.getByText("Plan je sačuvan.").or(cell(AFTER).getByText(later.number)),
    ).toBeVisible();
    await expect.poll(moved, { timeout: 15_000 }).toBe(AFTER);
  } finally {
    for (const id of orderIds) await close(id);
  }
});
