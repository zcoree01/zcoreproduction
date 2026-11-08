import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nullableParam, numericParam } from "@/lib/supabase/numeric";
import type { Database, Json } from "@/lib/supabase/types";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setTenantLocked, setupFixture, signIn, type Fixture } from "./fixtures";

// A locked organization (D-049) keeps viewing, the kiosk and the work already
// in progress, and nothing else. Tenant B is locked around each scenario.
// Rows use the DBL prefix.

type Db = SupabaseClient<Database>;
const MARK = "DBL";
const PLATFORM_USER = "db.platform";

let fx: Fixture;
let platform: Db;
let platformUserId = "";
const ids = { saw: "", cnc: "", customer: "", product: "", turnType: "", employee: "" };

const LOCKED = { code: "42501", message: "organization_locked" };

async function cleanup() {
  const org = fx.b.org.id;
  const s = fx.service;
  await setTenantLocked(s, org, false);
  await s.from("billing_payments").delete().eq("organization_id", org);
  await s.from("organization_packages").delete().eq("organization_id", org);
  await s.from("organization_billing").delete().eq("organization_id", org);
  const orders = await s
    .from("production_orders")
    .select("id")
    .eq("organization_id", org)
    .like("notes", `${MARK}%`);
  const orderIds = (orders.data ?? []).map((row) => row.id);
  if (orderIds.length > 0) {
    await s.from("production_reports").delete().in("order_id", orderIds);
    await s.from("production_work_sessions").delete().in("order_id", orderIds);
    await s.from("production_order_status_history").delete().in("order_id", orderIds);
    await s.from("production_order_operations").delete().in("order_id", orderIds);
    await s.from("production_orders").delete().in("id", orderIds);
  }
  const employees = await s
    .from("employees")
    .select("id")
    .eq("organization_id", org)
    .like("first_name", `${MARK}%`);
  const employeeIds = (employees.data ?? []).map((row) => row.id);
  if (employeeIds.length > 0) {
    await s.from("employee_kiosk_credentials").delete().in("employee_id", employeeIds);
    await s.from("attendance_alerts").delete().in("employee_id", employeeIds);
    await s.from("attendance_sessions").delete().in("employee_id", employeeIds);
    await s.from("employee_machines").delete().in("employee_id", employeeIds);
    await s.from("employees").delete().in("id", employeeIds);
  }
  const products = await s
    .from("products")
    .select("id")
    .eq("organization_id", org)
    .like("part_number", `${MARK}%`);
  const productIds = (products.data ?? []).map((row) => row.id);
  if (productIds.length > 0) {
    const revisions = await s.from("product_revisions").select("id").in("product_id", productIds);
    const revisionIds = (revisions.data ?? []).map((row) => row.id);
    if (revisionIds.length > 0) {
      await s.from("product_operations").delete().in("revision_id", revisionIds);
      await s.from("product_revisions").delete().in("id", revisionIds);
    }
    await s.from("products").delete().in("id", productIds);
  }
  await s.from("attendance_kiosks").delete().eq("organization_id", org).like("name", `${MARK}%`);
  await s.from("machine_downtimes").delete().eq("organization_id", org);
  await s.from("machines").delete().eq("organization_id", org).like("code", `${MARK}%`);
  await s.from("operation_types").delete().eq("organization_id", org).like("code", `${MARK}%`);
  await s.from("customers").delete().eq("organization_id", org).like("name", `${MARK}%`);
  await s.from("catalog_items").delete().eq("organization_id", org).like("name", `${MARK}%`);
}

async function seed() {
  const org = fx.b.org.id;
  const s = fx.service;
  const types = await s
    .from("operation_types")
    .insert([
      { organization_id: org, code: `${MARK}RZ`, name: `${MARK} Rezanje`, is_cutting: true },
      { organization_id: org, code: `${MARK}TO`, name: `${MARK} Tokarenje`, is_cutting: false },
    ])
    .select("id, code")
    .throwOnError();
  const cutType = types.data.find((t) => t.code === `${MARK}RZ`)!.id;
  ids.turnType = types.data.find((t) => t.code === `${MARK}TO`)!.id;
  const machines = await s
    .from("machines")
    .insert([
      { organization_id: org, code: `${MARK}-SAW`, name: "Pila" },
      { organization_id: org, code: `${MARK}-CNC`, name: "CNC" },
    ])
    .select("id, code")
    .throwOnError();
  ids.saw = machines.data.find((m) => m.code === `${MARK}-SAW`)!.id;
  ids.cnc = machines.data.find((m) => m.code === `${MARK}-CNC`)!.id;
  const customer = await s
    .from("customers")
    .insert({ organization_id: org, name: `${MARK} Kupac` })
    .select("id")
    .single()
    .throwOnError();
  ids.customer = customer.data.id;
  const product = await fx.b.admin.rpc("create_product", {
    p_org_id: org,
    p_product: {
      part_number: `${MARK}-1`,
      name: "Osovina",
      customer_id: ids.customer,
      unit: "pcs",
    },
    p_revision: { revision: "A" },
  });
  expect(product.error).toBeNull();
  ids.product = product.data!;
  const revision = await s
    .from("product_revisions")
    .select("id")
    .eq("product_id", ids.product)
    .single()
    .throwOnError();
  for (const op of [
    { operation_type_id: cutType, machine_id: ids.saw, cycle_time_s: "10" },
    { operation_type_id: ids.turnType, machine_id: ids.cnc, cycle_time_s: "60" },
  ]) {
    const saved = await fx.b.admin.rpc("save_product_operation", {
      p_revision_id: revision.data.id,
      p_operation_id: nullableParam<string>(null),
      p_operation: op as Json,
    });
    expect(saved.error).toBeNull();
  }
  const employee = await s
    .from("employees")
    .insert({
      organization_id: org,
      employee_number: 900501,
      first_name: `${MARK} Radnik`,
      last_name: "Test",
      user_id: fx.b.operatorId,
    })
    .select("id")
    .single()
    .throwOnError();
  ids.employee = employee.data.id;
  await s
    .from("employee_machines")
    .insert({ organization_id: org, employee_id: ids.employee, machine_id: ids.cnc })
    .throwOnError();
}

/** A released order whose cutting is done: the turning operation is ready. */
async function readyOrder() {
  const created = await fx.b.admin.rpc("create_production_order", {
    p_org_id: fx.b.org.id,
    p_order: {
      customer_id: ids.customer,
      product_id: ids.product,
      quantity: "3",
      due_date: "2030-06-30",
      notes: `${MARK} order`,
    } as Json,
  });
  expect(created.error).toBeNull();
  const orderId = created.data!;
  expect(
    (
      await fx.b.admin.rpc("set_production_order_status", {
        p_order_id: orderId,
        p_status: "planned",
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await fx.b.admin.rpc("finish_cutting", {
        p_order_id: orderId,
        p_quantity: numericParam("3"),
        p_idempotency_key: crypto.randomUUID(),
      })
    ).error,
  ).toBeNull();
  const turning = await fx.service
    .from("production_order_operations")
    .select("id")
    .eq("order_id", orderId)
    .eq("operation_type_id", ids.turnType)
    .single()
    .throwOnError();
  return { orderId, turningId: turning.data.id };
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup();
  await seed();
  const zcore = await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" });
  platformUserId = await ensureUser(fx.service, zcore, {
    username: PLATFORM_USER,
    password: testTenantPassword(),
    fullName: "DB Platform",
    role: "admin",
  });
  await fx.service.from("memberships").update({ archived_at: null }).eq("user_id", platformUserId);
  platform = await signIn(PLATFORM_USER, "zcore");
});

afterAll(async () => {
  await cleanup();
  await fx.service
    .from("memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", platformUserId);
});

describe("a locked organization", () => {
  beforeAll(() => setTenantLocked(fx.service, fx.b.org.id, true));
  afterAll(() => setTenantLocked(fx.service, fx.b.org.id, false));

  it("refuses a new customer, catalog item and order", async () => {
    const customer = await fx.b.admin
      .from("customers")
      .insert({ organization_id: fx.b.org.id, name: `${MARK} Novi kupac` });
    expect(customer.error).toMatchObject(LOCKED);
    const reason = await fx.b.admin
      .from("catalog_items")
      .insert({ organization_id: fx.b.org.id, kind: "downtime_reason", name: `${MARK} razlog` });
    expect(reason.error).toMatchObject(LOCKED);
    const order = await fx.b.admin.rpc("create_production_order", {
      p_org_id: fx.b.org.id,
      p_order: {
        customer_id: ids.customer,
        product_id: ids.product,
        quantity: "1",
        due_date: "2030-06-30",
        notes: `${MARK} order`,
      } as Json,
    });
    expect(order.error).toMatchObject(LOCKED);
  });

  it("refuses editing a machine but allows its status change", async () => {
    const edit = await fx.b.admin
      .from("machines")
      .update({ name: "Preimenovana" })
      .eq("id", ids.saw)
      .select("id");
    expect(edit.error).toMatchObject(LOCKED);
    const status = await fx.b.admin.rpc("set_machine_status", {
      p_machine_id: ids.saw,
      p_status: "maintenance",
    });
    expect(status.error).toBeNull();
    await fx.b.admin.rpc("set_machine_status", { p_machine_id: ids.saw, p_status: "idle" });
  });

  it("refuses changing a member's role", async () => {
    // Writes the role the operator already has: refused while locked, harmless otherwise.
    const roles = await fx.service
      .from("roles")
      .select("id")
      .eq("organization_id", fx.b.org.id)
      .eq("key", "operator")
      .single()
      .throwOnError();
    const changed = await fx.b.admin
      .from("memberships")
      .update({ role_id: roles.data.id })
      .eq("organization_id", fx.b.org.id)
      .eq("user_id", fx.b.operatorId)
      .select("user_id");
    expect(changed.error).toMatchObject(LOCKED);
  });

  it("does not block the service role", async () => {
    const inserted = await fx.service
      .from("customers")
      .insert({ organization_id: fx.b.org.id, name: `${MARK} Servis` });
    expect(inserted.error).toBeNull();
  });

  it("tells every member that it is locked", async () => {
    for (const client of [fx.b.admin, fx.b.operator]) {
      const { data, error } = await client.rpc("my_billing_notice", { p_org_id: fx.b.org.id });
      expect(error).toBeNull();
      expect(data).toMatchObject({ state: "locked", reason: "manual" });
    }
  });
});

describe("work in progress while locked", () => {
  let order = { orderId: "", turningId: "" };

  beforeAll(async () => {
    order = await readyOrder();
    await setTenantLocked(fx.service, fx.b.org.id, true);
  });
  afterAll(() => setTenantLocked(fx.service, fx.b.org.id, false));

  it("lets the operator start, report and finish an existing operation", async () => {
    const started = await fx.b.operator.rpc("start_operation_work", {
      p_operation_id: order.turningId,
    });
    expect(started.error).toBeNull();
    const reported = await fx.b.operator.rpc("report_operation_quantity", {
      p_operation_id: order.turningId,
      p_good: numericParam("3"),
      p_scrap: numericParam("0"),
      p_scrap_reason_id: nullableParam<string>(null),
      p_notes: nullableParam<string>(null),
      p_idempotency_key: crypto.randomUUID(),
      p_finish: true,
    });
    expect(reported.error).toBeNull();
    const op = await fx.service
      .from("production_order_operations")
      .select("status")
      .eq("id", order.turningId)
      .single()
      .throwOnError();
    expect(op.data.status).toBe("done");
  });

  it("clocks in and out in the app", async () => {
    // Starting work clocked the worker in automatically (with an alert).
    await fx.service.from("attendance_alerts").delete().eq("employee_id", ids.employee);
    await fx.service
      .from("attendance_sessions")
      .delete()
      .eq("employee_id", ids.employee)
      .throwOnError();
    const clockIn = await fx.b.operator.rpc("clock_in", {
      p_org_id: fx.b.org.id,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(clockIn.error).toBeNull();
    const clockOut = await fx.b.operator.rpc("clock_out", {
      p_org_id: fx.b.org.id,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(clockOut.error).toBeNull();
  });
});

describe("billing lock", () => {
  afterAll(async () => {
    await fx.service.from("billing_payments").delete().eq("organization_id", fx.b.org.id);
    await fx.service.from("organization_packages").delete().eq("organization_id", fx.b.org.id);
    await fx.service.from("organization_billing").delete().eq("organization_id", fx.b.org.id);
  });

  it("unlocks the next write as soon as the overdue month is paid", async () => {
    const created = await platform.rpc("platform_save_package", {
      p_id: nullableParam<string>(null),
      p_name: `${MARK} paket ${crypto.randomUUID().slice(0, 6)}`,
      p_monthly_price: 100,
      p_modules: ["production"],
    });
    expect(created.error).toBeNull();
    await fx.service.from("billing_package_prices").delete().eq("package_id", created.data!);
    await fx.service
      .from("billing_package_prices")
      .insert({ package_id: created.data!, valid_from: "2026-01-01", monthly_price: 100 })
      .throwOnError();
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 10);
    await fx.service
      .from("organization_packages")
      .insert({ organization_id: fx.b.org.id, valid_from: lastMonth, package_id: created.data! })
      .throwOnError();
    await fx.service
      .from("organization_billing")
      .upsert({ organization_id: fx.b.org.id, grace_days: 0 }, { onConflict: "organization_id" })
      .throwOnError();

    const before = await fx.b.admin
      .from("customers")
      .insert({ organization_id: fx.b.org.id, name: `${MARK} Prije uplate` });
    expect(before.error).toMatchObject(LOCKED);

    const paid = await platform.rpc("platform_set_payment", {
      p_org_id: fx.b.org.id,
      p_period: lastMonth,
      p_paid: true,
      p_paid_on: now.toISOString().slice(0, 10),
      p_note: `${MARK} uplata`,
    });
    expect(paid.error).toBeNull();
    const after = await fx.b.admin
      .from("customers")
      .insert({ organization_id: fx.b.org.id, name: `${MARK} Nakon uplate` });
    expect(after.error).toBeNull();

    // Billing tables were written by the platform admin while the firm was locked.
    await fx.service.from("organization_packages").delete().eq("organization_id", fx.b.org.id);
    await fx.service.from("billing_package_modules").delete().eq("package_id", created.data!);
    await fx.service.from("billing_package_prices").delete().eq("package_id", created.data!);
    await fx.service.from("billing_packages").delete().eq("id", created.data!);
  });

  it("warns only members who manage the organization's settings", async () => {
    // The previous test paid last month.
    await fx.service.from("billing_payments").delete().eq("organization_id", fx.b.org.id);
    await fx.service
      .from("organization_billing")
      .upsert({ organization_id: fx.b.org.id, grace_days: 90 }, { onConflict: "organization_id" })
      .throwOnError();
    const created = await platform.rpc("platform_save_package", {
      p_id: nullableParam<string>(null),
      p_name: `${MARK} paket ${crypto.randomUUID().slice(0, 6)}`,
      p_monthly_price: 100,
      p_modules: ["production"],
    });
    expect(created.error).toBeNull();
    await fx.service
      .from("billing_package_prices")
      .upsert({ package_id: created.data!, valid_from: "2026-01-01", monthly_price: 100 })
      .throwOnError();
    // Due exactly tomorrow: inside the warning window of 5 days.
    const tomorrow = new Date(Date.now() + 86_400_000);
    const month = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() - 1, 1));
    const lastDay = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), 0));
    const grace = Math.round((tomorrow.getTime() - lastDay.getTime()) / 86_400_000);
    await fx.service
      .from("organization_billing")
      .update({ grace_days: grace })
      .eq("organization_id", fx.b.org.id)
      .throwOnError();
    await fx.service
      .from("organization_packages")
      .upsert({
        organization_id: fx.b.org.id,
        valid_from: month.toISOString().slice(0, 10),
        package_id: created.data!,
      })
      .throwOnError();

    const admin = await fx.b.admin.rpc("my_billing_notice", { p_org_id: fx.b.org.id });
    expect(admin.data).toMatchObject({ state: "warning" });
    const operator = await fx.b.operator.rpc("my_billing_notice", { p_org_id: fx.b.org.id });
    expect(operator.data).toMatchObject({ state: "active" });

    await fx.service.from("organization_packages").delete().eq("organization_id", fx.b.org.id);
    await fx.service.from("billing_package_modules").delete().eq("package_id", created.data!);
    await fx.service.from("billing_package_prices").delete().eq("package_id", created.data!);
    await fx.service.from("billing_packages").delete().eq("id", created.data!);
  });
});

describe("editing while locked (final review)", () => {
  let order = { orderId: "", turningId: "" };

  beforeAll(async () => {
    order = await readyOrder();
    await setTenantLocked(fx.service, fx.b.org.id, true);
  });
  afterAll(() => setTenantLocked(fx.service, fx.b.org.id, false));

  it("refuses editing an order's fields but still changes its status", async () => {
    const edited = await fx.b.admin
      .from("production_orders")
      .update({ quantity: 99 })
      .eq("id", order.orderId)
      .select("id");
    expect(edited.error).toMatchObject(LOCKED);
    const status = await fx.b.admin.rpc("set_production_order_status", {
      p_order_id: order.orderId,
      p_status: "waiting_material",
    });
    expect(status.error).toBeNull();
  });

  it("refuses re-planning an operation onto another machine", async () => {
    const moved = await fx.b.admin
      .from("production_order_operations")
      .update({ machine_id: ids.saw })
      .eq("id", order.turningId)
      .select("id");
    expect(moved.error).toMatchObject(LOCKED);
  });

  it("refuses new kiosk activations and PINs set by the admin, not the worker's own PIN", async () => {
    const kiosk = await fx.b.admin.rpc("create_kiosk_activation", {
      p_org_id: fx.b.org.id,
      p_kiosk_id: nullableParam<string>(null),
      p_name: `${MARK} kiosk`,
    });
    expect(kiosk.error).toMatchObject(LOCKED);
    const adminPin = await fx.b.admin.rpc("set_employee_pin", {
      p_employee_id: ids.employee,
      p_pin: "4321",
    });
    expect(adminPin.error).toMatchObject(LOCKED);
    const ownPin = await fx.b.operator.rpc("set_own_pin", { p_org_id: fx.b.org.id, p_pin: "1234" });
    expect(ownPin.error).toBeNull();
  });
});

describe("planning module", () => {
  afterAll(async () => {
    await fx.service
      .from("org_modules")
      .update({ enabled: true })
      .eq("organization_id", fx.b.org.id)
      .eq("module_key", "planning");
    await fx.service.from("machine_downtimes").delete().eq("organization_id", fx.b.org.id);
  });

  it("refuses machine downtime planning without the planning module", async () => {
    const reason = await fx.service
      .from("catalog_items")
      .select("id")
      .eq("organization_id", fx.b.org.id)
      .eq("kind", "downtime_reason")
      .is("archived_at", null)
      .limit(1)
      .single()
      .throwOnError();
    await fx.service
      .from("org_modules")
      .update({ enabled: false })
      .eq("organization_id", fx.b.org.id)
      .eq("module_key", "planning");
    const saved = await fx.b.admin.rpc("save_machine_downtime", {
      p_org_id: fx.b.org.id,
      p_id: nullableParam<string>(null),
      p_machine_id: ids.cnc,
      p_starts_on: "2030-01-10",
      p_ends_on: "2030-01-11",
      p_reason_id: reason.data.id,
      p_note: `${MARK} servis`,
    });
    expect(saved.error?.code).toBe("42501");
  });
});
