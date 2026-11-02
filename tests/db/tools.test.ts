import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/types";
import { setupFixture, type Fixture } from "./fixtures";

// Inventory part E (D-035): tools. Pieces per location (warehouse, machine),
// issue / return / scrap never below zero; inserts with cutting edges: a tool
// change takes a new insert from the machine or turns the current one to its
// next edge, refused when all edges are used. Rows use the DBX prefix.

const MARK = "DBX";
type Db = SupabaseClient<Database>;

let fx: Fixture;
const ids = {
  warehouse: "",
  machine: "",
  insert: "",
  holder: "",
  operation: "",
  reason: "",
  customer: "",
  product: "",
};

async function cleanup(service: Db, orgIds: string[]) {
  const tools = await service
    .from("tools")
    .select("id")
    .in("organization_id", orgIds)
    .like("code", `${MARK}%`);
  const toolIds = (tools.data ?? []).map((t) => t.id);
  if (toolIds.length > 0) {
    await service.from("tool_movements").delete().in("tool_id", toolIds);
    await service.from("machine_inserts").delete().in("tool_id", toolIds);
  }
  const orders = await service
    .from("production_orders")
    .select("id")
    .in("organization_id", orgIds)
    .like("notes", `${MARK}%`);
  const orderIds = (orders.data ?? []).map((o) => o.id);
  if (orderIds.length > 0) {
    await service.from("production_tool_changes").delete().in("order_id", orderIds);
    await service.from("production_work_sessions").delete().in("order_id", orderIds);
    await service.from("production_order_status_history").delete().in("order_id", orderIds);
    await service.from("production_order_attachments").delete().in("order_id", orderIds);
    await service.from("production_order_operations").delete().in("order_id", orderIds);
    await service.from("production_orders").delete().in("id", orderIds);
  }
  if (toolIds.length > 0) await service.from("tools").delete().in("id", toolIds);
  const products = await service
    .from("products")
    .select("id")
    .in("organization_id", orgIds)
    .like("part_number", `${MARK}-%`);
  const productIds = (products.data ?? []).map((p) => p.id);
  if (productIds.length > 0) {
    const revisions = await service
      .from("product_revisions")
      .select("id")
      .in("product_id", productIds);
    const revisionIds = (revisions.data ?? []).map((r) => r.id);
    if (revisionIds.length > 0) {
      await service.from("product_operations").delete().in("revision_id", revisionIds);
      await service.from("product_revisions").delete().in("id", revisionIds);
    }
    await service.from("products").delete().in("id", productIds);
  }
  const machines = await service
    .from("machines")
    .select("id")
    .in("organization_id", orgIds)
    .like("code", `${MARK}-%`);
  const machineIds = (machines.data ?? []).map((m) => m.id);
  if (machineIds.length > 0) {
    await service.from("stock_locations").delete().in("machine_id", machineIds);
    await service.from("machines").delete().in("id", machineIds);
  }
  await service
    .from("stock_locations")
    .delete()
    .in("organization_id", orgIds)
    .like("code", `${MARK}%`);
  await service
    .from("operation_types")
    .delete()
    .in("organization_id", orgIds)
    .like("code", `${MARK}%`);
  await service.from("customers").delete().in("organization_id", orgIds).like("name", `${MARK}%`);
}

const one = <T>(result: { data: T; error: unknown }): NonNullable<T> => {
  if (result.error) throw result.error;
  if (result.data === null || result.data === undefined) throw new Error("no data");
  return result.data;
};

function move(
  kind: string,
  tool: string,
  quantity: number,
  extra: Record<string, string> = {},
  client: Db = fx.a.admin,
) {
  return client.rpc("move_tool", {
    p_org_id: fx.a.org.id,
    p_idempotency_key: randomUUID(),
    p_kind: kind,
    p_tool_id: tool,
    p_quantity: quantity,
    ...extra,
  });
}

function change(tool: string, action: string | null) {
  return fx.a.admin.rpc("record_tool_change_with_tool", {
    p_operation_id: ids.operation,
    p_tool_id: tool,
    p_insert_action: action as string,
    p_reason_id: ids.reason,
    p_minutes: 2,
    p_notes: "",
    p_idempotency_key: randomUUID(),
  });
}

async function stock(tool: string) {
  const { data } = await fx.a.admin
    .from("tool_balances")
    .select("location_id, quantity, location:stock_locations(machine_id)")
    .eq("tool_id", tool)
    .throwOnError();
  return {
    warehouse: data.find((r) => r.location_id === ids.warehouse)?.quantity ?? 0,
    machine: data.find((r) => r.location?.machine_id === ids.machine)?.quantity ?? 0,
  };
}

async function edges() {
  const { data } = await fx.a.admin
    .from("machine_inserts")
    .select("edges_used")
    .eq("machine_id", ids.machine)
    .eq("tool_id", ids.insert)
    .maybeSingle()
    .throwOnError();
  return data?.edges_used ?? null;
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  const org = fx.a.org.id;
  const s = fx.service;
  ids.warehouse = one(
    await s
      .from("stock_locations")
      .insert({ organization_id: org, kind: "warehouse", code: `${MARK}A`, name: "DBX Alatnica" })
      .select("id")
      .single(),
  ).id;
  ids.machine = one(
    await s
      .from("machines")
      .insert({ organization_id: org, code: `${MARK}-CNC`, name: "DBX CNC" })
      .select("id")
      .single(),
  ).id;
  ids.insert = one(
    await s
      .from("tools")
      .insert({
        organization_id: org,
        code: `${MARK}-VBMT`,
        name: "Pločica VBMT 160404",
        kind: "insert",
        cutting_edges: 3,
      })
      .select("id")
      .single(),
  ).id;
  ids.holder = one(
    await s
      .from("tools")
      .insert({
        organization_id: org,
        code: `${MARK}-DRZ`,
        name: "Držač SVJBR",
        kind: "tool",
        home_machine_id: ids.machine,
      })
      .select("id")
      .single(),
  ).id;
  ids.reason = one(
    await s
      .from("catalog_items")
      .select("id")
      .eq("organization_id", org)
      .eq("kind", "tool_change_reason")
      .is("archived_at", null)
      .limit(1)
      .single(),
  ).id;
  ids.customer = one(
    await s
      .from("customers")
      .insert({ organization_id: org, name: `${MARK} Kupac` })
      .select("id")
      .single(),
  ).id;
  const type = one(
    await s
      .from("operation_types")
      .insert({ organization_id: org, code: `${MARK}TO`, name: `${MARK} Tokarenje` })
      .select("id")
      .single(),
  ).id;
  ids.product = one(
    await fx.a.admin.rpc("create_product", {
      p_org_id: org,
      p_product: {
        part_number: `${MARK}-1`,
        name: "Osovina",
        customer_id: ids.customer,
        unit: "pcs",
      },
      p_revision: { revision: "A" },
    }),
  );
  const revision = one(
    await s.from("product_revisions").select("id").eq("product_id", ids.product).single(),
  );
  expect(
    (
      await fx.a.admin.rpc("save_product_operation", {
        p_revision_id: revision.id,
        p_operation_id: null as unknown as string,
        p_operation: {
          operation_type_id: type,
          machine_id: ids.machine,
          cycle_time_s: "60",
        } as Json,
      })
    ).error,
  ).toBeNull();
  const orderId = one(
    await fx.a.admin.rpc("create_production_order", {
      p_org_id: org,
      p_order: {
        customer_id: ids.customer,
        product_id: ids.product,
        quantity: "5",
        due_date: "2030-06-30",
        notes: `${MARK} order`,
      } as Json,
    }),
  );
  await fx.a.admin.rpc("set_production_order_status", { p_order_id: orderId, p_status: "planned" });
  ids.operation = one(
    await s.from("production_order_operations").select("id").eq("order_id", orderId).single(),
  ).id;
}, 120_000);

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("tool stock", () => {
  it("receives, issues to a machine (its location is created), never below zero", async () => {
    expect((await move("receipt", ids.insert, 10, { p_to: ids.warehouse })).error).toBeNull();
    expect(
      (await move("issue", ids.insert, 4, { p_from: ids.warehouse, p_machine_id: ids.machine }))
        .error,
    ).toBeNull();
    expect(await stock(ids.insert)).toEqual({ warehouse: 6, machine: 4 });
    expect(
      (await move("issue", ids.insert, 7, { p_from: ids.warehouse, p_machine_id: ids.machine }))
        .error?.message,
    ).toBe("negative_stock");
    expect((await move("scrap", ids.insert, 1, { p_from: ids.warehouse })).error?.message).toBe(
      "reason_required",
    );
    expect(
      (await move("scrap", ids.insert, 1, { p_from: ids.warehouse, p_reason: "Lom" })).error,
    ).toBeNull();
    expect(await stock(ids.insert)).toEqual({ warehouse: 5, machine: 4 });
  });

  it("operators and other tenants cannot move or read tools", async () => {
    expect(
      (await move("receipt", ids.insert, 1, { p_to: ids.warehouse }, fx.a.operator)).error?.code,
    ).toBe("42501");
    const { data } = await fx.b.admin.from("tool_movements").select("id").eq("tool_id", ids.insert);
    expect(data).toEqual([]);
  });
});

describe("tool change with inserts", () => {
  it("a new insert leaves the machine, the next edge turns it until all edges are used", async () => {
    expect((await change(ids.insert, "next_edge")).error?.message).toBe("no_insert_in_use");
    expect((await change(ids.insert, null)).error?.message).toBe("insert_action_required");

    expect((await change(ids.insert, "new")).error).toBeNull();
    expect(await edges()).toBe(1);
    expect((await stock(ids.insert)).machine).toBe(3);
    expect((await change(ids.insert, "next_edge")).error).toBeNull();
    expect((await change(ids.insert, "next_edge")).error).toBeNull();
    expect(await edges()).toBe(3);
    expect((await change(ids.insert, "next_edge")).error?.message).toBe("no_edges_left");
    // Turning an insert takes nothing from stock.
    expect((await stock(ids.insert)).machine).toBe(3);

    const fresh = await change(ids.insert, "new");
    expect(fresh.error).toBeNull();
    expect(await edges()).toBe(1);
    expect((await stock(ids.insert)).machine).toBe(2);
    const { data } = await fx.a.admin
      .from("production_tool_changes")
      .select("tool, tool_id, insert_action, edge_no")
      .eq("id", fresh.data ?? "")
      .single()
      .throwOnError();
    expect(data).toMatchObject({ tool_id: ids.insert, insert_action: "new", edge_no: 1 });
    expect(data.tool).toContain("VBMT");
  });

  it("other tools are recorded without an insert action and without stock", async () => {
    expect((await change(ids.holder, "new")).error?.message).toBe("insert_action_required");
    expect((await change(ids.holder, null)).error).toBeNull();
  });
});
