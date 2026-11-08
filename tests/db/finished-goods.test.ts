import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decimalFromDb } from "@/lib/decimal";
import type { Database, Json } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setTenantLocked, setupFixture, signIn, type Fixture } from "./fixtures";

// Inventory part D (D-034): finished goods and delivery notes. Only good
// pieces of the last operation are received (also partly, each once); a
// delivery note takes pieces of the customer's orders that are on hand,
// numbered by the format of the settings; cancelling returns them.
// Rows use the DBF prefix.

const MARK = "DBF";
type Db = SupabaseClient<Database>;

let fx: Fixture;
let warehouse: Db;
const ids = { customer: "", otherCustomer: "", customerNumber: 0, product: "", turnType: "" };

async function cleanup(service: Db, orgIds: string[]) {
  const orders = await service
    .from("production_orders")
    .select("id")
    .in("organization_id", orgIds)
    .like("notes", `${MARK}%`);
  const orderIds = (orders.data ?? []).map((row) => row.id);
  if (orderIds.length > 0) {
    await service.from("finished_goods_movements").delete().in("order_id", orderIds);
    const lines = await service
      .from("delivery_note_lines")
      .select("delivery_note_id")
      .in("order_id", orderIds);
    const noteIds = [...new Set((lines.data ?? []).map((l) => l.delivery_note_id))];
    await service.from("delivery_note_lines").delete().in("order_id", orderIds);
    if (noteIds.length > 0) await service.from("delivery_notes").delete().in("id", noteIds);
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

/** Released order of 10 pieces with `good` good pieces reported on its (only) operation. */
async function orderWithGood(
  good: number,
  customer = ids.customer,
  position: string | null = null,
) {
  const orderId = one(
    await fx.a.admin.rpc("create_production_order", {
      p_org_id: fx.a.org.id,
      p_order: {
        customer_id: customer,
        product_id: ids.product,
        quantity: "10",
        due_date: "2030-06-30",
        notes: `${MARK} order`,
      } as Json,
    }),
  );
  if (position) {
    await fx.a.admin
      .from("production_orders")
      .update({ customer_position: position })
      .eq("id", orderId)
      .throwOnError();
  }
  await fx.a.admin.rpc("set_production_order_status", { p_order_id: orderId, p_status: "planned" });
  const op = one(
    await fx.service
      .from("production_order_operations")
      .select("id")
      .eq("order_id", orderId)
      .single(),
  );
  await fx.service
    .from("production_reports")
    .insert({
      organization_id: fx.a.org.id,
      order_id: orderId,
      operation_id: op.id,
      good_quantity: good,
      scrap_quantity: 0,
      idempotency_key: randomUUID(),
    })
    .throwOnError();
  return orderId;
}

function receive(orderId: string, quantity: number, key = randomUUID(), client: Db = fx.a.admin) {
  return client.rpc("receive_finished_goods", {
    p_org_id: fx.a.org.id,
    p_idempotency_key: key,
    p_order_id: orderId,
    p_quantity: quantity,
  });
}

function issue(lines: Record<string, Json>[], customer = ids.customer, client: Db = fx.a.admin) {
  return client.rpc("issue_delivery_note", {
    p_org_id: fx.a.org.id,
    p_idempotency_key: randomUUID(),
    p_note: { customer_id: customer, issued_on: "2026-03-15" },
    p_lines: lines,
  });
}

async function onHand(orderId: string) {
  const { data } = await fx.a.admin
    .from("finished_goods_stock")
    .select("received, shipped, on_hand")
    .eq("order_id", orderId)
    .maybeSingle()
    .throwOnError();
  return [
    decimalFromDb(data?.received),
    decimalFromDb(data?.shipped),
    decimalFromDb(data?.on_hand),
  ];
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
  const customers = one(
    await fx.service
      .from("customers")
      .insert([
        { organization_id: org, name: `${MARK} Kupac` },
        { organization_id: org, name: `${MARK} Drugi` },
      ])
      .select("id, name, customer_number"),
  );
  const main = customers.find((c) => c.name === `${MARK} Kupac`)!;
  ids.customer = main.id;
  ids.customerNumber = main.customer_number;
  ids.otherCustomer = customers.find((c) => c.name === `${MARK} Drugi`)!.id;
  ids.turnType = one(
    await fx.service
      .from("operation_types")
      .insert({ organization_id: org, code: `${MARK}TO`, name: `${MARK} Tokarenje` })
      .select("id")
      .single(),
  ).id;
  ids.product = one(
    await fx.a.admin.rpc("create_product", {
      p_org_id: org,
      p_product: { part_number: `${MARK}-1`, name: "Čep", customer_id: ids.customer, unit: "pcs" },
      p_revision: { revision: "A", drawing_number: "DBF-CRT-7" },
    }),
  );
  const revision = one(
    await fx.service.from("product_revisions").select("id").eq("product_id", ids.product).single(),
  );
  const saved = await fx.a.admin.rpc("save_product_operation", {
    p_revision_id: revision.id,
    p_operation_id: null as unknown as string,
    p_operation: { operation_type_id: ids.turnType, cycle_time_s: "60" } as Json,
  });
  expect(saved.error).toBeNull();
}, 120_000);

afterAll(async () => {
  await fx.a.admin
    .from("organizations")
    .select("settings")
    .eq("id", fx.a.org.id)
    .single()
    .then(async ({ data }) => {
      const settings = { ...((data?.settings ?? {}) as Record<string, Json>) };
      delete settings.delivery_note_number_template;
      delete settings.delivery_note_number_digits;
      await fx.a.admin.from("organizations").update({ settings }).eq("id", fx.a.org.id);
    });
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("finished goods", () => {
  it("receives only good pieces, partly and each once", async () => {
    const orderId = await orderWithGood(10);
    expect((await receive(orderId, 11)).error?.message).toBe("more_than_good");
    const key = randomUUID();
    expect((await receive(orderId, 6, key)).error).toBeNull();
    expect((await receive(orderId, 6, key)).error).toBeNull();
    expect(await onHand(orderId)).toEqual(["6", "0", "6"]);
    expect((await receive(orderId, 5)).error?.message).toBe("more_than_good");
    expect((await receive(orderId, 1.5)).error?.message).toBe("invalid_line");
    expect((await receive(orderId, 4)).error).toBeNull();
    expect(await onHand(orderId)).toEqual(["10", "0", "10"]);
  });

  it("the warehouse reads but does not receive", async () => {
    const orderId = await orderWithGood(2);
    expect((await receive(orderId, 1, randomUUID(), warehouse)).error?.code).toBe("42501");
  });
});

describe("delivery notes", () => {
  it("ships pieces on hand with the customer position, numbered by the default format", async () => {
    const orderId = await orderWithGood(8, ids.customer, "Poz. 10");
    await receive(orderId, 8);
    expect((await issue([{ order_id: orderId, quantity: 9 }])).error?.message).toBe("not_in_stock");

    const noteId = one(await issue([{ order_id: orderId, quantity: 5 }]));
    const note = one(
      await fx.a.admin.from("delivery_notes").select("number, status").eq("id", noteId).single(),
    );
    const customer = String(ids.customerNumber).padStart(2, "0");
    expect(note.number).toMatch(new RegExp(`^${customer}-0326-\\d+$`));
    const lines = one(
      await fx.a.admin
        .from("delivery_note_lines")
        .select("customer_position, part_number, drawing_number, revision, quantity")
        .eq("delivery_note_id", noteId),
    );
    expect(lines).toEqual([
      expect.objectContaining({
        customer_position: "Poz. 10",
        part_number: `${MARK}-1`,
        drawing_number: "DBF-CRT-7",
        revision: "A",
      }),
    ]);
    expect(await onHand(orderId)).toEqual(["8", "5", "3"]);

    expect(
      (await fx.a.admin.rpc("cancel_delivery_note", { p_note_id: noteId, p_reason: "" })).error
        ?.message,
    ).toBe("reason_required");
    expect(
      (await fx.a.admin.rpc("cancel_delivery_note", { p_note_id: noteId, p_reason: "DBF greška" }))
        .error,
    ).toBeNull();
    expect(await onHand(orderId)).toEqual(["8", "0", "8"]);
  });

  it("only orders of that customer; numbers follow the configured format", async () => {
    const other = await orderWithGood(3, ids.otherCustomer);
    await receive(other, 3);
    expect((await issue([{ order_id: other, quantity: 1 }])).error?.message).toBe(
      "order_not_found",
    );

    const { data } = await fx.a.admin
      .from("organizations")
      .select("settings")
      .eq("id", fx.a.org.id)
      .single();
    const settings = (data?.settings ?? {}) as Record<string, Json>;
    const invalid = await fx.a.admin
      .from("organizations")
      .update({ settings: { ...settings, delivery_note_number_template: "OT-{GODINA4}" } })
      .eq("id", fx.a.org.id);
    expect(invalid.error?.code).toBe("23514");
    const valid = await fx.a.admin
      .from("organizations")
      .update({
        settings: {
          ...settings,
          delivery_note_number_template: "OT-{GODINA4}/{BROJ}",
          delivery_note_number_digits: 4,
        },
      })
      .eq("id", fx.a.org.id);
    expect(valid.error).toBeNull();
    const noteId = one(await issue([{ order_id: other, quantity: 2 }], ids.otherCustomer));
    const note = one(
      await fx.a.admin.from("delivery_notes").select("number").eq("id", noteId).single(),
    );
    expect(note.number).toMatch(/^OT-2026\/\d{4,}$/);
  });

  it("other tenants and the warehouse cannot issue", async () => {
    const orderId = await orderWithGood(2);
    await receive(orderId, 2);
    expect(
      (await issue([{ order_id: orderId, quantity: 1 }], ids.customer, warehouse)).error?.code,
    ).toBe("42501");
    const { data } = await fx.b.admin
      .from("finished_goods_movements")
      .select("id")
      .eq("order_id", orderId);
    expect(data).toEqual([]);
  });
});

describe("while the organization is locked (D-049)", () => {
  afterAll(() => setTenantLocked(fx.service, fx.a.org.id, false));

  it("still receives finished goods of an existing order and ships them", async () => {
    const orderId = await orderWithGood(4);
    await setTenantLocked(fx.service, fx.a.org.id, true);
    expect((await receive(orderId, 4)).error).toBeNull();
    expect((await issue([{ order_id: orderId, quantity: 4 }])).error).toBeNull();
  });
});
