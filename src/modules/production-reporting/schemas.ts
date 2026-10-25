import { z } from "zod";
import { optionalDecimal, optionalText, optionalUuid, requiredText } from "@/lib/forms";

// Shared by the floor forms and the server actions. Limits mirror the CHECKs
// and function rules in migration 20261026100000.

const MAX_QUANTITY = "99999999999";

/** Quantity field: "" counts as 0. */
const quantity = optionalDecimal({ maxScale: 3, max: MAX_QUANTITY }).transform(
  (value) => value ?? "0",
);

export const reportSchema = z.object({
  good: quantity,
  scrap: quantity,
  scrapReasonId: optionalUuid,
  notes: optionalText(500),
  /** Generated when the form opens; a resubmission returns the first report. */
  idempotencyKey: z.uuid(),
  finish: z.boolean(),
});
export type ReportInput = z.infer<typeof reportSchema>;
export type ReportFormValues = z.input<typeof reportSchema>;
export const REPORT_FIELDS = ["good", "scrap", "scrapReasonId", "notes"] as const;
export type ReportField = (typeof REPORT_FIELDS)[number];

export const pauseSchema = z.object({
  reasonId: z.uuid(),
  notes: optionalText(500),
});
export type PauseInput = z.infer<typeof pauseSchema>;

export const cutSchema = z.object({
  quantity: optionalDecimal({ maxScale: 3, max: MAX_QUANTITY, exclusiveMin: true }).pipe(
    z.string(),
  ),
  idempotencyKey: z.uuid(),
});
export type CutInput = z.infer<typeof cutSchema>;

export const closeRequestSchema = z.object({ reason: requiredText(500) });

export const closeDecisionSchema = z
  .object({ approve: z.boolean(), note: optionalText(500) })
  .refine((value) => value.approve || value.note !== null, {
    path: ["note"],
    message: "note required",
  });
export type CloseDecisionInput = z.infer<typeof closeDecisionSchema>;

export const voidReportSchema = z.object({ reason: requiredText(500) });

/** Business-rule errors raised by the reporting functions with a fixed message. */
export const WORK_ERRORS = [
  "not_an_employee",
  "operation_external",
  "cutting_uses_material_status",
  "order_closed",
  "operation_done",
  "order_paused",
  "order_not_ready",
  "not_arrived",
  "downtime_reason_required",
  "no_open_session",
  "operation_not_started",
  "whole_pieces_required",
  "quantity_required",
  "quantity_exceeds_input",
  "nothing_reported",
  "no_cutting_operation",
  "invalid_status_transition",
  "machine_assignment_missing",
  "order_not_in_production",
  "close_reason_required",
  "close_request_pending",
  "close_request_decided",
  "reject_note_required",
  "void_reason_required",
] as const;
export type WorkError = (typeof WORK_ERRORS)[number];

export type WorkActionResult =
  | { ok: true }
  | { ok: false; error: WorkError | "invalid" | "denied" | "not_found" | "unexpected" };
