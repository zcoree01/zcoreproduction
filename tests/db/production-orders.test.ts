import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { formatOrderNumber } from "@/modules/production-orders/rules";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Production orders: numbering (incl. concurrency), routing snapshot, planned
// time, status rules per role, assignments (qualification, inspectors,
// warnings), floor visibility and tenant isolation. Rows created here use the
// DBO prefix and are removed before and after the run (audit rows stay).

const MARK = "DBO";
type Client = SupabaseClient<Database>;

let fx: Fixture;
let warehouse: Client;
let inspector: Client;
const ids = {
  cutType: "",
  turnType: "",
  inspectionType: "",
  externalType: "",
  cncTypeId: "",
  saw: "",
  cnc1: "",
  cnc2: "",
  customer: "",
  product: "",
  revision: "",
  drawing: "",
  operatorEmployee: "",
  otherEmployee: "",
  inspectorEmployee: "",
  customerB: "",
  productB: "",
};

function untyped(client: Client): SupabaseClient {
  return client as unknown as SupabaseClient;
}

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
    // Copies point at their source.
    await service.from("production_orders").delete().in("source_order_id", orderIds);
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
      await service.from("product_attachments").delete().in("revision_id", revisionIds);
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
  await service
    .from("catalog_items")
    .delete()
    .in("organization_id", orgIds)
    .like("name", `${MARK} %`);
  await service.from("customers").delete().in("organization_id", orgIds).like("name", `${MARK} %`);
}

async function seed() {
  const org = fx.a.org.id;
  const s = fx.service;
  const type = await s
    .from("catalog_items")
    .insert({ organization_id: org, kind: "machine_type", name: `${MARK} CNC` })
    .select("id")
    .single()
    .throwOnError();
  ids.cncTypeId = type.data.id;

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
      { organization_id: org, code: `${MARK}-CNC1`, name: "CNC 1", type_id: ids.cncTypeId },
      { organization_id: org, code: `${MARK}-CNC2`, name: "CNC 2" },
    ])
    .select("id, code")
    .throwOnError();
  const machineId = (code: string) => machines.data.find((m) => m.code === `${MARK}-${code}`)!.id;
  ids.saw = machineId("SAW");
  ids.cnc1 = machineId("CNC1");
  ids.cnc2 = machineId("CNC2");

  const customer = await s
    .from("customers")
    .insert({ organization_id: org, name: `${MARK} Kupac` })
    .select("id")
    .single()
    .throwOnError();
  ids.customer = customer.data.id;

  const product = await fx.a.admin.rpc("create_product", {
    p_org_id: org,
    p_product: { part_number: `${MARK}-2000`, name: "Čep", customer_id: ids.customer, unit: "pcs" },
    p_revision: { revision: "A", cut_length_mm: "30", kerf_mm: "2" },
  });
  expect(product.error).toBeNull();
  ids.product = product.data!;
  const revision = await s
    .from("product_revisions")
    .select("id")
    .eq("product_id", ids.product)
    .single()
    .throwOnError();
  ids.revision = revision.data.id;

  for (const op of [
    {
      operation_type_id: ids.cutType,
      machine_id: ids.saw,
      setup_time_min: "5",
      cycle_time_s: "10",
    },
    {
      operation_type_id: ids.turnType,
      machine_type_id: ids.cncTypeId,
      setup_time_min: "30",
      cycle_time_s: "95",
    },
    { operation_type_id: ids.inspectionType, setup_time_min: "0", cycle_time_s: "30" },
    { operation_type_id: ids.externalType, external_company: "Cinkara" },
  ]) {
    const saved = await fx.a.admin.rpc("save_product_operation", {
      p_revision_id: ids.revision,
      p_operation_id: null as unknown as string,
      p_operation: op as Json,
    });
    expect(saved.error).toBeNull();
  }

  // A drawing record (the file itself is not needed for these tests).
  const drawing = await s
    .from("product_attachments")
    .insert({
      organization_id: org,
      revision_id: ids.revision,
      kind: "main_drawing",
      file_name: "crtez.pdf",
      storage_path: `${org}/${ids.product}/00000000-0000-4000-8000-000000000001.pdf`,
      content_type: "application/pdf",
      size_bytes: 100,
    })
    .select("id")
    .single()
    .throwOnError();
  ids.drawing = drawing.data.id;

  await ensureUser(s, fx.a.org, {
    username: "skladiste",
    password: testTenantPassword(),
    fullName: "Test Skladište",
    role: "warehouse",
  });
  const inspectorId = await ensureUser(s, fx.a.org, {
    username: "kontrolor",
    password: testTenantPassword(),
    fullName: "Test Kontrolor",
    role: "quality_inspector",
  });
  warehouse = await signIn("skladiste", fx.a.org.slug);
  inspector = await signIn("kontrolor", fx.a.org.slug);

  const employees = await s
    .from("employees")
    .insert([
      {
        organization_id: org,
        employee_number: 900101,
        first_name: `${MARK} Operater`,
        last_name: "Test",
        user_id: fx.a.operatorId,
      },
      {
        organization_id: org,
        employee_number: 900102,
        first_name: `${MARK} Drugi`,
        last_name: "Test",
      },
      {
        organization_id: org,
        employee_number: 900103,
        first_name: `${MARK} Kontrolor`,
        last_name: "Test",
        user_id: inspectorId,
      },
    ])
    .select("id, employee_number")
    .throwOnError();
  const employeeId = (n: number) => employees.data.find((e) => e.employee_number === n)!.id;
  ids.operatorEmployee = employeeId(900101);
  ids.otherEmployee = employeeId(900102);
  ids.inspectorEmployee = employeeId(900103);
  await s
    .from("employee_machines")
    .insert([
      { organization_id: org, employee_id: ids.operatorEmployee, machine_id: ids.saw },
      { organization_id: org, employee_id: ids.operatorEmployee, machine_id: ids.cnc1 },
      { organization_id: org, employee_id: ids.otherEmployee, machine_id: ids.cnc1 },
      { organization_id: org, employee_id: ids.otherEmployee, machine_id: ids.saw },
    ])
    .throwOnError();

  // Tenant B: a customer and product for isolation checks.
  const customerB = await s
    .from("customers")
    .insert({ organization_id: fx.b.org.id, name: `${MARK} Kupac B` })
    .select("id")
    .single()
    .throwOnError();
  ids.customerB = customerB.data.id;
  const productB = await fx.b.admin.rpc("create_product", {
    p_org_id: fx.b.org.id,
    p_product: { part_number: `${MARK}-B1`, name: "B", customer_id: ids.customerB, unit: "pcs" },
    p_revision: {},
  });
  expect(productB.error).toBeNull();
  ids.productB = productB.data!;
}

async function createOrder(
  client: Client = fx.a.admin,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await client.rpc("create_production_order", {
    p_org_id: fx.a.org.id,
    p_order: {
      customer_id: ids.customer,
      product_id: ids.product,
      quantity: "100",
      due_date: "2030-01-31",
      notes: `${MARK} order`,
      ...overrides,
    } as Json,
  });
  expect(error).toBeNull();
  return data!;
}

async function operations(orderId: string) {
  const { data } = await fx.service
    .from("production_order_operations")
    .select("id, sequence, operation_type_id, machine_id, setup_time_min, cycle_time_s, status")
    .eq("order_id", orderId)
    .is("archived_at", null)
    .order("sequence")
    .throwOnError();
  return data;
}

async function opOfType(orderId: string, typeId: string) {
  const op = (await operations(orderId)).find((o) => o.operation_type_id === typeId);
  expect(op).toBeDefined();
  return op!;
}

async function setStatus(client: Client, orderId: string, status: string, reason?: string) {
  return client.rpc("set_production_order_status", {
    p_order_id: orderId,
    p_status: status,
    ...(reason ? { p_reason: reason } : {}),
  });
}

async function assign(
  operationId: string,
  machineId: string | null,
  employeeIds: string[] = [],
  start: string | null = null,
  end: string | null = null,
) {
  return fx.a.admin.rpc("assign_order_operation", {
    p_operation_id: operationId,
    p_machine_id: machineId as string,
    p_employee_ids: employeeIds,
    p_planned_start: start as string,
    p_planned_end: end as string,
  });
}

/** "Ready for further processing" with the number of cut pieces (finishes cutting). */
async function cut(client: Client, orderId: string, quantity = "100") {
  return client.rpc("finish_cutting", {
    p_order_id: orderId,
    p_quantity: quantity as unknown as number,
    p_idempotency_key: crypto.randomUUID(),
  });
}

/** Order with the turning operation on CNC1, released ("planned"); cutting still open. */
async function plannedOrder(overrides: Record<string, unknown> = {}) {
  const id = await createOrder(fx.a.admin, overrides);
  const turning = await opOfType(id, ids.turnType);
  expect((await assign(turning.id, ids.cnc1)).error).toBeNull();
  expect((await setStatus(fx.a.admin, id, "planned")).error).toBeNull();
  return id;
}

/** Same, with the pieces cut: "ready". */
async function readyOrder(overrides: Record<string, unknown> = {}) {
  const id = await plannedOrder(overrides);
  expect((await cut(fx.a.admin, id)).error).toBeNull();
  return id;
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  await seed();
});

afterAll(async () => {
  if (fx) await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("order numbers", () => {
  it("formats the number from customer, ISO week, year and the yearly sequence", async () => {
    const id = await createOrder();
    const { data } = await fx.a.admin
      .from("production_orders")
      .select(
        "order_number, order_year, order_sequence, created_at, status, customer:customers!production_orders_organization_id_customer_id_fkey(customer_number)",
      )
      .eq("id", id)
      .single()
      .throwOnError();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sarajevo" }).format(
      new Date(data.created_at),
    );
    expect(data.status).toBe("draft");
    expect(data.order_year).toBe(Number(day.slice(0, 4)));
    expect(data.order_number).toBe(
      formatOrderNumber(
        "RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ}",
        3,
        data.customer!.customer_number,
        day,
        data.order_sequence,
      ),
    );
  });

  it("never hands out the same number, even for simultaneous orders", async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, () =>
        fx.a.admin.rpc("create_production_order", {
          p_org_id: fx.a.org.id,
          p_order: {
            customer_id: ids.customer,
            product_id: ids.product,
            quantity: "1",
            due_date: "2030-01-31",
            notes: `${MARK} parallel`,
          } as Json,
        }),
      ),
    );
    for (const result of created) expect(result.error).toBeNull();
    const { data } = await fx.service
      .from("production_orders")
      .select("order_number, order_sequence")
      .in(
        "id",
        created.map((r) => r.data!),
      )
      .throwOnError();
    expect(new Set(data.map((r) => r.order_number)).size).toBe(8);
    const sequences = data.map((r) => r.order_sequence).sort((a, b) => a - b);
    expect(sequences.at(-1)! - sequences[0]!).toBe(7);
  });

  it("ignores a number sent by the client", async () => {
    const { data, error } = await fx.a.admin
      .from("production_orders")
      .insert({
        organization_id: fx.a.org.id,
        customer_id: ids.customer,
        product_id: ids.product,
        revision_id: ids.revision,
        unit: "pcs",
        quantity: 5,
        due_date: "2030-01-31",
        notes: `${MARK} direct`,
        order_number: "FAKE-1",
        order_year: 2001,
        order_sequence: 1,
      })
      .select("order_number, order_year")
      .single();
    expect(error).toBeNull();
    expect(data?.order_number).not.toBe("FAKE-1");
    expect(data?.order_year).not.toBe(2001);
  });

  it("numbers customers automatically and never reuses an archived customer's number", async () => {
    const first = await fx.a.admin
      .from("customers")
      .insert({ organization_id: fx.a.org.id, name: `${MARK} Prvi` })
      .select("id, customer_number")
      .single()
      .throwOnError();
    await fx.a.admin
      .from("customers")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", first.data.id)
      .throwOnError();
    const second = await fx.a.admin
      .from("customers")
      .insert({ organization_id: fx.a.org.id, name: `${MARK} Drugi` })
      .select("id, customer_number")
      .single()
      .throwOnError();
    expect(second.data.customer_number).toBeGreaterThan(first.data.customer_number);

    // Taking it over by hand is possible (the app asks first) …
    const reused = await fx.a.admin
      .from("customers")
      .update({ customer_number: first.data.customer_number })
      .eq("id", second.data.id)
      .select("customer_number")
      .single();
    expect(reused.error).toBeNull();
    // … but two active customers never share a number.
    const clash = await fx.a.admin.from("customers").insert({
      organization_id: fx.a.org.id,
      name: `${MARK} Treći`,
      customer_number: first.data.customer_number,
    });
    expect(clash.error?.message).toContain("customers_number_key");
  });
});

describe("snapshot and planned time", () => {
  it("copies the routing and drawings; later product changes leave the order alone", async () => {
    const id = await createOrder();
    const before = await operations(id);
    expect(before.map((o) => o.operation_type_id)).toEqual([
      ids.cutType,
      ids.turnType,
      ids.inspectionType,
      ids.externalType,
    ]);
    expect(before[0]).toMatchObject({ machine_id: ids.saw, setup_time_min: 5, cycle_time_s: 10 });

    const drawings = await fx.a.admin
      .from("production_order_attachments")
      .select("attachment_id")
      .eq("order_id", id)
      .throwOnError();
    expect(drawings.data.map((d) => d.attachment_id)).toEqual([ids.drawing]);

    const productOps = await fx.service
      .from("product_operations")
      .select("id")
      .eq("revision_id", ids.revision)
      .eq("operation_type_id", ids.turnType)
      .single()
      .throwOnError();
    const changed = await fx.a.admin.rpc("save_product_operation", {
      p_revision_id: ids.revision,
      p_operation_id: productOps.data.id,
      p_operation: {
        operation_type_id: ids.turnType,
        machine_type_id: ids.cncTypeId,
        setup_time_min: "99",
        cycle_time_s: "999",
      } as Json,
    });
    expect(changed.error).toBeNull();
    expect(await operations(id)).toEqual(before);

    // Restore the routing for the other tests.
    await fx.a.admin.rpc("save_product_operation", {
      p_revision_id: ids.revision,
      p_operation_id: productOps.data.id,
      p_operation: {
        operation_type_id: ids.turnType,
        machine_type_id: ids.cncTypeId,
        setup_time_min: "30",
        cycle_time_s: "95",
      } as Json,
    });
  });

  it("plans setup + quantity × cycle per operation and sums them", async () => {
    const id = await createOrder(fx.a.admin, { quantity: "100" });
    const { data } = await fx.a.admin
      .from("production_order_operation_directory")
      .select("planned_seconds")
      .eq("order_id", id)
      .order("sequence")
      .throwOnError();
    // 5 min + 100 × 10 s; 30 min + 100 × 95 s; 0 + 100 × 30 s; external 0.
    expect(data.map((r) => r.planned_seconds)).toEqual([1300, 11300, 3000, 0]);
    const order = await fx.a.admin
      .from("production_order_directory")
      .select("planned_seconds, remaining_seconds, effective_priority, due_warning")
      .eq("id", id)
      .single()
      .throwOnError();
    expect(order.data).toEqual({
      planned_seconds: 15600,
      remaining_seconds: 15600,
      effective_priority: 3,
      due_warning: null,
    });
  });

  it("rejects decimal quantities for pieces", async () => {
    const { error } = await fx.a.admin.rpc("create_production_order", {
      p_org_id: fx.a.org.id,
      p_order: {
        customer_id: ids.customer,
        product_id: ids.product,
        quantity: "2.5",
        due_date: "2030-01-31",
        notes: `${MARK} decimal`,
      } as Json,
    });
    expect(error?.message).toContain("production_orders_whole_pieces_check");
  });

  it("flags overdue orders", async () => {
    const id = await createOrder(fx.a.admin, { due_date: "2020-01-01" });
    const { data } = await fx.a.admin
      .from("production_order_directory")
      .select("due_warning, days_to_due")
      .eq("id", id)
      .single()
      .throwOnError();
    expect(data.due_warning).toBe("overdue");
    expect(data.days_to_due).toBeLessThan(0);
  });
});

describe("order status rules", () => {
  it("allows the planned flow and rejects skipped steps", async () => {
    const id = await createOrder();
    expect((await setStatus(fx.a.admin, id, "in_progress")).error?.message).toBe(
      "invalid_status_transition",
    );
    expect((await setStatus(fx.a.admin, id, "planned")).error).toBeNull();
    // The turning operation has no machine yet.
    expect((await setStatus(fx.a.admin, id, "ready")).error?.message).toBe(
      "machine_assignment_missing",
    );
    const turning = await opOfType(id, ids.turnType);
    expect((await assign(turning.id, ids.cnc1)).error).toBeNull();
    // The cutting operation is open: "ready" needs the number of cut pieces.
    expect((await setStatus(fx.a.admin, id, "ready")).error?.message).toBe("cut_quantity_required");
    expect((await cut(fx.a.admin, id)).error).toBeNull();
    expect((await setStatus(fx.a.admin, id, "in_progress")).error).toBeNull();
    expect((await setStatus(fx.a.admin, id, "quality_check")).error).toBeNull();
    // Completion needs every operation done with enough good pieces.
    expect((await setStatus(fx.a.admin, id, "completed")).error?.message).toBe(
      "completion_requires_production_report",
    );

    const log = await fx.a.admin.rpc("production_order_status_log", { p_order_id: id });
    expect(log.error).toBeNull();
    expect(
      log.data!.filter((e) => !e.operation_id).map((e) => [e.from_status, e.to_status]),
    ).toEqual([
      ["in_progress", "quality_check"],
      ["ready", "in_progress"],
      ["planned", "ready"],
      ["draft", "planned"],
    ]);
    expect(log.data![0]?.username).toBe("admin");
  });

  it("needs a reason to cancel and closes the order afterwards", async () => {
    const id = await createOrder();
    expect((await setStatus(fx.a.admin, id, "cancelled")).error?.message).toBe(
      "cancel_reason_required",
    );
    expect((await setStatus(fx.a.admin, id, "cancelled", "Kupac odustao")).error).toBeNull();
    const { data } = await fx.a.admin
      .from("production_orders")
      .select("status, cancel_reason")
      .eq("id", id)
      .single()
      .throwOnError();
    expect(data).toEqual({ status: "cancelled", cancel_reason: "Kupac odustao" });

    const edit = await fx.a.admin
      .from("production_orders")
      .update({ notes: `${MARK} late` })
      .eq("id", id);
    expect(edit.error?.message).toBe("order_closed");
    expect((await setStatus(fx.a.admin, id, "draft")).error?.message).toBe(
      "invalid_status_transition",
    );
    expect((await setStatus(fx.a.admin, id, "archived")).error).toBeNull();
    const archived = await fx.a.admin
      .from("production_orders")
      .select("archived_at")
      .eq("id", id)
      .single()
      .throwOnError();
    expect(archived.data.archived_at).not.toBeNull();
  });

  it("freezes quantity once material is prepared, but not the due date", async () => {
    const id = await createOrder();
    expect((await setStatus(fx.a.admin, id, "planned")).error).toBeNull();
    expect((await setStatus(fx.a.admin, id, "waiting_material")).error).toBeNull();
    const quantity = await fx.a.admin
      .from("production_orders")
      .update({ quantity: 50 })
      .eq("id", id);
    expect(quantity.error?.message).toBe("order_in_production");
    const due = await fx.a.admin
      .from("production_orders")
      .update({ due_date: "2030-02-28" })
      .eq("id", id);
    expect(due.error).toBeNull();
  });

  it("lets the warehouse set only material statuses", async () => {
    const id = await createOrder();
    expect((await setStatus(warehouse, id, "planned")).error?.code).toBe("42501");
    expect((await setStatus(fx.a.admin, id, "planned")).error).toBeNull();
    expect((await setStatus(warehouse, id, "waiting_material")).error).toBeNull();
    expect((await setStatus(warehouse, id, "cutting")).error).toBeNull();
    expect((await setStatus(warehouse, id, "cancelled", "nope")).error?.code).toBe("42501");
    const turning = await opOfType(id, ids.turnType);
    expect((await assign(turning.id, ids.cnc1)).error).toBeNull();
    expect((await setStatus(warehouse, id, "ready")).error?.message).toBe("cut_quantity_required");
    expect((await cut(warehouse, id, "98")).error).toBeNull();
    expect((await setStatus(warehouse, id, "in_progress")).error?.code).toBe("42501");
    // The warehouse reads orders but cannot edit them.
    const edit = await warehouse
      .from("production_orders")
      .update({ notes: "x" })
      .eq("id", id)
      .select("id");
    expect(edit.data ?? []).toEqual([]);
  });

  it("lets the cutting worker set material statuses, but no one else on the floor", async () => {
    const id = await createOrder();
    expect((await setStatus(fx.a.admin, id, "planned")).error).toBeNull();
    // Operator is qualified for the saw: the cutting operation is theirs.
    expect((await setStatus(fx.a.operator, id, "cutting")).error).toBeNull();
    expect((await setStatus(fx.a.operator, id, "in_progress")).error?.message).toBe(
      "invalid_status_transition",
    );

    // Assigned to another worker by name: the operator no longer sees it.
    const cutting = await opOfType(id, ids.cutType);
    expect((await assign(cutting.id, ids.saw, [ids.otherEmployee])).error).toBeNull();
    expect((await setStatus(fx.a.operator, id, "waiting_material")).error?.code).toBe("42501");
  });
});

describe("assignments", () => {
  it("allows only workers qualified for the machine", async () => {
    const id = await createOrder();
    const turning = await opOfType(id, ids.turnType);
    expect((await assign(turning.id, ids.cnc2, [ids.operatorEmployee])).error?.message).toBe(
      "worker_not_qualified",
    );
    expect((await assign(turning.id, ids.cnc1, [ids.operatorEmployee])).error).toBeNull();
    // Moving the operation to a machine the worker cannot run is refused too.
    expect((await assign(turning.id, ids.cnc2, [ids.operatorEmployee])).error?.message).toBe(
      "worker_not_qualified",
    );
    expect((await assign(turning.id, null, [ids.operatorEmployee])).error?.message).toBe(
      "worker_needs_machine",
    );
  });

  it("assigns inspections only to inspectors and external operations to no one", async () => {
    const id = await createOrder();
    const inspection = await opOfType(id, ids.inspectionType);
    expect((await assign(inspection.id, null, [ids.operatorEmployee])).error?.message).toBe(
      "worker_not_inspector",
    );
    expect((await assign(inspection.id, null, [ids.inspectorEmployee])).error).toBeNull();
    const external = await opOfType(id, ids.externalType);
    expect((await assign(external.id, null, [ids.inspectorEmployee])).error?.message).toBe(
      "worker_external",
    );
  });

  it("warns about another machine type and overlapping work (without blocking)", async () => {
    const first = await createOrder(fx.a.admin, {
      planned_start: "2029-03-01",
      planned_end: "2029-03-05",
    });
    const second = await createOrder(fx.a.admin, {
      planned_start: "2029-03-04",
      planned_end: "2029-03-10",
    });
    const firstTurning = await opOfType(first, ids.turnType);
    const secondTurning = await opOfType(second, ids.turnType);

    const mismatch = await assign(firstTurning.id, ids.cnc2);
    expect(mismatch.error).toBeNull();
    expect(mismatch.data).toMatchObject({ machine_type_mismatch: true, overlaps: [] });
    expect((await setStatus(fx.a.admin, first, "planned")).error).toBeNull();

    const overlapping = await assign(secondTurning.id, ids.cnc2);
    expect(overlapping.error).toBeNull();
    expect(overlapping.data).toMatchObject({
      machine_type_mismatch: true,
      overlaps: [{ order_id: first }],
    });

    // Own planned times outside the other period: no overlap.
    const apart = await assign(
      secondTurning.id,
      ids.cnc2,
      [],
      "2029-03-08T06:00:00Z",
      "2029-03-08T14:00:00Z",
    );
    expect(apart.data).toMatchObject({ overlaps: [] });
  });
});

describe("shop floor visibility", () => {
  it("shows the operator the open operations of their machines, not drafts", async () => {
    const draft = await createOrder();
    const released = await plannedOrder();
    const queue = await fx.a.operator.rpc("floor_operation_queue", {
      p_org_id: fx.a.org.id,
      p_machine_id: ids.saw,
    });
    expect(queue.error).toBeNull();
    const orderIds = queue.data!.map((row) => row.order_id);
    expect(orderIds).toContain(released);
    expect(orderIds).not.toContain(draft);

    // Not qualified for CNC2: nothing from there.
    const other = await fx.a.operator.rpc("floor_operation_queue", {
      p_org_id: fx.a.org.id,
      p_machine_id: ids.cnc2,
    });
    expect(other.data).toEqual([]);
  });

  it("marks operations as arrived once every earlier one is done", async () => {
    const id = await createOrder();
    const cutting = await opOfType(id, ids.cutType);
    const turning = await opOfType(id, ids.turnType);
    expect((await assign(turning.id, ids.cnc1)).error).toBeNull();
    expect((await setStatus(fx.a.admin, id, "planned")).error).toBeNull();
    const queue = async (machine: string) =>
      (
        await fx.a.operator.rpc("floor_operation_queue", {
          p_org_id: fx.a.org.id,
          p_machine_id: machine,
        })
      ).data!.find((row) => row.order_id === id);
    expect((await queue(ids.saw))?.arrived).toBe(true);
    expect((await queue(ids.cnc1))?.arrived).toBe(false);

    for (const status of ["ready", "in_progress", "done"]) {
      const { error } = await fx.a.admin.rpc("set_order_operation_status", {
        p_operation_id: cutting.id,
        p_status: status,
      });
      expect(error).toBeNull();
    }
    // Done by hand without a report: the pieces pass through.
    expect((await queue(ids.cnc1))?.arrived).toBe(true);
    expect((await queue(ids.cnc1))?.input_quantity).toBe(100);
    expect((await queue(ids.cnc1))?.operation_id).toBe(turning.id);
  });

  it("shows the operator an order (QR) with their operations marked", async () => {
    const draft = await createOrder();
    expect((await fx.a.operator.rpc("floor_order", { p_order_id: draft })).data).toBeNull();

    const id = await plannedOrder();
    const { data, error } = await fx.a.operator.rpc("floor_order", { p_order_id: id });
    expect(error).toBeNull();
    const operations = (data as { operations: { code: string; mine: boolean; arrived: boolean }[] })
      .operations;
    expect(operations.map((op) => [op.code.replace(MARK, ""), op.mine, op.arrived])).toEqual([
      ["RZ", true, true],
      ["TO", true, false],
      ["KT", false, false],
      ["CI", false, false],
    ]);
    expect((await fx.b.admin.rpc("floor_order", { p_order_id: id })).data).toBeNull();
  });

  it("hides operations assigned to someone else by name", async () => {
    const id = await plannedOrder();
    const turning = await opOfType(id, ids.turnType);
    expect((await assign(turning.id, ids.cnc1, [ids.otherEmployee])).error).toBeNull();

    const queue = await fx.a.operator.rpc("floor_operation_queue", {
      p_org_id: fx.a.org.id,
      p_machine_id: ids.cnc1,
    });
    expect(queue.data!.map((row) => row.operation_id)).not.toContain(turning.id);

    const hidden = await fx.a.operator.rpc("floor_operation", { p_operation_id: turning.id });
    expect(hidden.data).toMatchObject({ visible: false, current: { code: `${MARK}RZ` } });

    // Assigned to the operator by name: in "assigned to me" and fully visible.
    expect((await assign(turning.id, ids.cnc1, [ids.operatorEmployee])).error).toBeNull();
    const mine = await fx.a.operator.rpc("floor_operation_queue", { p_org_id: fx.a.org.id });
    expect(mine.data!.map((row) => row.operation_id)).toContain(turning.id);
    const visible = await fx.a.operator.rpc("floor_operation", { p_operation_id: turning.id });
    expect(visible.data).toMatchObject({ visible: true, operation: { code: `${MARK}TO` } });
  });

  it("opens drawings only through visible operations", async () => {
    await readyOrder();
    const path = await fx.a.operator.rpc("order_file_path", { p_attachment_id: ids.drawing });
    expect(path.data).toContain(ids.product);

    // A drawing added to the product later is on no order yet.
    const later = await fx.service
      .from("product_attachments")
      .insert({
        organization_id: fx.a.org.id,
        revision_id: ids.revision,
        kind: "image",
        file_name: "slika.png",
        storage_path: `${fx.a.org.id}/${ids.product}/00000000-0000-4000-8000-000000000002.png`,
        content_type: "image/png",
        size_bytes: 100,
      })
      .select("id")
      .single()
      .throwOnError();
    expect(
      (await fx.a.operator.rpc("order_file_path", { p_attachment_id: later.data.id })).data,
    ).toBeNull();
    expect(
      (await fx.a.admin.rpc("order_file_path", { p_attachment_id: later.data.id })).data,
    ).toContain(ids.product);
    expect(
      (await fx.b.admin.rpc("order_file_path", { p_attachment_id: ids.drawing })).data,
    ).toBeNull();
  });

  it("gives operators no direct access to order tables", async () => {
    await readyOrder();
    for (const table of [
      "production_orders",
      "production_order_operations",
      "production_order_directory",
      "production_order_status_history",
    ] as const) {
      const { data } = await untyped(fx.a.operator).from(table).select("id");
      expect(data).toEqual([]);
    }
  });

  it("lets inspectors read orders", async () => {
    const id = await createOrder();
    const { data } = await inspector.from("production_order_directory").select("id").eq("id", id);
    expect(data).toEqual([{ id }]);
  });
});

describe("tenant isolation", () => {
  it.each([
    "production_orders",
    "production_order_operations",
    "production_order_operation_workers",
    "production_order_attachments",
    "production_order_status_history",
    "production_order_directory",
    "production_order_operation_directory",
  ])("admin B sees no tenant A rows in %s", async (table) => {
    await createOrder();
    const { data, error } = await untyped(fx.b.admin).from(table).select("organization_id");
    expect(error).toBeNull();
    expect(
      (data ?? []).filter(
        (row: { organization_id: string }) => row.organization_id === fx.a.org.id,
      ),
    ).toEqual([]);
  });

  it("admin B cannot create, change or assign orders of tenant A", async () => {
    const id = await createOrder();
    const created = await fx.b.admin.rpc("create_production_order", {
      p_org_id: fx.a.org.id,
      p_order: {
        customer_id: ids.customer,
        product_id: ids.product,
        quantity: "1",
        due_date: "2030-01-31",
        notes: `${MARK} intruder`,
      } as Json,
    });
    expect(created.error?.code).toBe("42501");
    expect((await setStatus(fx.b.admin, id, "planned")).error?.code).toBe("P0002");
    const turning = await opOfType(id, ids.turnType);
    const assigned = await fx.b.admin.rpc("assign_order_operation", {
      p_operation_id: turning.id,
      p_machine_id: ids.cnc1,
      p_employee_ids: [],
      p_planned_start: null as unknown as string,
      p_planned_end: null as unknown as string,
    });
    expect(assigned.error?.code).toBe("P0002");
    expect(
      (await fx.b.admin.rpc("floor_operation", { p_operation_id: turning.id })).data,
    ).toBeNull();
  });

  it("cannot attach a tenant B product to a tenant A order", async () => {
    const { error } = await fx.a.admin.rpc("create_production_order", {
      p_org_id: fx.a.org.id,
      p_order: {
        customer_id: ids.customer,
        product_id: ids.productB,
        quantity: "1",
        due_date: "2030-01-31",
        notes: `${MARK} cross`,
      } as Json,
    });
    expect(error?.code).toBe("P0002");
  });
});
