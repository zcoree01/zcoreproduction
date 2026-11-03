import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/types";
import { setupFixture, type Fixture } from "./fixtures";

// Reports (D-043): facts split by local day (Europe/Sarajevo), machine
// running time from the status history, worker time, downtime across
// midnight, the machine cost of an order from the hourly rate, reports.read
// and tenant isolation. Rows use the DBQ prefix; dates in March 2031.

const MARK = "DBQ";
type Client = SupabaseClient<Database>;

let fx: Fixture;
const ids = {
  type: "",
  machine: "",
  customer: "",
  product: "",
  employee: "",
  order: "",
  op: "",
  shift: "",
};

async function cleanup(service: Client, orgIds: string[]) {
  const orders = await service
    .from("production_orders")
    .select("id")
    .in("organization_id", orgIds)
    .like("notes", `${MARK}%`);
  const orderIds = (orders.data ?? []).map((row) => row.id);
  if (orderIds.length > 0) {
    await service.from("production_reports").delete().in("order_id", orderIds);
    await service.from("production_work_sessions").delete().in("order_id", orderIds);
    await service.from("production_downtime_events").delete().in("order_id", orderIds);
    await service.from("production_order_status_history").delete().in("order_id", orderIds);
    await service.from("production_order_attachments").delete().in("order_id", orderIds);
    await service.from("production_order_operations").delete().in("order_id", orderIds);
    await service.from("production_orders").delete().in("id", orderIds);
  }
  const products = await service
    .from("products")
    .select("id")
    .in("organization_id", orgIds)
    .like("part_number", `${MARK}-%`);
  const productIds = (products.data ?? []).map((row) => row.id);
  if (productIds.length > 0) {
    const revisions = await service
      .from("product_revisions")
      .select("id")
      .in("product_id", productIds);
    const revisionIds = (revisions.data ?? []).map((row) => row.id);
    if (revisionIds.length > 0) {
      await service.from("product_operations").delete().in("revision_id", revisionIds);
      await service.from("product_revisions").delete().in("id", revisionIds);
    }
    await service.from("products").delete().in("id", productIds);
  }
  const staff = await service
    .from("employees")
    .select("id")
    .in("organization_id", orgIds)
    .like("first_name", `${MARK}%`);
  const staffIds = (staff.data ?? []).map((row) => row.id);
  if (staffIds.length > 0) {
    await service.from("attendance_alerts").delete().in("employee_id", staffIds);
    await service.from("attendance_sessions").delete().in("employee_id", staffIds);
  }
  await service.from("shifts").delete().in("organization_id", orgIds).like("code", `${MARK}%`);
  await service
    .from("employees")
    .delete()
    .in("organization_id", orgIds)
    .like("first_name", `${MARK}%`);
  await service.from("machines").delete().in("organization_id", orgIds).like("code", `${MARK}-%`);
  await service
    .from("operation_types")
    .delete()
    .in("organization_id", orgIds)
    .like("code", `${MARK}%`);
  await service.from("customers").delete().in("organization_id", orgIds).like("name", `${MARK} %`);
}

async function seed() {
  const org = fx.a.org.id;
  const s = fx.service;
  ids.type = (
    await s
      .from("operation_types")
      .insert({
        organization_id: org,
        code: `${MARK}GL`,
        name: `${MARK} Glodanje`,
        is_external: false,
      })
      .select("id")
      .single()
      .throwOnError()
  ).data.id;
  ids.machine = (
    await s
      .from("machines")
      .insert({ organization_id: org, code: `${MARK}-CNC`, name: "CNC", hourly_rate: 60 })
      .select("id")
      .single()
      .throwOnError()
  ).data.id;
  ids.customer = (
    await s
      .from("customers")
      .insert({ organization_id: org, name: `${MARK} Kupac` })
      .select("id")
      .single()
      .throwOnError()
  ).data.id;
  const product = await fx.a.admin.rpc("create_product", {
    p_org_id: org,
    p_product: { part_number: `${MARK}-1`, name: "Ploča", customer_id: ids.customer, unit: "pcs" },
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
  const saved = await fx.a.admin.rpc("save_product_operation", {
    p_revision_id: revision.data.id,
    p_operation_id: null as unknown as string,
    p_operation: {
      operation_type_id: ids.type,
      machine_id: ids.machine,
      cycle_time_s: "300",
    } as Json,
  });
  expect(saved.error).toBeNull();
  ids.employee = (
    await s
      .from("employees")
      .insert({
        organization_id: org,
        employee_number: 900401,
        first_name: `${MARK} Radnik`,
        last_name: "Test",
      })
      .select("id")
      .single()
      .throwOnError()
  ).data.id;
  const order = await fx.a.admin.rpc("create_production_order", {
    p_org_id: org,
    p_order: {
      customer_id: ids.customer,
      product_id: ids.product,
      quantity: "20",
      due_date: "2031-03-04",
      notes: `${MARK} order`,
    } as Json,
  });
  expect(order.error).toBeNull();
  ids.order = order.data!;
  await s.from("production_orders").update({ status: "planned" }).eq("id", ids.order);
  ids.op = (
    await s
      .from("production_order_operations")
      .select("id")
      .eq("order_id", ids.order)
      .eq("operation_type_id", ids.type)
      .single()
      .throwOnError()
  ).data.id;

  // 09:00–11:00 local on 3 March 2031 the machine runs; 10 good + 2 scrap.
  await s
    .from("production_order_status_history")
    .insert([
      {
        organization_id: org,
        order_id: ids.order,
        operation_id: ids.op,
        from_status: "ready",
        to_status: "in_progress",
        changed_at: "2031-03-03T08:00:00Z",
      },
      {
        organization_id: org,
        order_id: ids.order,
        operation_id: ids.op,
        from_status: "in_progress",
        to_status: "paused",
        changed_at: "2031-03-03T10:00:00Z",
      },
    ])
    .throwOnError();
  await s
    .from("production_work_sessions")
    .insert({
      organization_id: org,
      order_id: ids.order,
      operation_id: ids.op,
      employee_id: ids.employee,
      machine_id: ids.machine,
      started_at: "2031-03-03T08:00:00Z",
      ended_at: "2031-03-03T09:30:00Z",
    })
    .throwOnError();
  await s
    .from("production_reports")
    .insert({
      organization_id: org,
      order_id: ids.order,
      operation_id: ids.op,
      employee_id: ids.employee,
      machine_id: ids.machine,
      good_quantity: 10,
      scrap_quantity: 2,
      idempotency_key: crypto.randomUUID(),
      reported_at: "2031-03-03T09:45:00Z",
    })
    .throwOnError();
  const reason = await s
    .from("catalog_items")
    .select("id")
    .eq("organization_id", org)
    .eq("kind", "downtime_reason")
    .is("archived_at", null)
    .limit(1)
    .single()
    .throwOnError();
  // Clocked in for the first shift 07:00–15:00 local.
  ids.shift = (
    await s
      .from("shifts")
      .insert({
        organization_id: org,
        code: `${MARK}I`,
        name: `${MARK} Prva`,
        starts_at: "07:00",
        ends_at: "15:00",
      })
      .select("id")
      .single()
      .throwOnError()
  ).data.id;
  await s
    .from("attendance_sessions")
    .insert({
      organization_id: org,
      employee_id: ids.employee,
      shift_id: ids.shift,
      work_date: "2031-03-03",
      clock_in_at: "2031-03-03T06:00:00Z",
      clock_out_at: "2031-03-03T14:00:00Z",
      clock_in_source: "manual",
      clock_out_source: "manual",
      idempotency_key: crypto.randomUUID(),
    })
    .throwOnError();
  // 23:30 – 00:30 local: half an hour on each day.
  await s
    .from("production_downtime_events")
    .insert({
      organization_id: org,
      order_id: ids.order,
      operation_id: ids.op,
      machine_id: ids.machine,
      employee_id: ids.employee,
      reason_id: reason.data.id,
      started_at: "2031-03-03T22:30:00Z",
      ended_at: "2031-03-03T23:30:00Z",
    })
    .throwOnError();
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  await seed();
}, 120_000);

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

type Row = Record<string, unknown>;

describe("reports", () => {
  it("splits machine, worker and downtime by local day and keeps the routing time of the pieces", async () => {
    const { data, error } = await fx.a.admin.rpc("report_production", {
      p_org_id: fx.a.org.id,
      p_from: "2031-03-03",
      p_to: "2031-03-04",
    });
    expect(error).toBeNull();
    const report = data as Record<string, Row[]>;
    const mine = (rows: Row[] | undefined) => (rows ?? []).filter((r) => r.order_id === ids.order);
    expect(mine(report.output)).toEqual([
      expect.objectContaining({
        day: "2031-03-03",
        good: 10,
        scrap: 2,
        planned_seconds: 3600,
        shift_id: ids.shift,
      }),
    ]);
    expect(mine(report.machine_time)).toEqual([
      expect.objectContaining({ day: "2031-03-03", machine_id: ids.machine, seconds: 7200 }),
    ]);
    expect(mine(report.worker_time)).toEqual([
      expect.objectContaining({ day: "2031-03-03", employee_id: ids.employee, seconds: 5400 }),
    ]);
    expect(
      mine(report.downtime)
        .map((r) => [r.day, r.seconds])
        .sort(),
    ).toEqual([
      ["2031-03-03", 1800],
      ["2031-03-04", 1800],
    ]);
    expect(report.machines?.find((m) => m.id === ids.machine)).toMatchObject({ hourly_rate: 60 });
  });

  it("costs the machine hours of an open order due in the period", async () => {
    const { data, error } = await fx.a.admin.rpc("report_orders", {
      p_org_id: fx.a.org.id,
      p_from: "2031-03-01",
      p_to: "2031-03-31",
    });
    expect(error).toBeNull();
    const order = (data as Row[]).find((r) => r.id === ids.order);
    expect(order).toMatchObject({
      completed_on: null,
      due_date: "2031-03-04",
      run_seconds: 7200,
      machine_cost: 120,
      material_cost: 0,
      rate_missing: false,
    });
  });

  it("needs reports.read, a valid period and the own organization", async () => {
    const operator = await fx.a.operator.rpc("report_production", {
      p_org_id: fx.a.org.id,
      p_from: "2031-03-01",
      p_to: "2031-03-31",
    });
    expect(operator.error?.code).toBe("42501");
    const foreign = await fx.b.admin.rpc("report_orders", {
      p_org_id: fx.a.org.id,
      p_from: "2031-03-01",
      p_to: "2031-03-31",
    });
    expect(foreign.error?.code).toBe("42501");
    const long = await fx.a.admin.rpc("report_inventory", {
      p_org_id: fx.a.org.id,
      p_from: "2030-01-01",
      p_to: "2031-03-31",
    });
    expect(long.error?.message).toBe("invalid_period");
    const inventory = await fx.a.admin.rpc("report_inventory", {
      p_org_id: fx.a.org.id,
      p_from: "2031-03-01",
      p_to: "2031-03-31",
    });
    expect(inventory.error).toBeNull();
    expect(Object.keys(inventory.data as Row).sort()).toEqual([
      "consumption",
      "items",
      "receipts",
      "stock",
      "tools",
    ]);
  });
});
