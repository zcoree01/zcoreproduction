import { z } from "zod";

// Inputs of the planning actions (D-041).

const day = z.iso.date();

export const planMoveSchema = z.object({
  operationId: z.uuid(),
  machineId: z.uuid().nullable(),
  /** null = take the operation off the plan. */
  planDay: day.nullable(),
  position: z.int().min(1).max(100_000).nullable(),
  /** Replaces the operators when given. */
  employeeIds: z.array(z.uuid()).max(20).optional(),
});

export const planMovesSchema = z.array(planMoveSchema).min(1).max(500);

export type PlanMoveInput = z.infer<typeof planMoveSchema>;

export const basisSchema = z.enum(["planned", "actual"]);

export const rebalanceSchema = z.object({
  machineIds: z.array(z.uuid()).min(1).max(200),
  basis: basisSchema,
});

export const downtimeSchema = z
  .object({
    id: z.uuid().nullable(),
    machineId: z.uuid(),
    startsOn: day,
    endsOn: day.nullable(),
    reasonId: z.uuid().nullable(),
    note: z.string().trim().max(500),
  })
  .refine((value) => value.endsOn === null || value.endsOn >= value.startsOn, {
    path: ["endsOn"],
  });

export type DowntimeInput = z.infer<typeof downtimeSchema>;

export const orderPlanningSchema = z.object({
  orderId: z.uuid(),
  /** null = automatic. */
  priority: z.int().min(1).max(5).nullable(),
  dueDate: day,
});

export const externalResultSchema = z.object({
  operationId: z.uuid(),
  days: z.int().min(0).max(3650).nullable(),
  /** Price in KM with up to two decimals, "" = not known. */
  cost: z
    .string()
    .trim()
    .regex(/^(\d{1,12}([.,]\d{1,2})?)?$/)
    .transform((value) => (value === "" ? null : value.replace(",", "."))),
});

export type PlanningError =
  | "invalid"
  | "denied"
  | "not_found"
  | "unexpected"
  | "operator_required"
  | "worker_not_qualified"
  | "operation_started"
  | "operation_closed"
  | "not_machine_operation"
  | "external_not_received";

export type PlanningResult = { ok: true; moved?: number } | { ok: false; error: PlanningError };

const RULES: readonly PlanningError[] = [
  "operator_required",
  "worker_not_qualified",
  "operation_started",
  "operation_closed",
  "not_machine_operation",
  "external_not_received",
];

/** Maps a database error of the planning functions to a result. */
export function planningError(error: { code?: string; message?: string }): PlanningError {
  const rule = RULES.find((r) => error.message === r);
  if (rule) return rule;
  if (error.message === "order_closed") return "operation_closed";
  switch (error.code) {
    case "42501":
      return "denied";
    case "P0002":
    case "PGRST116":
      return "not_found";
    case "22023":
    case "22P02":
    case "23514":
      return "invalid";
    default:
      return "unexpected";
  }
}
