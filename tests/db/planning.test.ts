import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/types";
import { setupFixture, type Fixture } from "./fixtures";

// Production planning (D-041): operations placed on a machine and a day
// with an operator (also on unattended machines), the day the operation was
// added kept for automatic moves, permission and tenant checks, machine
// downtimes with an open end, and the days / price of an external operation
// once the pieces are back. Rows use the DBP prefix.

const MARK = "DBP";
type Client = SupabaseClient<Database>;

let fx: Fixture;
const ids = {
  turnType: "",
  externalType: "",
  cnc: "",
  edm: "",
  customer: "",
  product: "",
  employee: "",
  order: "",
  turnOp: "",
  externalOp: "",
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
  }
  await service
    .from("employees")
    .delete()
    .in("organization_id", orgIds)
    .like("first_name", `${MARK}%`);
  const machines = await service
    .from("machines")
    .select("id")
    .in("organization_id", orgIds)
    .like("code", `${MARK}-%`);
  const machineIds = (machines.data ?? []).map((row) => row.id);
  if (machineIds.length > 0) {
    await service.from("machine_downtimes").delete().in("machine_id", machineIds);
    await service.from("machines").delete().in("id", machineIds);
  }
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
    .insert([
      { organization_id: org, code: `${MARK}TO`, name: `${MARK} Tokarenje`, is_external: false },
      { organization_id: org, code: `${MARK}KA`, name: `${MARK} Kaljenje`, is_external: true },
    ])
    .select("id, code")
    .throwOnError();
  ids.turnType = types.data.find((t) => t.code === `${MARK}TO`)!.id;
  ids.externalType = types.data.find((t) => t.code === `${MARK}KA`)!.id;

  const machines = await s
    .from("machines")
    .insert([
      { organization_id: org, code: `${MARK}-CNC`, name: "CNC", runs_unattended: false },
      { organization_id: org, code: `${MARK}-EDM`, name: "Erozimat", runs_unattended: true },
    ])
    .select("id, code")
    .throwOnError();
  ids.cnc = machines.data.find((m) => m.code === `${MARK}-CNC`)!.id;
  ids.edm = machines.data.find((m) => m.code === `${MARK}-EDM`)!.id;

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
      name: "Matrica",
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
    {
      operation_type_id: ids.turnType,
      machine_id: ids.cnc,
      setup_time_min: "30",
      cycle_time_s: "90",
    },
    { operation_type_id: ids.externalType, external_company: "Kaliona" },
  ]) {
    const saved = await fx.a.admin.rpc("save_product_operation", {
      p_revision_id: revision.data.id,
      p_operation_id: null as unknown as string,
      p_operation: op as Json,
    });
    expect(saved.error).toBeNull();
  }

  const employee = await s
    .from("employees")
    .insert({
      organization_id: org,
      employee_number: 900301,
      first_name: `${MARK} Operater`,
      last_name: "Test",
    })
    .select("id")
    .single()
    .throwOnError();
  ids.employee = employee.data.id;
  await s
    .from("employee_machines")
    .insert([
      { organization_id: org, employee_id: ids.employee, machine_id: ids.cnc },
      { organization_id: org, employee_id: ids.employee, machine_id: ids.edm },
    ])
    .throwOnError();

  const order = await fx.a.admin.rpc("create_production_order", {
    p_org_id: org,
    p_order: {
      customer_id: ids.customer,
      product_id: ids.product,
      quantity: "40",
      due_date: "2030-06-30",
      notes: `${MARK} order`,
    } as Json,
  });
  expect(order.error).toBeNull();
  ids.order = order.data!;
  const ops = await s
    .from("production_order_operations")
    .select("id, operation_type_id")
    .eq("order_id", ids.order)
    .throwOnError();
  ids.turnOp = ops.data.find((o) => o.operation_type_id === ids.turnType)!.id;
  ids.externalOp = ops.data.find((o) => o.operation_type_id === ids.externalType)!.id;
}

async function planRow() {
  const { data } = await fx.service
    .from("production_order_operations")
    .select("machine_id, plan_day, plan_position, plan_added_at")
    .eq("id", ids.turnOp)
    .single()
    .throwOnError();
  return data;
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  await seed();
}, 120_000);

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("planning board", () => {
  it("needs an operator, also on an unattended machine, and keeps the added time on automatic moves", async () => {
    const withoutOperator = await fx.a.admin.rpc("plan_operations", {
      p_org_id: fx.a.org.id,
      p_moves: [
        { operation_id: ids.turnOp, machine_id: ids.edm, plan_day: "2030-05-06", position: 1 },
      ],
    });
    expect(withoutOperator.error?.code).toBe("23514");
    expect(withoutOperator.error?.message).toBe("operator_required");

    const planned = await fx.a.admin.rpc("plan_operations", {
      p_org_id: fx.a.org.id,
      p_moves: [
        {
          operation_id: ids.turnOp,
          machine_id: ids.edm,
          plan_day: "2030-05-06",
          position: 1,
          employee_ids: [ids.employee],
        },
      ],
    });
    expect(planned.error).toBeNull();
    const first = await planRow();
    expect(first).toMatchObject({ machine_id: ids.edm, plan_day: "2030-05-06", plan_position: 1 });
    expect(first.plan_added_at).not.toBeNull();

    // The program moves it to the next day: when it was added stays.
    const auto = await fx.a.admin.rpc("plan_operations", {
      p_org_id: fx.a.org.id,
      p_moves: [{ operation_id: ids.turnOp, plan_day: "2030-05-07", position: 1, auto: true }],
    });
    expect(auto.error).toBeNull();
    const moved = await planRow();
    expect(moved).toMatchObject({ machine_id: ids.edm, plan_day: "2030-05-07" });
    expect(moved.plan_added_at).toBe(first.plan_added_at);

    // Moving by hand counts as added again.
    const manual = await fx.a.admin.rpc("plan_operations", {
      p_org_id: fx.a.org.id,
      p_moves: [
        { operation_id: ids.turnOp, machine_id: ids.cnc, plan_day: "2030-05-08", position: 2 },
      ],
    });
    expect(manual.error).toBeNull();
    const again = await planRow();
    expect(again).toMatchObject({ machine_id: ids.cnc, plan_day: "2030-05-08", plan_position: 2 });
    expect(again.plan_added_at).not.toBe(first.plan_added_at);

    const off = await fx.a.admin.rpc("plan_operations", {
      p_org_id: fx.a.org.id,
      p_moves: [{ operation_id: ids.turnOp, plan_day: null }],
    });
    expect(off.error).toBeNull();
    expect(await planRow()).toMatchObject({
      plan_day: null,
      plan_position: null,
      plan_added_at: null,
    });
  });

  it("refuses external operations, operators without orders.manage and other tenants", async () => {
    const external = await fx.a.admin.rpc("plan_operations", {
      p_org_id: fx.a.org.id,
      p_moves: [{ operation_id: ids.externalOp, plan_day: "2030-05-06", position: 1 }],
    });
    expect(external.error?.message).toBe("not_machine_operation");

    const operator = await fx.a.operator.rpc("plan_operations", {
      p_org_id: fx.a.org.id,
      p_moves: [{ operation_id: ids.turnOp, plan_day: "2030-05-06", position: 1 }],
    });
    expect(operator.error?.code).toBe("42501");

    const foreign = await fx.b.admin.rpc("plan_operations", {
      p_org_id: fx.b.org.id,
      p_moves: [{ operation_id: ids.turnOp, plan_day: "2030-05-06", position: 1 }],
    });
    expect(foreign.error?.code).toBe("P0002");
  });

  it("records machine downtimes with an open end", async () => {
    const saved = await fx.a.admin.rpc("save_machine_downtime", {
      p_org_id: fx.a.org.id,
      p_id: null as unknown as string,
      p_machine_id: ids.cnc,
      p_starts_on: "2030-05-06",
      p_ends_on: null as unknown as string,
      p_reason_id: null as unknown as string,
      p_note: " Kvar vretena ",
    });
    expect(saved.error).toBeNull();
    const ended = await fx.a.admin.rpc("save_machine_downtime", {
      p_org_id: fx.a.org.id,
      p_id: saved.data!,
      p_machine_id: ids.cnc,
      p_starts_on: "2030-05-06",
      p_ends_on: "2030-05-09",
      p_reason_id: null as unknown as string,
      p_note: "Kvar vretena",
    });
    expect(ended.error).toBeNull();
    const row = await fx.a.operator
      .from("machine_downtimes")
      .select("starts_on, ends_on, note")
      .eq("id", saved.data!)
      .single();
    expect(row.data).toEqual({
      starts_on: "2030-05-06",
      ends_on: "2030-05-09",
      note: "Kvar vretena",
    });

    const invalid = await fx.a.admin.rpc("save_machine_downtime", {
      p_org_id: fx.a.org.id,
      p_id: saved.data!,
      p_machine_id: ids.cnc,
      p_starts_on: "2030-05-06",
      p_ends_on: "2030-05-01",
      p_reason_id: null as unknown as string,
      p_note: null as unknown as string,
    });
    expect(invalid.error?.message).toBe("invalid_period");
    const denied = await fx.a.operator.rpc("archive_machine_downtime", {
      p_org_id: fx.a.org.id,
      p_id: saved.data!,
    });
    expect(denied.error?.code).toBe("42501");
    const foreign = await fx.b.admin.from("machine_downtimes").select("id").eq("id", saved.data!);
    expect(foreign.data).toEqual([]);

    const archived = await fx.a.admin.rpc("archive_machine_downtime", {
      p_org_id: fx.a.org.id,
      p_id: saved.data!,
    });
    expect(archived.error).toBeNull();
  });

  it("takes days and price of an external operation only after the pieces are back", async () => {
    const early = await fx.a.admin.rpc("record_external_result", {
      p_operation_id: ids.externalOp,
      p_days: 5,
      p_cost: 120,
    });
    expect(early.error?.message).toBe("external_not_received");

    await fx.service
      .from("production_order_operations")
      .update({ status: "done" })
      .eq("id", ids.externalOp)
      .throwOnError();
    const recorded = await fx.a.admin.rpc("record_external_result", {
      p_operation_id: ids.externalOp,
      p_days: 5,
      p_cost: 120.456,
    });
    expect(recorded.error).toBeNull();
    const row = await fx.service
      .from("production_order_operations")
      .select("external_days, external_cost")
      .eq("id", ids.externalOp)
      .single()
      .throwOnError();
    expect(row.data).toEqual({ external_days: 5, external_cost: 120.46 });

    const notExternal = await fx.a.admin.rpc("record_external_result", {
      p_operation_id: ids.turnOp,
      p_days: 1,
      p_cost: 1,
    });
    expect(notExternal.error?.message).toBe("not_external_operation");
  });
});
