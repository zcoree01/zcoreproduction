import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decimalFromDb } from "@/lib/decimal";
import type { Database } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Inventory part C (D-033): stock counts. Opening snapshots the expected
// stock of a warehouse and its shelves; counted amounts and found material
// are entered by the warehouse; only an approver posts the differences as one
// correction (uncounted lines change nothing) or cancels with a reason.
// Rows use the DBC prefix.

const MARK = "DBC";
type Db = SupabaseClient<Database>;

let fx: Fixture;
let warehouse: Db;
const ids = { warehouse: "", shelf: "", item: "", lotA: "", lotB: "" };

async function cleanup(service: Db, orgIds: string[]) {
  const items = await service
    .from("stock_items")
    .select("id")
    .in("organization_id", orgIds)
    .like("code", `${MARK}-%`);
  const itemIds = (items.data ?? []).map((row) => row.id);
  if (itemIds.length > 0) {
    const counts = await service.from("stock_counts").select("id").in("item_id", itemIds);
    const countIds = (counts.data ?? []).map((row) => row.id);
    if (countIds.length > 0) {
      await service.from("stock_count_lines").delete().in("count_id", countIds);
      await service.from("stock_counts").delete().in("id", countIds);
    }
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
    .like("code", `${MARK}P%`);
  await service
    .from("stock_locations")
    .delete()
    .in("organization_id", orgIds)
    .like("code", `${MARK}%`);
}

const one = <T>(result: { data: T; error: unknown }): NonNullable<T> => {
  if (result.error) throw result.error;
  if (result.data === null || result.data === undefined) throw new Error("no data");
  return result.data;
};

async function receive(location: string, pieces: number) {
  const doc = one(
    await warehouse.rpc("post_stock_receipt", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: randomUUID(),
      p_header: {},
      p_lines: [
        {
          item_id: ids.item,
          location_id: location,
          pieces,
          length_mm: 3000,
          unit_price: 1,
          price_unit: "piece",
        },
      ],
    }),
  );
  return one(
    await fx.service.from("stock_movements").select("lot_id").eq("document_id", doc).single(),
  ).lot_id;
}

async function open(itemId: string | null = ids.item) {
  return one(
    await warehouse.rpc("open_stock_count", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: randomUUID(),
      p_location_id: ids.warehouse,
      p_item_id: itemId as string,
    }),
  );
}

async function lines(countId: string) {
  const { data } = await warehouse
    .from("stock_count_lines")
    .select("id, lot_id, location_id, length_mm, expected_pieces, found")
    .eq("count_id", countId)
    .throwOnError();
  return data;
}

async function stock() {
  const { data } = await warehouse
    .from("stock_balances")
    .select("lot_id, location_id, length_mm, pieces")
    .eq("item_id", ids.item)
    .throwOnError();
  return data.map((r) => [r.lot_id, r.location_id, decimalFromDb(r.length_mm), r.pieces]);
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
  ids.warehouse = one(
    await fx.service
      .from("stock_locations")
      .insert({ organization_id: org, kind: "warehouse", code: `${MARK}M`, name: "DBC Magacin" })
      .select("id")
      .single(),
  ).id;
  ids.shelf = one(
    await fx.service
      .from("stock_locations")
      .insert({
        organization_id: org,
        kind: "shelf",
        parent_id: ids.warehouse,
        code: `${MARK}P1`,
        name: "DBC Polica",
      })
      .select("id")
      .single(),
  ).id;
  ids.item = one(
    await fx.service
      .from("stock_items")
      .insert({
        organization_id: org,
        code: `${MARK}-S235-20`,
        name: "DBC S235 □20",
        shape: "square_bar",
        width_mm: 20,
        base_unit: "mm",
        standard_length_mm: 3000,
      })
      .select("id")
      .single(),
  ).id;
  ids.lotA = await receive(ids.shelf, 3);
  ids.lotB = await receive(ids.warehouse, 1);
}, 120_000);

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("stock count", () => {
  it("snapshots the warehouse with its shelves, posts only counted differences after approval", async () => {
    const countId = await open();
    const snapshot = await lines(countId);
    expect(snapshot.map((l) => [l.lot_id, l.location_id, l.expected_pieces]).sort()).toEqual(
      [
        [ids.lotA, ids.shelf, 3],
        [ids.lotB, ids.warehouse, 1],
      ].sort(),
    );
    const lineA = snapshot.find((l) => l.lot_id === ids.lotA)!;

    // Counted 2 of 3 on the shelf; lot B is not counted (no change); a found 1500 mm piece.
    expect(
      (await warehouse.rpc("set_count_line", { p_line_id: lineA.id, p_counted: 2 })).error,
    ).toBeNull();
    expect(
      (await warehouse.rpc("set_count_line", { p_line_id: lineA.id, p_counted: 1.5 })).error
        ?.message,
    ).toBe("invalid_line");
    const found = await warehouse.rpc("add_count_line", {
      p_count_id: countId,
      p_line: { item_id: ids.item, location_id: ids.warehouse, length_mm: 1500, counted: 1 },
    });
    expect(found.error).toBeNull();

    // Posting needs a submitted count and the approver.
    expect(
      (await fx.a.admin.rpc("decide_stock_count", { p_count_id: countId, p_post: true })).error
        ?.message,
    ).toBe("count_not_submitted");
    expect((await warehouse.rpc("submit_stock_count", { p_count_id: countId })).error).toBeNull();
    expect(
      (await warehouse.rpc("set_count_line", { p_line_id: lineA.id, p_counted: 3 })).error?.message,
    ).toBe("count_not_open");
    expect(
      (await warehouse.rpc("decide_stock_count", { p_count_id: countId, p_post: true })).error
        ?.code,
    ).toBe("42501");

    const posted = await fx.a.admin.rpc("decide_stock_count", {
      p_count_id: countId,
      p_post: true,
    });
    expect(posted.error).toBeNull();
    const balances = await stock();
    expect(balances.filter(([lot]) => lot === ids.lotA)).toEqual([
      [ids.lotA, ids.shelf, "3000", 2],
    ]);
    expect(balances.filter(([lot]) => lot === ids.lotB)).toEqual([
      [ids.lotB, ids.warehouse, "3000", 1],
    ]);
    expect(
      balances.some(
        ([, location, length, pieces]) =>
          location === ids.warehouse && length === "1500" && pieces === 1,
      ),
    ).toBe(true);

    const { data: doc } = await warehouse
      .from("stock_documents")
      .select("status, reason")
      .eq("id", posted.data ?? "")
      .single()
      .throwOnError();
    expect(doc.status).toBe("posted");
    expect(doc.reason).toMatch(/^Inventura IN\d{2}-\d{5}$/);
  });

  it("cancelling needs a reason and changes nothing", async () => {
    const before = await stock();
    const countId = await open();
    const [line] = await lines(countId);
    await warehouse.rpc("set_count_line", { p_line_id: line!.id, p_counted: 0 });
    expect(
      (await fx.a.admin.rpc("decide_stock_count", { p_count_id: countId, p_post: false })).error
        ?.message,
    ).toBe("reason_required");
    const cancelled = await fx.a.admin.rpc("decide_stock_count", {
      p_count_id: countId,
      p_post: false,
      p_note: "DBC ponovo",
    });
    expect(cancelled.error).toBeNull();
    expect((await stock()).sort()).toEqual(before.sort());
  });

  it("operators and other tenants cannot count", async () => {
    const op = await fx.a.operator.rpc("open_stock_count", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: randomUUID(),
      p_location_id: ids.warehouse,
    });
    expect(op.error?.code).toBe("42501");
    const countId = await open();
    const { data } = await fx.b.admin
      .from("stock_count_lines")
      .select("id")
      .eq("count_id", countId);
    expect(data).toEqual([]);
    const [line] = await lines(countId);
    expect(
      (await fx.b.admin.rpc("set_count_line", { p_line_id: line!.id, p_counted: 1 })).error?.code,
    ).toBe("P0002");
  });
});
