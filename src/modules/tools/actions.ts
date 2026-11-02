"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  actionFail,
  dbErrorKind,
  invalidFields,
  violates,
  type DbError,
} from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { nullableParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import {
  MOVE_TOOL_FIELDS,
  moveToolSchema,
  TOOL_ERRORS,
  TOOL_FIELDS,
  toolSchema,
  type MoveToolField,
  type MoveToolResult,
  type ToolActionResult,
  type ToolError,
  type ToolField,
} from "./schemas";

// Tool warehouse (D-035): catalog and moves need tools.manage (checked here
// and by move_tool, which also forbids negative stock and writes the audit).

async function managerOrg(): Promise<string | null> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  return (await permitAction(organizationId, "tools.manage")) ? organizationId : null;
}

function revalidateTools() {
  revalidatePath("/inventory/tools");
}

function toolRule(error: DbError): ToolError | null {
  const message = error?.message ?? "";
  return TOOL_ERRORS.find((key) => message === key || message.startsWith(`${key} `)) ?? null;
}

export async function saveToolAction(id: unknown, input: unknown): Promise<ToolActionResult> {
  const fail = actionFail<ToolField, ToolError | "code_taken">;
  const organizationId = await managerOrg();
  if (!organizationId) return fail("denied");
  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = toolSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, TOOL_FIELDS));
  const tool = parsed.data;
  const row = {
    code: tool.code,
    name: tool.name,
    kind: tool.kind,
    cutting_edges: tool.cuttingEdges,
    home_machine_id: tool.homeMachineId,
    min_stock: tool.minStock,
    supplier: tool.supplier,
    notes: tool.notes,
  };
  const supabase = await createClient();
  const { data, error } = parsedId.data
    ? await supabase
        .from("tools")
        .update(row)
        .eq("organization_id", organizationId)
        .eq("id", parsedId.data)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("tools")
        .insert({ ...row, organization_id: organizationId })
        .select("id")
        .single();
  if (error) {
    if (violates(error, "tools_code_key")) return fail("code_taken", ["code"]);
    if (dbErrorKind(error) === "foreign_key") return fail("invalid", ["homeMachineId"]);
    if (dbErrorKind(error) === "denied") return fail("denied");
    console.error("tool save failed", error);
    return fail("unexpected");
  }
  if (!data) return fail("not_found");
  revalidateTools();
  return { ok: true, id: data.id };
}

export async function setToolArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<ToolActionResult> {
  const fail = actionFail<ToolField, ToolError | "code_taken">;
  const organizationId = await managerOrg();
  if (!organizationId) return fail("denied");
  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tools")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (violates(error, "tools_code_key")) return fail("code_taken", ["code"]);
    console.error("tool archive failed", error);
    return fail("unexpected");
  }
  if (!data) return fail("not_found");
  revalidateTools();
  return { ok: true, id: data.id };
}

export async function moveToolAction(input: unknown): Promise<MoveToolResult> {
  const fail = actionFail<MoveToolField, ToolError>;
  const organizationId = await managerOrg();
  if (!organizationId) return fail("denied");
  const parsed = moveToolSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, MOVE_TOOL_FIELDS));
  const m = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_tool", {
    p_org_id: organizationId,
    p_idempotency_key: m.idempotencyKey,
    p_kind: m.kind,
    p_tool_id: m.toolId,
    p_quantity: m.quantity ?? 0,
    p_from: nullableParam(m.fromId),
    p_to: nullableParam(m.toId),
    p_machine_id: nullableParam(m.machineId),
    p_reason: m.reason ?? "",
  });
  if (error) {
    const rule = toolRule(error);
    if (rule) return fail(rule);
    if (error.code === "42501") return fail("denied");
    console.error("tool move failed", error);
    return fail("unexpected");
  }
  revalidateTools();
  return { ok: true, id: m.toolId };
}
