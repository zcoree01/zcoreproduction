import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decimalFromDb } from "@/lib/decimal";
import type { Database } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Inventory part A (D-031): the movement ledger and its functions. Balances
// are sums of movements, receipts are idempotent, stock never goes negative,
// the moving average comes from the ledger, corrections need approval,
// customer material has no value, and tenants / roles are isolated.
// Rows created here use the DBT prefix and are removed before and after.

const MARK = "DBT";

type Db = SupabaseClient<Database>;

let fx: Fixture;
let warehouse: Db;
let materialId: string;
let customerId: string;
let mainLocationId: string;
let shelfId: string;
let itemId: string;
let kgItemId: string;

async function cleanup(service: Db, orgIds: string[]) {
  const items = await service
    .from("stock_items")
    .select("id")
    .in("organization_id", orgIds)
    .like("code", `${MARK}-%`);
  const itemIds = (items.data ?? []).map((row) => row.id);
  if (itemIds.length > 0) {
    const movementDocs = await service
      .from("stock_movements")
      .select("document_id")
      .in("item_id", itemIds);
    const lineDocs = await service
      .from("stock_adjustment_lines")
      .select("document_id")
      .in("item_id", itemIds);
    const docIds = [
      ...new Set(
        [...(movementDocs.data ?? []), ...(lineDocs.data ?? [])].map((r) => r.document_id),
      ),
    ];
    await service.from("stock_movements").delete().in("item_id", itemIds);
    await service.from("stock_adjustment_lines").delete().in("item_id", itemIds);
    if (docIds.length > 0) await service.from("stock_documents").delete().in("id", docIds);
    await service.from("stock_lots").delete().in("item_id", itemIds);
    await service.from("stock_items").delete().in("id", itemIds);
  }
  await service
    .from("stock_locations")
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

function receipt(
  client: Db,
  lines: Record<string, unknown>[],
  options: { key?: string; vat?: boolean; org?: string } = {},
) {
  return client.rpc("post_stock_receipt", {
    p_org_id: options.org ?? fx.a.org.id,
    p_idempotency_key: options.key ?? randomUUID(),
    p_header: {
      supplier: "DBT Čelik",
      delivery_note: "OTP-1",
      price_includes_vat: options.vat ?? false,
    },
    p_lines: lines as Database["public"]["Functions"]["post_stock_receipt"]["Args"]["p_lines"],
  });
}

function barLine(
  pieces: number,
  length: number,
  price: number,
  extra: Record<string, unknown> = {},
) {
  return {
    item_id: itemId,
    location_id: mainLocationId,
    pieces,
    length_mm: length,
    unit_price: price,
    price_unit: "kg",
    ...extra,
  };
}

function transfer(client: Db, lotId: string, pieces: number, from: string, to: string) {
  return client.rpc("post_stock_transfer", {
    p_org_id: fx.a.org.id,
    p_idempotency_key: randomUUID(),
    p_lines: [
      {
        item_id: itemId,
        lot_id: lotId,
        from_location_id: from,
        to_location_id: to,
        pieces,
        length_mm: 3000,
      },
    ],
  });
}

async function balances(client: Db, item = itemId) {
  const { data, error } = await client
    .from("stock_balances")
    .select("lot_id, location_id, length_mm, pieces, quantity, value")
    .eq("item_id", item);
  if (error) throw error;
  return data;
}

async function totals(item = itemId) {
  const { data, error } = await fx.a.admin
    .from("stock_item_totals")
    .select("quantity, own_quantity, own_value, mass_kg")
    .eq("item_id", item)
    .maybeSingle();
  if (error) throw error;
  return {
    quantity: decimalFromDb(data?.quantity) ?? "0",
    ownQuantity: decimalFromDb(data?.own_quantity) ?? "0",
    ownValue: decimalFromDb(data?.own_value) ?? "0",
  };
}

async function lotOf(documentId: string) {
  const { data, error } = await fx.a.admin
    .from("stock_movements")
    .select("lot_id, mass_kg, value")
    .eq("document_id", documentId)
    .order("line_no")
    .limit(1)
    .single();
  if (error) throw error;
  return data;
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

  const group = one(
    await fx.a.admin
      .from("material_groups")
      .insert({ organization_id: fx.a.org.id, name: `${MARK} Čelik`, density_kg_dm3: 7.85 })
      .select("id")
      .single(),
  );
  materialId = one(
    await fx.a.admin
      .from("materials")
      .insert({ organization_id: fx.a.org.id, group_id: group.id, designation: `${MARK} C45` })
      .select("id")
      .single(),
  ).id;
  customerId = one(
    await fx.a.admin
      .from("customers")
      .insert({ organization_id: fx.a.org.id, name: `${MARK} Kupac` })
      .select("id")
      .single(),
  ).id;

  mainLocationId = one(
    await warehouse
      .from("stock_locations")
      .insert({
        organization_id: fx.a.org.id,
        kind: "warehouse",
        code: `${MARK}M`,
        name: "DBT Magacin",
      })
      .select("id")
      .single(),
  ).id;
  shelfId = one(
    await warehouse
      .from("stock_locations")
      .insert({
        organization_id: fx.a.org.id,
        kind: "shelf",
        parent_id: mainLocationId,
        code: `${MARK}P1`,
        name: "DBT Polica 1",
      })
      .select("id")
      .single(),
  ).id;
  itemId = one(
    await warehouse
      .from("stock_items")
      .insert({
        organization_id: fx.a.org.id,
        code: `${MARK}-C45-50`,
        name: "DBT C45 Ø50",
        material_id: materialId,
        shape: "round_bar",
        diameter_mm: 50,
        base_unit: "mm",
        standard_length_mm: 3000,
      })
      .select("id")
      .single(),
  ).id;
  kgItemId = one(
    await warehouse
      .from("stock_items")
      .insert({
        organization_id: fx.a.org.id,
        code: `${MARK}-KG`,
        name: "DBT žica",
        shape: "other",
        base_unit: "kg",
      })
      .select("id")
      .single(),
  ).id;
}, 120_000);

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("receipt", () => {
  it("is idempotent and derives quantity, mass and net value", async () => {
    const key = randomUUID();
    const first = await receipt(warehouse, [barLine(3, 3000, 2.5)], { key, vat: true });
    expect(first.error).toBeNull();
    const again = await receipt(warehouse, [barLine(3, 3000, 2.5)], { key, vat: true });
    expect(again.data).toBe(first.data);

    const { data: movements } = await warehouse
      .from("stock_movements")
      .select("pieces, quantity, mass_kg, value, idempotency_key")
      .eq("document_id", first.data ?? "");
    expect(movements).toHaveLength(1);
    const movement = movements?.[0];
    expect(movement?.pieces).toBe(3);
    expect(decimalFromDb(movement?.quantity)).toBe("9000");
    // π/4 · 50² · 7.85 / 10⁶ kg/mm × 9000 mm
    expect(decimalFromDb(movement?.mass_kg)).toBe("138.721");
    // 2.5 KM/kg × 138.721 kg incl. 17 % VAT → net
    expect(decimalFromDb(movement?.value)).toBe("296.4124");
    expect(movement?.idempotency_key).toBe(`${key}:1`);

    const { data: doc } = await warehouse
      .from("stock_documents")
      .select("kind, status, number")
      .eq("id", first.data ?? "")
      .single();
    expect(doc).toMatchObject({ kind: "receipt", status: "posted" });
    expect(doc?.number).toMatch(/^PR\d{2}-\d{5}$/);
  });

  it("refuses a line that does not fit the unit or has no price", async () => {
    const width = await receipt(warehouse, [barLine(1, 3000, 2, { width_mm: 100 })]);
    expect(width.error?.message).toBe("invalid_line");
    const noPrice = await receipt(warehouse, [barLine(1, 3000, 2, { unit_price: null })]);
    expect(noPrice.error?.message).toBe("price_required");
    const area = await receipt(warehouse, [barLine(1, 3000, 2, { price_unit: "m2" })]);
    expect(area.error?.message).toBe("price_unit_invalid");
  });

  it("customer material has no value and stays out of the own stock", async () => {
    const before = await totals();
    const result = await receipt(warehouse, [
      barLine(1, 6000, 0, { owner_customer_id: customerId, unit_price: null, price_unit: null }),
    ]);
    expect(result.error).toBeNull();
    const movement = await lotOf(result.data ?? "");
    expect(decimalFromDb(movement.value)).toBe("0");
    const after = await totals();
    expect(after.ownQuantity).toBe(before.ownQuantity);
    expect(after.ownValue).toBe(before.ownValue);
    expect(Number(after.quantity) - Number(before.quantity)).toBe(6000);
  });
});

describe("ledger", () => {
  let lotId: string;

  beforeAll(async () => {
    const result = await receipt(warehouse, [barLine(2, 3000, 3)]);
    lotId = (await lotOf(result.data ?? "")).lot_id;
  });

  it("balance is the sum of movements per location", async () => {
    const moved = await transfer(warehouse, lotId, 1, mainLocationId, shelfId);
    expect(moved.error).toBeNull();
    const rows = (await balances(warehouse)).filter((row) => row.lot_id === lotId);
    expect(rows.map((r) => [r.location_id, r.pieces, decimalFromDb(r.quantity)]).sort()).toEqual(
      [
        [mainLocationId, 1, "3000"],
        [shelfId, 1, "3000"],
      ].sort(),
    );
  });

  it("refuses to go negative and writes nothing", async () => {
    const { count: before } = await warehouse
      .from("stock_documents")
      .select("id", { count: "exact", head: true });
    const result = await transfer(warehouse, lotId, 5, mainLocationId, shelfId);
    expect(result.error?.message).toBe("negative_stock");
    const { count: after } = await warehouse
      .from("stock_documents")
      .select("id", { count: "exact", head: true });
    expect(after).toBe(before);
  });

  it("transfers keep the value; receipts move the average", async () => {
    const start = await totals();
    await transfer(warehouse, lotId, 1, shelfId, mainLocationId);
    const afterTransfer = await totals();
    expect(afterTransfer.ownValue).toBe(start.ownValue);

    await receipt(warehouse, [barLine(1, 3000, 10)]);
    const afterReceipt = await totals();
    expect(Number(afterReceipt.ownValue)).toBeGreaterThan(Number(start.ownValue));
  });

  it("the ledger is append-only", async () => {
    const { data } = await fx.service
      .from("stock_movements")
      .select("id")
      .eq("item_id", itemId)
      .limit(1)
      .single();
    const update = await fx.service
      .from("stock_movements")
      .update({ value: 1 })
      .eq("id", data?.id ?? "");
    expect(update.error?.message).toContain("append-only");
  });

  it("shape and dimensions are fixed once the item has movements", async () => {
    const result = await warehouse.from("stock_items").update({ diameter_mm: 60 }).eq("id", itemId);
    expect(result.error?.message).toBe("item_has_movements");
    const rename = await warehouse
      .from("stock_items")
      .update({ name: "DBT C45 Ø50 h9" })
      .eq("id", itemId);
    expect(rename.error).toBeNull();
  });
});

describe("corrections", () => {
  async function propose(client: Db, quantity: string, post = false) {
    return client.rpc("request_stock_adjustment", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: randomUUID(),
      p_reason: "DBT popis",
      p_post: post,
      p_lines: [{ item_id: kgItemId, location_id: mainLocationId, quantity }],
    });
  }

  it("warehouse proposes, cannot post or approve; the approver posts", async () => {
    expect((await propose(warehouse, "25", true)).error?.code).toBe("42501");

    const proposed = await propose(warehouse, "25");
    expect(proposed.error).toBeNull();
    expect(await balances(warehouse, kgItemId)).toEqual([]);

    const denied = await warehouse.rpc("decide_stock_adjustment", {
      p_document_id: proposed.data ?? "",
      p_approve: true,
    });
    expect(denied.error?.code).toBe("42501");

    const approved = await fx.a.admin.rpc("decide_stock_adjustment", {
      p_document_id: proposed.data ?? "",
      p_approve: true,
    });
    expect(approved.error).toBeNull();
    const rows = await balances(warehouse, kgItemId);
    expect(rows.map((r) => decimalFromDb(r.quantity))).toEqual(["25"]);

    const twice = await fx.a.admin.rpc("decide_stock_adjustment", {
      p_document_id: proposed.data ?? "",
      p_approve: true,
    });
    expect(twice.error?.message).toBe("already_decided");
  });

  it("rejection needs a reason; a correction below zero is refused on approval", async () => {
    const proposed = await propose(warehouse, "-100");
    expect(proposed.error?.message).toBe("lot_not_found");

    const lot = (await balances(warehouse, kgItemId))[0]?.lot_id;
    const tooMuch = await warehouse.rpc("request_stock_adjustment", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: randomUUID(),
      p_reason: "DBT manjak",
      p_lines: [{ item_id: kgItemId, lot_id: lot, location_id: mainLocationId, quantity: "-100" }],
    });
    expect(tooMuch.error).toBeNull();
    const reject = await fx.a.admin.rpc("decide_stock_adjustment", {
      p_document_id: tooMuch.data ?? "",
      p_approve: false,
    });
    expect(reject.error?.message).toBe("reason_required");
    const approve = await fx.a.admin.rpc("decide_stock_adjustment", {
      p_document_id: tooMuch.data ?? "",
      p_approve: true,
    });
    expect(approve.error?.message).toBe("negative_stock");
    const rejected = await fx.a.admin.rpc("decide_stock_adjustment", {
      p_document_id: tooMuch.data ?? "",
      p_approve: false,
      p_note: "Pogrešan unos",
    });
    expect(rejected.error).toBeNull();
  });
});

describe("access", () => {
  it("operators see no stock and cannot move it", async () => {
    const { data } = await fx.a.operator.from("stock_items").select("id").eq("id", itemId);
    expect(data).toEqual([]);
    expect(await balances(fx.a.operator)).toEqual([]);
    const result = await receipt(fx.a.operator, [barLine(1, 3000, 2)]);
    expect(result.error?.code).toBe("42501");
  });

  it("tenants are isolated", async () => {
    const { data } = await fx.b.admin.from("stock_movements").select("id").eq("item_id", itemId);
    expect(data).toEqual([]);
    const foreign = await receipt(fx.b.admin, [barLine(1, 3000, 2)], { org: fx.b.org.id });
    expect(foreign.error?.message).toBe("item_not_found");
    const otherOrg = await receipt(fx.b.admin, [barLine(1, 3000, 2)]);
    expect(otherOrg.error?.code).toBe("42501");
  });

  it("nobody writes the ledger directly", async () => {
    const result = await fx.a.admin.from("stock_movements").insert({
      organization_id: fx.a.org.id,
      document_id: randomUUID(),
      line_no: 1,
      kind: "receipt",
      item_id: itemId,
      lot_id: randomUUID(),
      location_id: mainLocationId,
      quantity: 1,
      idempotency_key: randomUUID(),
    });
    expect(result.error?.code).toBe("42501");
  });
});
