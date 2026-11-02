import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalText, optionalUuid, requiredText } from "@/lib/forms";

// Tool warehouse (D-035): catalog and movements in pieces.

export const TOOL_KINDS = ["tool", "insert"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const TOOL_MOVES = ["receipt", "issue", "return", "transfer", "scrap"] as const;
export type ToolMove = (typeof TOOL_MOVES)[number];

export const TOOL_ERRORS = [
  "tool_not_found",
  "negative_stock",
  "invalid_line",
  "reason_required",
  "location_not_found",
  "machine_not_found",
  "module_disabled",
] as const;
export type ToolError = (typeof TOOL_ERRORS)[number];

/** "" → null, otherwise a whole number in range. */
const optionalInt = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const parsed = /^\d+$/.test(value) ? Number(value) : NaN;
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({ code: "custom", message: "invalid number" });
        return z.NEVER;
      }
      return parsed;
    });

export const toolSchema = z
  .object({
    code: requiredText(40),
    name: requiredText(200),
    kind: z.enum(TOOL_KINDS),
    cuttingEdges: optionalInt(1, 20),
    homeMachineId: optionalUuid,
    minStock: optionalInt(0, 100000),
    supplier: optionalText(200),
    notes: optionalText(2000),
  })
  .refine((tool) => (tool.kind === "insert") === (tool.cuttingEdges !== null), {
    path: ["cuttingEdges"],
  });
export type ToolFormValues = z.input<typeof toolSchema>;
export const TOOL_FIELDS = [
  "code",
  "name",
  "kind",
  "cuttingEdges",
  "homeMachineId",
  "minStock",
  "supplier",
  "notes",
] as const;
export type ToolField = (typeof TOOL_FIELDS)[number];
export type ToolActionResult = ActionResult<ToolField, ToolError | "code_taken">;

export const moveToolSchema = z
  .object({
    idempotencyKey: z.uuid(),
    kind: z.enum(TOOL_MOVES),
    toolId: z.uuid(),
    quantity: optionalInt(1, 100000).refine((value) => value !== null),
    fromId: optionalUuid,
    toId: optionalUuid,
    machineId: optionalUuid,
    reason: optionalText(500),
  })
  .superRefine((move, ctx) => {
    const needsFrom = move.kind !== "receipt";
    const needsTo = move.kind === "receipt" || move.kind === "return" || move.kind === "transfer";
    if (needsFrom && !move.fromId)
      ctx.addIssue({ code: "custom", path: ["fromId"], message: "from" });
    if (needsTo && !move.toId) ctx.addIssue({ code: "custom", path: ["toId"], message: "to" });
    if (move.kind === "issue" && !move.machineId) {
      ctx.addIssue({ code: "custom", path: ["machineId"], message: "machine" });
    }
    if (move.kind === "scrap" && !move.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "reason" });
    }
  });
export const MOVE_TOOL_FIELDS = ["quantity", "fromId", "toId", "machineId", "reason"] as const;
export type MoveToolField = (typeof MOVE_TOOL_FIELDS)[number];
export type MoveToolResult = ActionResult<MoveToolField, ToolError>;

/** Insert edges: the edge the next change would use ("new" starts at 1). */
export function nextEdge(edgesUsed: number | null, cuttingEdges: number): number | null {
  if (edgesUsed === null) return null;
  return edgesUsed < cuttingEdges ? edgesUsed + 1 : null;
}
