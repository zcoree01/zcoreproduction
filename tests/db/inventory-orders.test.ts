import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decimalFromDb } from "@/lib/decimal";
import type { Database, Json } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Inventory part B (D-032): material of production orders. Requirement with
// kerf and bars, reservation on release and its release, coverage, issue with
// the offcut back into stock, no negative stock, customer material only for
// that customer, returns, consumption proposal from (good + scrap), "Treba
// rezanje", the operator's view and access. Rows use the DBO prefix.

const MARK = "DBO";

type Db = SupabaseClient<Database>;

let fx: Fixture;
let warehouse: Db;
const ids = {
  material: "",
  customer: "",
  otherCustomer: "",
  location: "",
  item: "",
  product: "",
  revision: "",
  cutType: "",
  turnType: "",
};

async function cleanup(service: Db, orgIds: string[]) {
  const orders = await service
    .from("production_orders")
    .select("id")
    .in("organization_id", orgIds)
    .like("notes", `${MARK}%`);
  const orderIds = (orders.data ?? []).map((row) => row.id);
  const items = await service
    .from("stock_items")
    .select("id")
    .in("organization_id", orgIds)
    .like("code", `${MARK}-%`);
  const itemIds = (items.data ?? []).map((row) => row.id);

  if (itemIds.length > 0) {
    const docs = await service.from("stock_movements").select("document_id").in("item_id", itemIds);
    const docIds = [...new Set((docs.data ?? []).map((row) => row.document_id))];
    await service.from("stock_movements").delete().in("item_id", itemIds);
    if (docIds.length > 0) await service.from("stock_documents").delete().in("id", docIds);
    await service.from("stock_order_consumption").delete().in("item_id", itemIds);
    await service.from("stock_reservations").delete().in("item_id", itemIds);
    await service.from("stock_lots").delete().in("item_id", itemIds);
  }
  if (orderIds.length > 0) {
    await service.from("production_reports").delete().in("order_id", orderIds);
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
  if (itemIds.length > 0) await service.from("stock_items").delete().in("id", itemIds);
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
  await service
    .from("materials")
    .delete()
    .in("organization_id", orgIds)
    .like("designation", `${MARK}%`);
  await service
    .from("material_groups")
    .delete()
    .in("organization_id", orgIds)
    .like("name", `${MARK}%`);
  await service.from("customers").delete().in("organization_id", orgIds).like("name", `${MARK}%`);
}

const one = <T>(result: { data: T; error: unknown }): NonNullable<T> => {
  if (result.error) throw result.error;
  if (result.data === null || result.data === undefined) throw new Error("no data");
  return result.data;
};

async function createOrder(
  quantity: number,
  options: { customer?: string; release?: boolean; needsCutting?: boolean } = {},
) {
  const order: Record<string, Json> = {
    customer_id: options.customer ?? ids.customer,
    product_id: ids.product,
    quantity: String(quantity),
    due_date: "2030-06-30",
    notes: `${MARK} order`,
  };
  if (options.needsCutting !== undefined) order.needs_cutting = options.needsCutting;
  const id = one(
    await fx.a.admin.rpc("create_production_order", { p_org_id: fx.a.org.id, p_order: order }),
  );
  if (options.release !== false) {
    const status = await fx.a.admin.rpc("set_production_order_status", {
      p_order_id: id,
      p_status: "planned",
    });
    expect(status.error).toBeNull();
  }
  return id;
}

async function receive(pieces: number, owner: string | null = null) {
  const result = await warehouse.rpc("post_stock_receipt", {
    p_org_id: fx.a.org.id,
    p_idempotency_key: randomUUID(),
    p_header: { supplier: "DBO" },
    p_lines: [
      {
        item_id: ids.item,
        location_id: ids.location,
        pieces,
        length_mm: 3000,
        owner_customer_id: owner,
        unit_price: owner ? null : 2,
        price_unit: owner ? null : "kg",
      },
    ],
  });
  expect(result.error).toBeNull();
  const lot = await fx.service
    .from("stock_movements")
    .select("lot_id")
    .eq("document_id", result.data ?? "")
    .single()
    .throwOnError();
  return lot.data.lot_id;
}

function issue(orderId: string, line: Record<string, Json>, client: Db = warehouse) {
  return client.rpc("post_stock_issue", {
    p_org_id: fx.a.org.id,
    p_idempotency_key: randomUUID(),
    p_order_id: orderId,
    p_lines: [
      { item_id: ids.item, location_id: ids.location, length_mm: 3000, pieces: 1, ...line },
    ],
  });
}

async function reservation(orderId: string) {
  const { data } = await fx.service
    .from("stock_reservations")
    .select("quantity, released_at, release_reason")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .throwOnError();
  return data;
}

async function coverage(orderId: string) {
  const { data } = await warehouse
    .from("stock_order_coverage")
    .select("quantity, issued, remaining, shortage")
    .eq("order_id", orderId)
    .maybeSingle()
    .throwOnError();
  return {
    quantity: decimalFromDb(data?.quantity),
    issued: decimalFromDb(data?.issued),
    remaining: decimalFromDb(data?.remaining),
    shortage: decimalFromDb(data?.shortage),
  };
}

async function buckets() {
  const { data } = await warehouse
    .from("stock_balances")
    .select("lot_id, length_mm, pieces")
    .eq("item_id", ids.item)
    .throwOnError();
  return data.map((row) => [row.lot_id, decimalFromDb(row.length_mm), row.pieces]);
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  await ensureUser(fx.service, fx.a.org, {
    username: "magacioner",
    password: testTenantPassword(),
    fullName: "Test Magacioner",
    role: "warehouse",
  });
  warehouse = await signIn("magacioner", fx.a.org.slug);
  const org = fx.a.org.id;
  const s = fx.service;

  const group = one(
    await s
      .from("material_groups")
      .insert({ organization_id: org, name: `${MARK} Čelik`, density_kg_dm3: 7.85 })
      .select("id")
      .single(),
  );
  ids.material = one(
    await s
      .from("materials")
      .insert({ organization_id: org, group_id: group.id, designation: `${MARK} C45` })
      .select("id")
      .single(),
  ).id;
  const customers = one(
    await s
      .from("customers")
      .insert([
        { organization_id: org, name: `${MARK} Kupac` },
        { organization_id: org, name: `${MARK} Drugi kupac` },
      ])
      .select("id, name"),
  );
  ids.customer = customers.find((c) => c.name === `${MARK} Kupac`)!.id;
  ids.otherCustomer = customers.find((c) => c.name === `${MARK} Drugi kupac`)!.id;
  ids.location = one(
    await s
      .from("stock_locations")
      .insert({ organization_id: org, kind: "warehouse", code: `${MARK}M`, name: "DBO Magacin" })
      .select("id")
      .single(),
  ).id;
  ids.item = one(
    await s
      .from("stock_items")
      .insert({
        organization_id: org,
        code: `${MARK}-C45-50`,
        name: "DBO C45 Ø50",
        material_id: ids.material,
        shape: "round_bar",
        diameter_mm: 50,
        base_unit: "mm",
        standard_length_mm: 3000,
      })
      .select("id")
      .single(),
  ).id;

  const types = one(
    await s
      .from("operation_types")
      .insert([
        { organization_id: org, code: `${MARK}RZ`, name: `${MARK} Rezanje`, is_cutting: true },
        { organization_id: org, code: `${MARK}TO`, name: `${MARK} Tokarenje`, is_cutting: false },
      ])
      .select("id, code"),
  );
  ids.cutType = types.find((t) => t.code === `${MARK}RZ`)!.id;
  ids.turnType = types.find((t) => t.code === `${MARK}TO`)!.id;

  ids.product = one(
    await fx.a.admin.rpc("create_product", {
      p_org_id: org,
      p_product: {
        part_number: `${MARK}-1`,
        name: "Osovina",
        customer_id: ids.customer,
        unit: "pcs",
      },
      p_revision: {
        revision: "A",
        material_id: ids.material,
        blank_geometry: "round",
        blank_diameter_mm: "50",
        cut_length_mm: "100",
        kerf_mm: "2",
      },
    }),
  );
  ids.revision = one(
    await s.from("product_revisions").select("id").eq("product_id", ids.product).single(),
  ).id;
  const saved = await fx.a.admin.rpc("save_product_operation", {
    p_revision_id: ids.revision,
    p_operation_id: null as unknown as string,
    p_operation: { operation_type_id: ids.turnType, cycle_time_s: "60" } as Json,
  });
  expect(saved.error).toBeNull();
  const linked = await fx.a.admin
    .from("product_revisions")
    .update({ stock_item_id: ids.item })
    .eq("id", ids.revision);
  expect(linked.error).toBeNull();
}, 120_000);

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("requirement and reservation", () => {
  it("takes the stock item from the revision and reserves the full requirement on release", async () => {
    const orderId = await createOrder(50, { release: false });
    const { data: order } = await fx.a.admin
      .from("production_orders")
      .select("stock_item_id")
      .eq("id", orderId)
      .single();
    expect(order?.stock_item_id).toBe(ids.item);
    // Draft: nothing reserved.
    expect(await reservation(orderId)).toBeNull();

    await fx.a.admin.rpc("set_production_order_status", {
      p_order_id: orderId,
      p_status: "planned",
    });
    // 50 × (100 + 2) mm
    expect(decimalFromDb((await reservation(orderId))?.quantity)).toBe("5100");

    const plan = one(
      await fx.a.admin.rpc("order_material_plan", { p_order_id: orderId }),
    ) as Record<string, unknown>;
    expect(plan).toMatchObject({ per_piece: 102, pieces_per_unit: 29, units_needed: 2 });

    // No stock yet: everything is short.
    expect(await coverage(orderId)).toMatchObject({ remaining: "5100", shortage: "5100" });

    const cancelled = await fx.a.admin.rpc("set_production_order_status", {
      p_order_id: orderId,
      p_status: "cancelled",
      p_reason: "DBO test",
    });
    expect(cancelled.error).toBeNull();
    expect(await reservation(orderId)).toMatchObject({ release_reason: "cancelled" });
  });

  it("follows quantity changes of a planned order", async () => {
    const orderId = await createOrder(10);
    expect(decimalFromDb((await reservation(orderId))?.quantity)).toBe("1020");
    const changed = await fx.a.admin
      .from("production_orders")
      .update({ quantity: 20 })
      .eq("id", orderId);
    expect(changed.error).toBeNull();
    expect(decimalFromDb((await reservation(orderId))?.quantity)).toBe("2040");
  });
});

describe("issue and return", () => {
  let orderId: string;
  let lotId: string;

  beforeAll(async () => {
    orderId = await createOrder(40);
    lotId = await receive(2);
  });

  it("refuses draft orders and negative stock", async () => {
    const draft = await createOrder(5, { release: false });
    expect((await issue(draft, { lot_id: lotId })).error?.message).toBe("order_not_open");
    expect((await issue(orderId, { lot_id: lotId, pieces: 5 })).error?.message).toBe(
      "negative_stock",
    );
  });

  it("issues a bar cut in the warehouse and puts its offcut back as its own piece", async () => {
    // 29 × 102 mm = 2958 mm; the 42 mm offcut stays in stock (own material).
    const result = await issue(orderId, { lot_id: lotId, cut_pieces: 29, offcut_length_mm: 42 });
    expect(result.error).toBeNull();
    expect((await buckets()).filter(([lot]) => lot === lotId).sort()).toEqual(
      [
        [lotId, "3000", 1],
        [lotId, "42", 1],
      ].sort(),
    );
    // 40 × 102 = 4080 reserved, 2958 issued.
    expect(await coverage(orderId)).toMatchObject({
      quantity: "4080",
      issued: "2958",
      remaining: "1122",
    });
  });

  it("returns material of a lot issued to the order, not of another lot", async () => {
    const returned = await warehouse.rpc("post_stock_return", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: randomUUID(),
      p_order_id: orderId,
      p_lines: [
        { item_id: ids.item, lot_id: lotId, location_id: ids.location, pieces: 1, length_mm: 500 },
      ],
    });
    expect(returned.error).toBeNull();
    expect((await buckets()).some(([lot, length]) => lot === lotId && length === "500")).toBe(true);

    const otherLot = await receive(1);
    const wrong = await warehouse.rpc("post_stock_return", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: randomUUID(),
      p_order_id: orderId,
      p_lines: [
        {
          item_id: ids.item,
          lot_id: otherLot,
          location_id: ids.location,
          pieces: 1,
          length_mm: 500,
        },
      ],
    });
    expect(wrong.error?.message).toBe("lot_not_issued");
  });

  it("customer material goes only to that customer's orders and leaves no offcut in stock", async () => {
    const customerLot = await receive(2, ids.otherCustomer);
    expect((await issue(orderId, { lot_id: customerLot })).error?.message).toBe(
      "customer_material",
    );

    const customerOrder = await createOrder(10, { customer: ids.otherCustomer });
    expect(
      (await issue(customerOrder, { lot_id: customerLot, offcut_length_mm: 100 })).error?.message,
    ).toBe("offcut_own_material_only");
    const issued = await issue(customerOrder, { lot_id: customerLot, cut_pieces: 10 });
    expect(issued.error).toBeNull();
    const { data } = await warehouse
      .from("stock_movements")
      .select("value")
      .eq("document_id", issued.data ?? "");
    expect(data?.map((m) => decimalFromDb(m.value))).toEqual(["0"]);
  });

  it("consumption is proposed from good + scrap of the first operation and confirmed separately", async () => {
    const { data: firstOp } = await fx.service
      .from("production_order_operations")
      .select("id")
      .eq("order_id", orderId)
      .order("sequence")
      .limit(1)
      .single()
      .throwOnError();
    await fx.service
      .from("production_reports")
      .insert({
        organization_id: fx.a.org.id,
        order_id: orderId,
        operation_id: firstOp.id,
        good_quantity: 10,
        scrap_quantity: 2,
        idempotency_key: randomUUID(),
      })
      .throwOnError();
    const plan = one(await warehouse.rpc("order_material_plan", { p_order_id: orderId })) as Record<
      string,
      unknown
    >;
    // (10 + 2) × 102 mm: scrap consumes material too.
    expect(plan).toMatchObject({ reported_pieces: 12, proposed_consumption: 1224 });

    const confirmed = await warehouse.rpc("confirm_order_consumption", {
      p_order_id: orderId,
      p_item_id: ids.item,
      p_quantity: 1250,
      p_note: "DBO odrezak",
    });
    expect(confirmed.error).toBeNull();
    const { data } = await warehouse
      .from("stock_order_consumption")
      .select("quantity, proposed_quantity")
      .eq("order_id", orderId)
      .single()
      .throwOnError();
    expect([decimalFromDb(data.quantity), decimalFromDb(data.proposed_quantity)]).toEqual([
      "1250",
      "1224",
    ]);
  });

  it("the stock item is fixed once material was issued", async () => {
    const result = await fx.a.admin
      .from("production_orders")
      .update({ stock_item_id: null })
      .eq("id", orderId);
    expect(result.error?.message).toBe("order_material_issued");
  });

  it("operators and other tenants cannot issue", async () => {
    expect((await issue(orderId, { lot_id: lotId }, fx.a.operator)).error?.code).toBe("42501");
    expect((await issue(orderId, { lot_id: lotId }, fx.b.admin)).error?.code).toBe("42501");
    const { data } = await fx.b.admin
      .from("stock_reservations")
      .select("id")
      .eq("order_id", orderId);
    expect(data).toEqual([]);
  });

  it("shows the issued lots to readers of the operation, not to others", async () => {
    const { data: op } = await fx.service
      .from("production_order_operations")
      .select("id")
      .eq("order_id", orderId)
      .order("sequence")
      .limit(1)
      .single()
      .throwOnError();
    const material = one(await fx.a.admin.rpc("floor_order_material", { p_operation_id: op.id }));
    expect(material).toMatchObject({ item_code: `${MARK}-C45-50` });
    const foreign = await fx.b.admin.rpc("floor_order_material", { p_operation_id: op.id });
    expect(foreign.error?.code).toBe("P0002");
  });
});

describe("Treba rezanje", () => {
  it("adds cutting as the first operation or archives it", async () => {
    const orderId = await createOrder(5, { release: false, needsCutting: true });
    const ops = async () =>
      (
        await fx.service
          .from("production_order_operations")
          .select("sequence, operation_type_id, archived_at")
          .eq("order_id", orderId)
          .order("sequence")
          .throwOnError()
      ).data;
    expect((await ops()).map((o) => [o.sequence, o.operation_type_id])).toEqual([
      [1, ids.cutType],
      [2, ids.turnType],
    ]);

    expect(
      (await fx.a.admin.rpc("set_order_cutting", { p_order_id: orderId, p_needs: false })).error,
    ).toBeNull();
    expect(
      (await ops()).filter((o) => o.archived_at === null).map((o) => o.operation_type_id),
    ).toEqual([ids.turnType]);
    const denied = await warehouse.rpc("set_order_cutting", { p_order_id: orderId, p_needs: true });
    expect(denied.error?.code).toBe("42501");
  });
});
