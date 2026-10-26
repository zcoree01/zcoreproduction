import "server-only";
import { z } from "zod";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_UNITS, type ProductUnit } from "@/modules/products/schemas";
import type { WorkBlock } from "./rules";

const numeric = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => decimalFromDb(value) ?? "0");

const WORK_BLOCKS = [
  "operation_external",
  "cutting_uses_material_status",
  "not_an_employee",
  "not_assigned",
  "order_closed",
  "operation_done",
  "order_paused",
  "order_not_ready",
  "not_arrived",
] as const satisfies readonly WorkBlock[];

const CLOSE_STATUSES = ["pending", "approved", "rejected"] as const;
export type CloseRequestStatus = (typeof CLOSE_STATUSES)[number];

const workSchema = z.object({
  input_quantity: numeric,
  good_quantity: numeric,
  scrap_quantity: numeric,
  remaining_quantity: numeric,
  blocked: z.enum(WORK_BLOCKS).nullable(),
  working: z.boolean(),
  workers_now: z.array(z.string()),
  pause: z
    .object({ reason: z.string(), since: z.string(), notes: z.string().nullable() })
    .nullable(),
  is_last: z.boolean(),
  order_good_quantity: numeric,
  close_request: z
    .object({
      status: z.enum(CLOSE_STATUSES),
      reason: z.string(),
      decision_note: z.string().nullable(),
    })
    .nullable(),
  can_request_close: z.boolean(),
});

export type OperationWork = z.infer<typeof workSchema>;

/** Work state of an operation for the caller; null when they do not see it. */
export async function getOperationWork(operationId: string): Promise<OperationWork | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("floor_operation_work", {
    p_operation_id: operationId,
  });
  if (error) throw error;
  return data === null ? null : workSchema.parse(data);
}

export type Reason = { id: string; name: string };

/** Active downtime or scrap reasons of the organization (every member reads catalogs). */
export async function listReasons(
  organizationId: string,
  kind: "downtime_reason" | "scrap_reason" | "tool_change_reason",
): Promise<Reason[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("kind", kind)
    .is("archived_at", null)
    .order("name");
  if (error) throw error;
  return data;
}

export type ProductionReportRow = {
  id: string;
  reportedAt: string;
  operationCode: string;
  operationSequence: number;
  employeeName: string | null;
  username: string | null;
  machineCode: string | null;
  good: string;
  scrap: string;
  scrapReason: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

export type DowntimeRow = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  operationCode: string;
  operationSequence: number;
  machineCode: string | null;
  employeeName: string | null;
  reason: string;
  /** Running time; open downtime counts until now. */
  seconds: string;
  /** "pause" (from the pause button) or "entry" (entered with a duration). */
  source: "pause" | "entry";
  notes: string | null;
};

export type ToolChangeRow = {
  id: string;
  changedAt: string;
  operationCode: string;
  machineCode: string | null;
  employeeName: string | null;
  tool: string;
  insert: string | null;
  reason: string;
  minutes: string | null;
  notes: string | null;
};

export type CloseRequestRow = {
  id: string;
  status: CloseRequestStatus;
  reason: string;
  good: string;
  requestedAt: string;
  requestedBy: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
};

export type OrderProduction = {
  reports: ProductionReportRow[];
  downtime: DowntimeRow[];
  toolChanges: ToolChangeRow[];
  closeRequests: CloseRequestRow[];
};

/** Reports, downtime and close requests of an order (orders.read, checked in the functions). */
export async function getOrderProduction(orderId: string): Promise<OrderProduction> {
  const supabase = await createClient();
  const [reports, downtime, toolChanges, closeLog] = await Promise.all([
    supabase.rpc("production_order_reports", { p_order_id: orderId }),
    supabase.rpc("production_order_downtime", { p_order_id: orderId }),
    supabase.rpc("production_order_tool_changes", { p_order_id: orderId }),
    supabase.rpc("production_order_close_log", { p_order_id: orderId }),
  ]);
  if (reports.error) throw reports.error;
  if (downtime.error) throw downtime.error;
  if (toolChanges.error) throw toolChanges.error;
  if (closeLog.error) throw closeLog.error;

  return {
    reports: reports.data.map((row) => ({
      id: row.id,
      reportedAt: row.reported_at,
      operationCode: row.operation_code,
      operationSequence: row.operation_sequence,
      employeeName: row.employee_name,
      username: row.username,
      machineCode: row.machine_code,
      good: decimalFromDb(row.good_quantity) ?? "0",
      scrap: decimalFromDb(row.scrap_quantity) ?? "0",
      scrapReason: row.scrap_reason,
      notes: row.notes,
      voidedAt: row.voided_at,
      voidReason: row.void_reason,
    })),
    downtime: downtime.data.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      operationCode: row.operation_code,
      operationSequence: row.operation_sequence,
      machineCode: row.machine_code,
      employeeName: row.employee_name,
      reason: row.reason,
      seconds: decimalFromDb(row.duration_seconds) ?? "0",
      source: row.source === "entry" ? "entry" : "pause",
      notes: row.notes,
    })),
    toolChanges: toolChanges.data.map((row) => ({
      id: row.id,
      changedAt: row.changed_at,
      operationCode: row.operation_code,
      machineCode: row.machine_code,
      employeeName: row.employee_name,
      tool: row.tool,
      insert: row.insert_name,
      reason: row.reason,
      minutes: decimalFromDb(row.duration_min),
      notes: row.notes,
    })),
    closeRequests: closeLog.data.flatMap((row) => {
      const status = z.enum(CLOSE_STATUSES).safeParse(row.status);
      if (!status.success) return [];
      return [
        {
          id: row.id,
          status: status.data,
          reason: row.reason,
          good: decimalFromDb(row.good_quantity) ?? "0",
          requestedAt: row.requested_at,
          requestedBy: row.requested_by_name,
          decidedAt: row.decided_at,
          decidedBy: row.decided_by_name,
          decisionNote: row.decision_note,
        },
      ];
    }),
  };
}

export type PendingCloseRequest = {
  requestId: string;
  orderId: string;
  orderNumber: string;
  reason: string;
  good: string;
  quantity: string;
  unit: ProductUnit;
  requestedAt: string;
  requestedBy: string | null;
};

/** Requests to close with a shortage waiting for the caller (orders.close.approve, else none). */
export async function listPendingCloseRequests(
  organizationId: string,
): Promise<PendingCloseRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_close_requests", {
    p_org_id: organizationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    requestId: row.request_id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    reason: row.reason,
    good: decimalFromDb(row.good_quantity) ?? "0",
    quantity: decimalFromDb(row.quantity) ?? "0",
    unit: z.enum(PRODUCT_UNITS).catch("pcs").parse(row.unit),
    requestedAt: row.requested_at,
    requestedBy: row.requested_by_name,
  }));
}
