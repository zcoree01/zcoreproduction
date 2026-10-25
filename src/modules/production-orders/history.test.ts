import { describe, expect, it } from "vitest";
import { describeOrderHistoryEntry } from "./history";

describe("order change log", () => {
  it("describes creation, copies and drawing changes", () => {
    expect(
      describeOrderHistoryEntry({
        action: "production_orders.insert",
        before: null,
        after: { order_number: "RN1-4326-001" },
      }),
    ).toEqual({ event: "order_created", fields: [], subject: "RN1-4326-001" });
    expect(
      describeOrderHistoryEntry({
        action: "production_orders.copied",
        before: { order_number: "RN1-4326-001" },
        after: null,
      }),
    ).toEqual({ event: "order_copied", fields: [], subject: "RN1-4326-001" });
    expect(
      describeOrderHistoryEntry({
        action: "production_orders.drawings_replaced",
        before: { revision: "A" },
        after: { revision: "B" },
      }),
    ).toEqual({ event: "drawings_replaced", fields: [], subject: "B" });
  });

  it("lists changed fields and skips status bookkeeping (own log)", () => {
    expect(
      describeOrderHistoryEntry({
        action: "production_orders.update",
        before: { quantity: 100, due_date: "2026-11-01", status: "draft" },
        after: { quantity: 120, due_date: "2026-11-01", status: "draft" },
      }),
    ).toEqual({ event: "order_updated", fields: ["quantity"], subject: null });
    expect(
      describeOrderHistoryEntry({
        action: "production_orders.update",
        before: { status: "draft", status_changed_at: "a" },
        after: { status: "planned", status_changed_at: "b" },
      }),
    ).toBeNull();
  });

  it("describes operations and workers", () => {
    expect(
      describeOrderHistoryEntry({
        action: "production_order_operations.update",
        before: { archived_at: null },
        after: { archived_at: "2026-10-25T10:00:00Z" },
      }),
    ).toEqual({ event: "operation_removed", fields: [], subject: null });
    expect(
      describeOrderHistoryEntry({
        action: "production_order_operations.update",
        before: { machine_id: null, status: "waiting" },
        after: { machine_id: "m1", status: "waiting" },
      }),
    ).toEqual({ event: "operation_updated", fields: ["machine_id"], subject: null });
    expect(
      describeOrderHistoryEntry({
        action: "production_order_operations.update",
        before: { status: "waiting" },
        after: { status: "ready" },
      }),
    ).toBeNull();
    expect(
      describeOrderHistoryEntry({
        action: "production_order_operation_workers.delete",
        before: {},
        after: null,
      }),
    ).toEqual({ event: "worker_removed", fields: [], subject: null });
  });
});
