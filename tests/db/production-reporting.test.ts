import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Production reporting: cutting with a count, start / pause / report /
// finish on the floor (partial quantities, idempotency, several workers),
// inspections by the inspector, automatic completion, closing with a
// shortage (request → approval), voiding, machine status, RLS and tenant
// isolation. Rows use the DBR prefix and are removed before and after.

const MARK = "DBR";
type Client = SupabaseClient<Database>;

let fx: Fixture;
let inspector: Client;
let operator2: Client;
const ids = {
  cutType: "",
  turnType: "",
  inspectionType: "",
  externalType: "",
  externalProduct: "",
  saw: "",
  cnc: "",
  customer: "",
  product: "",
  operatorEmployee: "",
  operator2Employee: "",
  inspectorEmployee: "",
  downtimeReason: "",
  scrapReason: "",
};

async function cleanup(service: Client, orgIds: string[]) {
  const orders = await service
    .from("production_orders")
    .select("id")
    .in("organization_id", orgIds)
    .like("notes", `${MARK}%`);
  const orderIds = (orders.data ?? []).map((row) => row.id);
  if (orderIds.length > 0) {
    const ops = await service
      .from("production_order_operations")
      .select("id")
      .in("order_id", orderIds);
    const opIds = (ops.data ?? []).map((row) => row.id);
    if (opIds.length > 0) {
      await service.from("production_order_operation_workers").delete().in("operation_id", opIds);
    }
    await service.from("production_reports").delete().in("order_id", orderIds);
    await service.from("production_work_sessions").delete().in("order_id", orderIds);
    await service.from("production_downtime_events").delete().in("order_id", orderIds);
    await service.from("production_order_close_requests").delete().in("order_id", orderIds);
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

  const employees = await service
    .from("employees")
    .select("id")
    .in("organization_id", orgIds)
    .like("first_name", `${MARK}%`);
  const employeeIds = (employees.data ?? []).map((row) => row.id);
  if (employeeIds.length > 0) {
    await service.from("employee_machines").delete().in("employee_id", employeeIds);
    await service.from("employees").delete().in("id", employeeIds);
  }
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

  const types = await s
    .from("operation_types")
    .insert(
      [
        { code: "RZ", name: "Rezanje", cutting: true },
        { code: "TO", name: "Tokarenje" },
        { code: "KT", name: "Kontrola", inspection: true },
        { code: "CI", name: "Cinčanje", external: true },
      ].map((t) => ({
        organization_id: org,
        code: `${MARK}${t.code}`,
        name: `${MARK} ${t.name}`,
        is_cutting: t.cutting ?? false,
        is_inspection: t.inspection ?? false,
        is_external: t.external ?? false,
      })),
    )
    .select("id, code")
    .throwOnError();
  const typeId = (code: string) => types.data.find((t) => t.code === `${MARK}${code}`)!.id;
  ids.cutType = typeId("RZ");
  ids.turnType = typeId("TO");
  ids.inspectionType = typeId("KT");
  ids.externalType = typeId("CI");

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

  const product = await fx.a.admin.rpc("create_product", {
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
    { operation_type_id: ids.cutType, machine_id: ids.saw, cycle_time_s: "10" },
    {
      operation_type_id: ids.turnType,
      machine_id: ids.cnc,
      setup_time_min: "10",
      cycle_time_s: "60",
    },
    { operation_type_id: ids.inspectionType, cycle_time_s: "20" },
  ]) {
    const saved = await fx.a.admin.rpc("save_product_operation", {
      p_revision_id: revision.data.id,
      p_operation_id: null as unknown as string,
      p_operation: op as Json,
    });
    expect(saved.error).toBeNull();
  }

  // Second product: turning → external zinc plating → final inspection.
  const external = await fx.a.admin.rpc("create_product", {
    p_org_id: org,
    p_product: { part_number: `${MARK}-2`, name: "Čep", customer_id: ids.customer, unit: "pcs" },
    p_revision: { revision: "A" },
  });
  expect(external.error).toBeNull();
  ids.externalProduct = external.data!;
  const externalRevision = await s
    .from("product_revisions")
    .select("id")
    .eq("product_id", ids.externalProduct)
    .single()
    .throwOnError();
  for (const op of [
    { operation_type_id: ids.turnType, machine_id: ids.cnc, cycle_time_s: "60" },
    { operation_type_id: ids.externalType, external_company: "Cinkara" },
    { operation_type_id: ids.inspectionType, cycle_time_s: "20" },
  ]) {
    const saved = await fx.a.admin.rpc("save_product_operation", {
      p_revision_id: externalRevision.data.id,
      p_operation_id: null as unknown as string,
      p_operation: op as Json,
    });
    expect(saved.error).toBeNull();
  }

  const inspectorId = await ensureUser(s, fx.a.org, {
    username: "kontrolor",
    password: testTenantPassword(),
    fullName: "Test Kontrolor",
    role: "quality_inspector",
  });
  const operator2Id = await ensureUser(s, fx.a.org, {
    username: "operater2",
    password: testTenantPassword(),
    fullName: "Test Operater 2",
    role: "operator",
  });
  inspector = await signIn("kontrolor", fx.a.org.slug);
  operator2 = await signIn("operater2", fx.a.org.slug);

  const employees = await s
    .from("employees")
    .insert([
      {
        organization_id: org,
        employee_number: 900201,
        first_name: `${MARK} Prvi`,
        last_name: "Radnik",
        user_id: fx.a.operatorId,
      },
      {
        organization_id: org,
        employee_number: 900202,
        first_name: `${MARK} Drugi`,
        last_name: "Radnik",
        user_id: operator2Id,
      },
      {
        organization_id: org,
        employee_number: 900203,
        first_name: `${MARK} Kontrolor`,
        last_name: "Test",
        user_id: inspectorId,
      },
    ])
    .select("id, employee_number")
    .throwOnError();
  const employeeId = (n: number) => employees.data.find((e) => e.employee_number === n)!.id;
  ids.operatorEmployee = employeeId(900201);
  ids.operator2Employee = employeeId(900202);
  ids.inspectorEmployee = employeeId(900203);
  await s
    .from("employee_machines")
    .insert([
      { organization_id: org, employee_id: ids.operatorEmployee, machine_id: ids.saw },
      { organization_id: org, employee_id: ids.operatorEmployee, machine_id: ids.cnc },
      { organization_id: org, employee_id: ids.operator2Employee, machine_id: ids.cnc },
    ])
    .throwOnError();

  const reasons = await s
    .from("catalog_items")
    .select("id, kind, name")
    .eq("organization_id", org)
    .in("kind", ["downtime_reason", "scrap_reason"])
    .is("archived_at", null)
    .throwOnError();
  ids.downtimeReason = reasons.data.find((r) => r.kind === "downtime_reason")!.id;
  ids.scrapReason = reasons.data.find((r) => r.kind === "scrap_reason")!.id;
}

async function releasedOrder(quantity: string, productId = ids.product): Promise<string> {
  const { data, error } = await fx.a.admin.rpc("create_production_order", {
    p_org_id: fx.a.org.id,
    p_order: {
      customer_id: ids.customer,
      product_id: productId,
      quantity,
      due_date: "2030-06-30",
      notes: `${MARK} order`,
    } as Json,
  });
  expect(error).toBeNull();
  const status = await fx.a.admin.rpc("set_production_order_status", {
    p_order_id: data!,
    p_status: "planned",
  });
  expect(status.error).toBeNull();
  return data!;
}

async function op(orderId: string, typeId: string) {
  const { data } = await fx.service
    .from("production_order_operations")
    .select("id, status")
    .eq("order_id", orderId)
    .eq("operation_type_id", typeId)
    .single()
    .throwOnError();
  return data;
}

async function orderStatus(orderId: string) {
  const { data } = await fx.service
    .from("production_orders")
    .select("status")
    .eq("id", orderId)
    .single()
    .throwOnError();
  return data.status;
}

async function machineStatus(machineId: string) {
  const { data } = await fx.service
    .from("machines")
    .select("status")
    .eq("id", machineId)
    .single()
    .throwOnError();
  return data.status;
}

function cut(client: Client, orderId: string, quantity: string, key = crypto.randomUUID()) {
  return client.rpc("finish_cutting", {
    p_order_id: orderId,
    p_quantity: quantity as unknown as number,
    p_idempotency_key: key,
  });
}

function report(
  client: Client,
  operationId: string,
  good: string,
  scrap = "0",
  options: { finish?: boolean; key?: string; scrapReason?: string | null } = {},
) {
  return client.rpc("report_operation_quantity", {
    p_operation_id: operationId,
    p_good: good as unknown as number,
    p_scrap: scrap as unknown as number,
    p_scrap_reason_id: (options.scrapReason ?? null) as string,
    p_notes: null as unknown as string,
    p_idempotency_key: options.key ?? crypto.randomUUID(),
    p_finish: options.finish ?? false,
  });
}

async function work(client: Client, operationId: string) {
  const { data, error } = await client.rpc("floor_operation_work", { p_operation_id: operationId });
  expect(error).toBeNull();
  return data as {
    input_quantity: number;
    good_quantity: number;
    scrap_quantity: number;
    remaining_quantity: number;
    blocked: string | null;
    working: boolean;
    workers_now: string[];
    pause: { reason: string } | null;
  } | null;
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  await seed();
});

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("starter reasons", () => {
  it("every organization has downtime and scrap reasons it manages with orders.manage", async () => {
    for (const tenant of [fx.a, fx.b]) {
      const { data } = await tenant.admin
        .from("catalog_items")
        .select("kind")
        .eq("organization_id", tenant.org.id)
        .in("kind", ["downtime_reason", "scrap_reason"]);
      expect(new Set((data ?? []).map((r) => r.kind))).toEqual(
        new Set(["downtime_reason", "scrap_reason"]),
      );
    }
    const denied = await fx.a.operator
      .from("catalog_items")
      .insert({ organization_id: fx.a.org.id, kind: "downtime_reason", name: `${MARK} x` });
    expect(denied.error?.code).toBe("42501");
  });
});

describe("a production order from cutting to completion with a shortage", () => {
  let orderId = "";
  let turning = "";
  let inspection = "";
  const repeatedKey = crypto.randomUUID();

  beforeAll(async () => {
    orderId = await releasedOrder("10");
    turning = (await op(orderId, ids.turnType)).id;
    inspection = (await op(orderId, ids.inspectionType)).id;
  });

  it("starts cutting with the order status and finishes it with the cut pieces", async () => {
    expect(
      (
        await fx.a.operator.rpc("set_production_order_status", {
          p_order_id: orderId,
          p_status: "cutting",
        })
      ).error,
    ).toBeNull();
    expect((await op(orderId, ids.cutType)).status).toBe("in_progress");
    expect(await machineStatus(ids.saw)).toBe("running");

    // "Ready" without a count is refused while the cutting operation is open.
    const plain = await fx.a.operator.rpc("set_production_order_status", {
      p_order_id: orderId,
      p_status: "ready",
    });
    expect(plain.error?.message).toBe("cut_quantity_required");
    expect((await cut(fx.a.operator, orderId, "9.5")).error?.message).toBe("whole_pieces_required");
    expect((await cut(fx.a.operator, orderId, "10")).error).toBeNull();

    expect(await orderStatus(orderId)).toBe("ready");
    expect((await op(orderId, ids.cutType)).status).toBe("done");
    expect((await op(orderId, ids.turnType)).status).toBe("ready");
    expect(await machineStatus(ids.saw)).toBe("available");
  });

  it("reports only after starting; starting moves order and machine", async () => {
    expect((await report(fx.a.operator, turning, "1")).error?.message).toBe(
      "operation_not_started",
    );
    expect((await work(fx.a.operator, turning))?.blocked).toBeNull();
    expect(
      (await fx.a.operator.rpc("start_operation_work", { p_operation_id: turning })).error,
    ).toBeNull();
    // Starting twice is harmless.
    expect(
      (await fx.a.operator.rpc("start_operation_work", { p_operation_id: turning })).error,
    ).toBeNull();
    expect(await orderStatus(orderId)).toBe("in_progress");
    expect((await op(orderId, ids.turnType)).status).toBe("in_progress");
    expect(await machineStatus(ids.cnc)).toBe("running");
    const state = await work(fx.a.operator, turning);
    expect(state).toMatchObject({ input_quantity: 10, working: true });
  });

  it("takes parts, never twice for the same key and never more than arrived", async () => {
    const first = await report(fx.a.operator, turning, "4", "1", {
      key: repeatedKey,
      scrapReason: ids.scrapReason,
    });
    expect(first.error).toBeNull();
    const again = await report(fx.a.operator, turning, "4", "1", { key: repeatedKey });
    expect(again.error).toBeNull();
    expect((again.data as { report_id: string }).report_id).toBe(
      (first.data as { report_id: string }).report_id,
    );

    expect((await report(fx.a.operator, turning, "1.5")).error?.message).toBe(
      "whole_pieces_required",
    );
    expect((await report(fx.a.operator, turning, "5", "1")).error?.message).toBe(
      "quantity_exceeds_input",
    );
    expect((await report(fx.a.operator, turning, "0")).error?.message).toBe("quantity_required");
    expect(await work(fx.a.operator, turning)).toMatchObject({
      good_quantity: 4,
      scrap_quantity: 1,
      remaining_quantity: 5,
    });
  });

  it("passes good pieces on at once: the inspection has arrived, for inspectors only", async () => {
    const queue = await inspector.rpc("floor_operation_queue", { p_org_id: fx.a.org.id });
    expect(queue.error).toBeNull();
    const row = queue.data!.find((r) => r.operation_id === inspection);
    expect(row).toMatchObject({ arrived: true, input_quantity: 4 });

    const operatorStart = await fx.a.operator.rpc("start_operation_work", {
      p_operation_id: inspection,
    });
    expect(operatorStart.error?.code).toBe("42501");
    expect(await work(fx.a.operator, inspection)).toBeNull();
  });

  it("pauses with a reason; a second worker continues; time is kept per worker", async () => {
    const noReason = await fx.a.operator.rpc("pause_operation_work", {
      p_operation_id: turning,
      p_reason_id: ids.scrapReason,
    });
    expect(noReason.error?.message).toBe("downtime_reason_required");

    expect(
      (
        await fx.a.operator.rpc("pause_operation_work", {
          p_operation_id: turning,
          p_reason_id: ids.downtimeReason,
          p_notes: "Lom pločice",
        })
      ).error,
    ).toBeNull();
    expect((await op(orderId, ids.turnType)).status).toBe("paused");
    expect(await machineStatus(ids.cnc)).toBe("stopped");
    expect((await work(fx.a.operator, turning))?.pause).not.toBeNull();

    // Pausing again: there is no open session any more.
    const twice = await fx.a.operator.rpc("pause_operation_work", {
      p_operation_id: turning,
      p_reason_id: ids.downtimeReason,
    });
    expect(twice.error?.message).toBe("no_open_session");

    for (const client of [operator2, fx.a.operator]) {
      expect(
        (await client.rpc("start_operation_work", { p_operation_id: turning })).error,
      ).toBeNull();
    }
    const downtime = await fx.service
      .from("production_downtime_events")
      .select("ended_at, notes")
      .eq("operation_id", turning)
      .throwOnError();
    expect(downtime.data).toHaveLength(1);
    expect(downtime.data[0]?.ended_at).not.toBeNull();
    expect((await work(operator2, turning))?.workers_now).toHaveLength(2);

    // One of two leaves: the operation keeps running, no downtime.
    expect(
      (
        await fx.a.operator.rpc("pause_operation_work", {
          p_operation_id: turning,
          p_reason_id: ids.downtimeReason,
        })
      ).error,
    ).toBeNull();
    expect((await op(orderId, ids.turnType)).status).toBe("in_progress");
    expect(await machineStatus(ids.cnc)).toBe("running");
    const events = await fx.service
      .from("production_downtime_events")
      .select("id")
      .eq("operation_id", turning)
      .throwOnError();
    expect(events.data).toHaveLength(1);

    const sessions = await fx.service
      .from("production_work_sessions")
      .select("employee_id, ended_at")
      .eq("operation_id", turning)
      .throwOnError();
    expect(sessions.data.filter((x) => x.employee_id === ids.operatorEmployee)).toHaveLength(2);
    expect(sessions.data.filter((x) => x.employee_id === ids.operator2Employee)).toHaveLength(1);
  });

  it("finishing ends all work and moves the order to quality control", async () => {
    expect((await report(operator2, turning, "5", "0", { finish: true })).error).toBeNull();
    expect((await op(orderId, ids.turnType)).status).toBe("done");
    expect(await machineStatus(ids.cnc)).toBe("available");
    expect(await orderStatus(orderId)).toBe("quality_check");
    const open = await fx.service
      .from("production_work_sessions")
      .select("id")
      .eq("operation_id", turning)
      .is("ended_at", null)
      .throwOnError();
    expect(open.data).toEqual([]);

    const operations = await fx.a.admin
      .from("production_order_operation_directory")
      .select("good_quantity, scrap_quantity, input_quantity, worker_seconds, run_seconds")
      .eq("id", turning)
      .single()
      .throwOnError();
    expect(operations.data).toMatchObject({
      good_quantity: 9,
      scrap_quantity: 1,
      input_quantity: 10,
    });
    expect(Number(operations.data.worker_seconds)).toBeGreaterThanOrEqual(0);
  });

  it("the inspector reports the inspection; a shortage needs an approved request", async () => {
    expect(
      (await inspector.rpc("start_operation_work", { p_operation_id: inspection })).error,
    ).toBeNull();
    expect(await orderStatus(orderId)).toBe("quality_check");
    expect((await report(inspector, inspection, "8", "1", { finish: true })).error).toBeNull();
    expect(await orderStatus(orderId)).toBe("quality_check");

    const manual = await fx.a.admin.rpc("set_production_order_status", {
      p_order_id: orderId,
      p_status: "completed",
    });
    expect(manual.error?.message).toBe("completion_requires_production_report");

    const operatorAsk = await fx.a.operator.rpc("request_order_close", {
      p_order_id: orderId,
      p_reason: "x",
    });
    expect(operatorAsk.error?.code).toBe("42501");
    const noReason = await inspector.rpc("request_order_close", {
      p_order_id: orderId,
      p_reason: " ",
    });
    expect(noReason.error?.message).toBe("close_reason_required");
    const asked = await inspector.rpc("request_order_close", {
      p_order_id: orderId,
      p_reason: "Dva komada škart",
    });
    expect(asked.error).toBeNull();
    const twice = await inspector.rpc("request_order_close", {
      p_order_id: orderId,
      p_reason: "Opet",
    });
    expect(twice.error?.message).toBe("close_request_pending");

    const selfApprove = await inspector.rpc("decide_order_close", {
      p_request_id: asked.data!,
      p_approve: true,
    });
    expect(selfApprove.error?.code).toBe("42501");
    const rejectWithoutNote = await fx.a.admin.rpc("decide_order_close", {
      p_request_id: asked.data!,
      p_approve: false,
    });
    expect(rejectWithoutNote.error?.message).toBe("reject_note_required");

    expect(
      (await fx.a.admin.rpc("decide_order_close", { p_request_id: asked.data!, p_approve: true }))
        .error,
    ).toBeNull();
    expect(await orderStatus(orderId)).toBe("completed");

    const directory = await fx.a.admin
      .from("production_order_directory")
      .select("good_quantity, completion_allowed, close_request_pending")
      .eq("id", orderId)
      .single()
      .throwOnError();
    expect(directory.data).toEqual({
      good_quantity: 8,
      completion_allowed: true,
      close_request_pending: false,
    });

    const log = await fx.a.admin.rpc("production_order_close_log", { p_order_id: orderId });
    expect(log.data?.[0]).toMatchObject({ status: "approved", reason: "Dva komada škart" });
  });

  it("refuses reports and voids once the order is closed", async () => {
    const reports = await fx.a.admin.rpc("production_order_reports", { p_order_id: orderId });
    expect(reports.error).toBeNull();
    expect(reports.data!.length).toBe(4);
    const voided = await fx.a.admin.rpc("void_production_report", {
      p_report_id: reports.data![0]!.id,
      p_reason: "Pogrešno",
    });
    expect(voided.error?.message).toBe("order_closed");
  });
});

describe("automatic completion, voiding and access", () => {
  let orderId = "";
  let turning = "";
  let inspection = "";

  beforeAll(async () => {
    orderId = await releasedOrder("2");
    turning = (await op(orderId, ids.turnType)).id;
    inspection = (await op(orderId, ids.inspectionType)).id;
    expect((await cut(fx.a.admin, orderId, "3")).error).toBeNull();
  });

  it("lets only managers void a report, with a reason; voided pieces do not count", async () => {
    expect(
      (await fx.a.operator.rpc("start_operation_work", { p_operation_id: turning })).error,
    ).toBeNull();
    const wrong = await report(fx.a.operator, turning, "3");
    expect(wrong.error).toBeNull();
    const reportId = (wrong.data as { report_id: string }).report_id;

    const byOperator = await fx.a.operator.rpc("void_production_report", {
      p_report_id: reportId,
      p_reason: "x",
    });
    expect(byOperator.error?.code).toBe("42501");
    const noReason = await fx.a.admin.rpc("void_production_report", {
      p_report_id: reportId,
      p_reason: "",
    });
    expect(noReason.error?.message).toBe("void_reason_required");
    expect(
      (
        await fx.a.admin.rpc("void_production_report", {
          p_report_id: reportId,
          p_reason: "Pogrešan unos",
        })
      ).error,
    ).toBeNull();
    expect(await work(fx.a.operator, turning)).toMatchObject({
      good_quantity: 0,
      remaining_quantity: 3,
    });
  });

  it("completes the order by itself when the last operation has enough good pieces", async () => {
    expect((await report(fx.a.operator, turning, "2", "1", { finish: true })).error).toBeNull();
    expect(
      (await inspector.rpc("start_operation_work", { p_operation_id: inspection })).error,
    ).toBeNull();
    expect((await report(inspector, inspection, "2", "0", { finish: true })).error).toBeNull();
    expect(await orderStatus(orderId)).toBe("completed");

    const history = await fx.a.admin.rpc("production_order_status_log", { p_order_id: orderId });
    const orderSteps = history
      .data!.filter((row) => !row.operation_id)
      .map((row) => row.to_status)
      .reverse();
    expect(orderSteps).toEqual(["planned", "ready", "in_progress", "quality_check", "completed"]);
  });

  it("keeps reports, sessions and downtime out of reach of operators and other tenants", async () => {
    for (const table of [
      "production_reports",
      "production_work_sessions",
      "production_downtime_events",
      "production_order_close_requests",
    ] as const) {
      const operatorRead = await fx.a.operator.from(table).select("id").eq("order_id", orderId);
      expect(operatorRead.data ?? []).toEqual([]);
      const otherTenant = await fx.b.admin.from(table).select("id").eq("order_id", orderId);
      expect(otherTenant.data ?? []).toEqual([]);
    }
    const insert = await fx.a.admin.from("production_reports").insert({
      organization_id: fx.a.org.id,
      order_id: orderId,
      operation_id: turning,
      good_quantity: 1,
      scrap_quantity: 0,
      idempotency_key: crypto.randomUUID(),
    });
    expect(insert.error?.code).toBe("42501");

    const foreign = await fx.b.admin.rpc("start_operation_work", { p_operation_id: turning });
    expect(foreign.error?.code).toBe("P0002");
    expect(
      (await fx.b.admin.rpc("production_order_reports", { p_order_id: orderId })).data,
    ).toEqual([]);
  });
});

describe("external operations, progress and close notifications", () => {
  let orderId = "";
  let turning = "";
  let external = "";
  let inspection = "";

  const directory = async () =>
    (
      await fx.a.admin
        .from("production_order_directory")
        .select(
          "status, progress_percent, current_operation_code, current_operation_external, close_request_pending",
        )
        .eq("id", orderId)
        .single()
        .throwOnError()
    ).data;
  const setOperation = (operationId: string, status: string) =>
    fx.a.admin.rpc("set_order_operation_status", {
      p_operation_id: operationId,
      p_status: status,
    });

  beforeAll(async () => {
    orderId = await releasedOrder("2", ids.externalProduct);
    turning = (await op(orderId, ids.turnType)).id;
    external = (await op(orderId, ids.externalType)).id;
    inspection = (await op(orderId, ids.inspectionType)).id;
    expect(
      (
        await fx.a.admin.rpc("set_production_order_status", {
          p_order_id: orderId,
          p_status: "ready",
        })
      ).error,
    ).toBeNull();
  });

  it("shows progress and the operation the order has reached", async () => {
    expect(await directory()).toMatchObject({
      progress_percent: 0,
      current_operation_code: `${MARK}TO`,
      current_operation_external: false,
    });
    expect(
      (await fx.a.operator.rpc("start_operation_work", { p_operation_id: turning })).error,
    ).toBeNull();
    expect((await report(fx.a.operator, turning, "1")).error).toBeNull();
    // Turning half done: (0.5 + 0 + 0) / 3.
    expect((await directory()).progress_percent).toBe(16);
    expect((await report(fx.a.operator, turning, "1", "0", { finish: true })).error).toBeNull();
    expect(await directory()).toMatchObject({
      progress_percent: 33,
      current_operation_code: `${MARK}CI`,
      current_operation_external: true,
    });
    // The pieces reached the external step: preparing the shipment.
    expect((await op(orderId, ids.externalType)).status).toBe("ready");
  });

  it("moves external work only through shipped and received, by the head of production", async () => {
    expect((await setOperation(external, "paused")).error?.message).toBe(
      "invalid_status_transition",
    );
    expect((await setOperation(external, "done")).error?.message).toBe("invalid_status_transition");
    const byOperator = await fx.a.operator.rpc("set_order_operation_status", {
      p_operation_id: external,
      p_status: "in_progress",
    });
    expect(byOperator.error?.code).toBe("42501");

    expect((await setOperation(external, "in_progress")).error).toBeNull();
    expect((await directory()).progress_percent).toBe(50);
    expect((await setOperation(external, "done")).error).toBeNull();
    // Received: the inspection is next and only inspections are left.
    expect((await op(orderId, ids.inspectionType)).status).toBe("ready");
    expect(await directory()).toMatchObject({
      status: "quality_check",
      current_operation_code: `${MARK}KT`,
    });
  });

  it("notifies approvers of a request to close with a shortage", async () => {
    expect(
      (await inspector.rpc("start_operation_work", { p_operation_id: inspection })).error,
    ).toBeNull();
    expect((await report(inspector, inspection, "1", "1", { finish: true })).error).toBeNull();
    const asked = await inspector.rpc("request_order_close", {
      p_order_id: orderId,
      p_reason: "Jedan komad oštećen u cinčaoni",
    });
    expect(asked.error).toBeNull();
    expect((await directory()).close_request_pending).toBe(true);

    const forApprover = await fx.a.admin.rpc("pending_close_requests", {
      p_org_id: fx.a.org.id,
    });
    expect(forApprover.data?.map((row) => row.order_id)).toContain(orderId);
    const forInspector = await inspector.rpc("pending_close_requests", {
      p_org_id: fx.a.org.id,
    });
    expect(forInspector.data).toEqual([]);
    const otherTenant = await fx.b.admin.rpc("pending_close_requests", {
      p_org_id: fx.a.org.id,
    });
    expect(otherTenant.data ?? []).toEqual([]);

    expect(
      (await fx.a.admin.rpc("decide_order_close", { p_request_id: asked.data!, p_approve: true }))
        .error,
    ).toBeNull();
    expect(await directory()).toMatchObject({
      status: "completed",
      progress_percent: 100,
      close_request_pending: false,
    });
  });
});
