// What an audit entry of an order means for the order's change log. Status
// changes have their own log (production_order_status_history), so they are
// left out here.
import { changedFields } from "@/modules/products/rules";

export type OrderHistoryEvent =
  | "order_created"
  | "order_copied"
  | "order_updated"
  | "drawings_replaced"
  | "operation_added"
  | "operation_updated"
  | "operation_removed"
  | "operation_restored"
  | "worker_assigned"
  | "worker_removed";

export type OrderHistoryDescription = {
  event: OrderHistoryEvent;
  /** Changed columns (updates only). */
  fields: string[];
  /** Order number, revision or similar the entry is about. */
  subject: string | null;
};

const BOOKKEEPING = new Set(["status", "status_changed_at", "status_changed_by", "archived_at"]);
const OPERATION_BOOKKEEPING = new Set(["status", "status_changed_at", "status_changed_by"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

export function describeOrderHistoryEntry(entry: {
  action: string;
  before: unknown;
  after: unknown;
}): OrderHistoryDescription | null {
  const before = asRecord(entry.before);
  const after = asRecord(entry.after);
  const fields = changedFields(entry.before, entry.after);

  switch (entry.action) {
    case "production_orders.insert":
      return { event: "order_created", fields: [], subject: text(after.order_number) };
    case "production_orders.copied":
      return { event: "order_copied", fields: [], subject: text(before.order_number) };
    case "production_orders.drawings_replaced":
      return { event: "drawings_replaced", fields: [], subject: text(after.revision) };
    case "production_orders.update": {
      const changed = fields.filter((field) => !BOOKKEEPING.has(field) && field !== "revision_id");
      return changed.length > 0 ? { event: "order_updated", fields: changed, subject: null } : null;
    }
    case "production_order_operations.insert":
      return { event: "operation_added", fields: [], subject: null };
    case "production_order_operations.update": {
      if (fields.includes("archived_at")) {
        return {
          event: after.archived_at ? "operation_removed" : "operation_restored",
          fields: [],
          subject: null,
        };
      }
      const changed = fields.filter((field) => !OPERATION_BOOKKEEPING.has(field));
      return changed.length > 0
        ? { event: "operation_updated", fields: changed, subject: null }
        : null;
    }
    case "production_order_operation_workers.insert":
      return { event: "worker_assigned", fields: [], subject: null };
    case "production_order_operation_workers.delete":
      return { event: "worker_removed", fields: [], subject: null };
    default:
      return null;
  }
}
