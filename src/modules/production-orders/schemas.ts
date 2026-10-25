import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { compareDecimals } from "@/lib/decimal";
import { isUnique, optionalDecimal, optionalText, optionalUuid } from "@/lib/forms";
import { cycleTimeUnitSchema, parseCycleTime } from "@/modules/products/schemas";
import { isValidOrderNumberTemplate } from "./rules";
import { OPERATION_STATUSES, ORDER_STATUSES } from "./status-rules";

// Shared by the client forms (react-hook-form) and the server actions.
// Limits mirror the CHECKs in migration 20261025100000.

const quantity = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = optionalDecimal({
      maxScale: 3,
      max: "99999999999",
      exclusiveMin: true,
    }).safeParse(value);
    if (!parsed.success || parsed.data === null) {
      ctx.addIssue({ code: "custom", message: "invalid quantity" });
      return z.NEVER;
    }
    return parsed.data;
  });

const requiredDate = z.iso.date();
const optionalDate = z.union([z.literal(""), z.iso.date()]).transform((value) => value || null);

/** "" = automatic / normal, otherwise 1 (extremely urgent) … 5 (not urgent). */
const prioritySchema = z
  .union([z.literal(""), z.enum(["1", "2", "3", "4", "5"])])
  .transform((value) => (value === "" ? null : Number(value)));

const millimetres = optionalDecimal({ maxScale: 3, max: "9999999", exclusiveMin: true });
const kerf = optionalDecimal({ maxScale: 3, max: "99999" });
const remnant = optionalDecimal({ maxScale: 3, max: "9999999" });

/** Units that are counted in whole pieces (no decimals). */
export function isWholeUnit(unit: string): boolean {
  return unit === "pcs" || unit === "set";
}

/** Quantity allowed for the unit: whole numbers for pieces and sets. */
export function quantityFitsUnit(value: string, unit: string): boolean {
  return !isWholeUnit(unit) || !value.includes(".");
}

type Dated = { plannedStart: string | null; plannedEnd: string | null };

function checkPlannedDates(value: Dated, ctx: z.RefinementCtx) {
  if (value.plannedStart && value.plannedEnd && value.plannedEnd < value.plannedStart) {
    ctx.addIssue({ code: "custom", path: ["plannedEnd"], message: "end before start" });
  }
}

const scheduleFields = {
  quantity,
  dueDate: requiredDate,
  priority: prioritySchema,
  plannedStart: optionalDate,
  plannedEnd: optionalDate,
  notes: optionalText(2000),
};

const pieceFields = {
  pieceLength: millimetres,
  kerf,
  barLength: millimetres,
  barRemnant: remnant,
};

type Bar = { barLength: string | null; barRemnant: string | null };

function checkBar(value: Bar, ctx: z.RefinementCtx) {
  if (
    value.barLength &&
    value.barRemnant &&
    compareDecimals(value.barRemnant, value.barLength) >= 0
  ) {
    ctx.addIssue({ code: "custom", path: ["barRemnant"], message: "remnant not below bar" });
  }
}

export const createOrderSchema = z
  .object({
    customerId: z.uuid(),
    productId: z.uuid(),
    revisionId: optionalUuid,
    ...scheduleFields,
    ...pieceFields,
  })
  .superRefine(checkPlannedDates)
  .superRefine(checkBar);
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateOrderFormValues = z.input<typeof createOrderSchema>;

export const updateOrderSchema = z
  .object({ ...scheduleFields, ...pieceFields })
  .superRefine(checkPlannedDates)
  .superRefine(checkBar);
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type UpdateOrderFormValues = z.input<typeof updateOrderSchema>;

export const copyOrderSchema = z.object(scheduleFields).superRefine(checkPlannedDates);
export type CopyOrderInput = z.infer<typeof copyOrderSchema>;
export type CopyOrderFormValues = z.input<typeof copyOrderSchema>;

export const ORDER_FIELDS = [
  "customerId",
  "productId",
  "revisionId",
  "quantity",
  "dueDate",
  "priority",
  "plannedStart",
  "plannedEnd",
  "notes",
  "pieceLength",
  "kerf",
  "barLength",
  "barRemnant",
] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];
export type OrderError = "invalid_reference" | "order_closed" | "order_in_production";
export type OrderActionResult = ActionResult<OrderField, OrderError>;

/** JSON for create_production_order / copy_production_order; decimals stay strings. */
export function toOrderRpcArgs(input: CopyOrderInput & Partial<CreateOrderInput>) {
  return {
    customer_id: input.customerId,
    product_id: input.productId,
    revision_id: input.revisionId ?? null,
    quantity: input.quantity,
    due_date: input.dueDate,
    priority: input.priority,
    planned_start: input.plannedStart,
    planned_end: input.plannedEnd,
    notes: input.notes,
    piece_length_mm: input.pieceLength ?? null,
    kerf_mm: input.kerf ?? null,
    bar_length_mm: input.barLength ?? null,
    bar_remnant_mm: input.barRemnant ?? null,
  };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
export const orderStatusChangeSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  reason: optionalText(500),
});
export type OrderStatusError =
  | "invalid_status_transition"
  | "cancel_reason_required"
  | "completion_requires_production_report"
  | "machine_assignment_missing"
  | "cut_quantity_required";
export type OrderStatusActionResult = ActionResult<"reason", OrderStatusError>;

export const operationStatusSchema = z.enum(OPERATION_STATUSES);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** datetime-local value ("2026-10-25T08:00"), "" = none. */
const optionalLocalDateTime = z
  .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)])
  .transform((value) => value || null);

export const assignmentSchema = z
  .object({
    machineId: optionalUuid,
    employeeIds: z.array(z.uuid()).max(50).refine(isUnique, "duplicate worker"),
    plannedStart: optionalLocalDateTime,
    plannedEnd: optionalLocalDateTime,
  })
  .superRefine((value, ctx) => {
    if (value.plannedStart && value.plannedEnd && value.plannedEnd <= value.plannedStart) {
      ctx.addIssue({ code: "custom", path: ["plannedEnd"], message: "end before start" });
    }
  });
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type AssignmentFormValues = z.input<typeof assignmentSchema>;

export const ASSIGNMENT_FIELDS = [
  "machineId",
  "employeeIds",
  "plannedStart",
  "plannedEnd",
] as const;
export type AssignmentField = (typeof ASSIGNMENT_FIELDS)[number];
export type AssignmentError =
  | "worker_external"
  | "worker_inactive"
  | "worker_not_inspector"
  | "worker_needs_machine"
  | "worker_not_qualified"
  | "order_closed"
  | "operation_done"
  | "invalid_reference";

export type AssignmentWarnings = {
  machineTypeMismatch: boolean;
  overlaps: { orderId: string; orderNumber: string; operationCode: string }[];
};

export type AssignmentActionResult =
  | { ok: true; id: string; warnings: AssignmentWarnings }
  | {
      ok: false;
      error: AssignmentError | "invalid" | "denied" | "not_found" | "unexpected";
      fields: AssignmentField[];
    };

/** Fields of an operation (added to a draft or edited while planning). */
export const orderOperationSchema = z
  .object({
    operationTypeId: z.uuid(),
    description: optionalText(200),
    machineId: optionalUuid,
    externalCompany: optionalText(200),
    setupTime: optionalDecimal({ maxScale: 2, max: "99999" }),
    cycleTime: z.string(),
    cycleUnit: cycleTimeUnitSchema,
    notes: optionalText(2000),
  })
  .transform((value, ctx) => {
    const cycleTimeSeconds = parseCycleTime(value.cycleTime, value.cycleUnit);
    if (cycleTimeSeconds === undefined) {
      ctx.addIssue({ code: "custom", path: ["cycleTime"], message: "invalid cycle time" });
      return z.NEVER;
    }
    return { ...value, cycleTimeSeconds };
  });
export type OrderOperationInput = z.infer<typeof orderOperationSchema>;
export type OrderOperationFormValues = z.input<typeof orderOperationSchema>;

export const ORDER_OPERATION_FIELDS = [
  "operationTypeId",
  "description",
  "machineId",
  "externalCompany",
  "setupTime",
  "cycleTime",
  "cycleUnit",
  "notes",
] as const;
export type OrderOperationField = (typeof ORDER_OPERATION_FIELDS)[number];
export type OrderOperationError =
  | "invalid_reference"
  | "external_rules"
  | "order_closed"
  | "order_not_draft"
  | "order_in_production";
export type OrderOperationActionResult = ActionResult<OrderOperationField, OrderOperationError>;

/** Row for add_order_operation / update; external operations carry no machine or times. */
export function toOrderOperationRow(input: OrderOperationInput, external: boolean) {
  return {
    operation_type_id: input.operationTypeId,
    description: input.description,
    machine_id: external ? null : input.machineId,
    external_company: external ? input.externalCompany : null,
    setup_time_min: external ? null : input.setupTime,
    cycle_time_s: external ? null : input.cycleTimeSeconds,
    notes: input.notes,
  };
}

// ---------------------------------------------------------------------------
// Settings (organizations.settings)
// ---------------------------------------------------------------------------
const wholeNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const orderSettingsSchema = z.object({
  numberTemplate: z.string().trim().refine(isValidOrderNumberTemplate, "invalid template"),
  numberDigits: wholeNumber(1, 6),
  priorityMode: z.enum(["manual", "automatic"]),
  priorityThresholds: z
    .tuple([
      wholeNumber(-365, 365),
      wholeNumber(-365, 365),
      wholeNumber(-365, 365),
      wholeNumber(-365, 365),
    ])
    .refine(
      (values) =>
        values.every((value, index) => index === 0 || value >= (values[index - 1] ?? value)),
      "thresholds must ascend",
    ),
  dueWarningDays: z
    .array(wholeNumber(0, 365))
    .min(1)
    .max(5)
    .transform((values) => [...new Set(values)].sort((a, b) => b - a)),
  workHoursPerDay: wholeNumber(1, 24),
});
export type OrderSettingsInput = z.infer<typeof orderSettingsSchema>;
export type OrderSettingsFormValues = z.input<typeof orderSettingsSchema>;
export const ORDER_SETTINGS_FIELDS = [
  "numberTemplate",
  "numberDigits",
  "priorityMode",
  "priorityThresholds",
  "dueWarningDays",
  "workHoursPerDay",
] as const;
export type OrderSettingsField = (typeof ORDER_SETTINGS_FIELDS)[number];
