"use server";

import { revalidatePath } from "next/cache";
import type { PermissionKey } from "@/lib/auth/permissions";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { numericParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import { zonedDate } from "@/lib/timezone";
import { addDays } from "@/modules/attendance/schedule-rules";
import { buildBoardInputs } from "./board";
import { getPlanningData } from "./queries";
import { rebalanceMachine } from "./rules";
import {
  downtimeSchema,
  externalResultSchema,
  orderPlanningSchema,
  planMovesSchema,
  planningError,
  rebalanceSchema,
  type PlanningResult,
} from "./schemas";

// Planning board writes (D-041): orders.manage (downtimes also with
// machines.manage), checked here and again by the database functions.

async function organizationWith(...permissions: PermissionKey[]) {
  const member = await requireMember();
  for (const permission of permissions) {
    if (await permitAction(member.organization.id, permission)) return member.organization;
  }
  return null;
}

function revalidatePlanning() {
  revalidatePath("/planning");
  revalidatePath("/orders", "layout");
  revalidatePath("/floor", "layout");
}

const DENIED: PlanningResult = { ok: false, error: "denied" };
const INVALID: PlanningResult = { ok: false, error: "invalid" };

export async function planMovesAction(input: unknown): Promise<PlanningResult> {
  const organization = await organizationWith("orders.manage");
  if (!organization) return DENIED;
  const parsed = planMovesSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("plan_operations", {
    p_org_id: organization.id,
    p_moves: parsed.data.map((move) => ({
      operation_id: move.operationId,
      machine_id: move.machineId,
      plan_day: move.planDay,
      position: move.position,
      ...(move.employeeIds ? { employee_ids: move.employeeIds } : {}),
    })),
  });
  if (error) return { ok: false, error: planningError(error) };
  revalidatePlanning();
  return { ok: true, moved: parsed.data.length };
}

/**
 * Moves work out of the overloaded days of the given machines, computed
 * again here from the current plan (the lowest priority first, then what
 * was added last).
 */
export async function rebalanceAction(input: unknown): Promise<PlanningResult> {
  const organization = await organizationWith("orders.manage");
  if (!organization) return DENIED;
  const parsed = rebalanceSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const today = zonedDate(new Date(), organization.timezone);
  const data = await getPlanningData(organization.id, today, addDays(today, 365));
  const inputs = buildBoardInputs(data);
  const moves = parsed.data.machineIds.flatMap((machineId) => {
    const machine = data.machines.find((m) => m.id === machineId);
    if (!machine) return [];
    return rebalanceMachine({
      machine,
      operations: [...inputs.plan.values()].filter(
        (op) => op.machineId === machineId && op.planDay !== null,
      ),
      calendar: inputs.calendar,
      today,
      workHoursPerDay: data.workHoursPerDay,
      basis: parsed.data.basis,
    });
  });
  if (moves.length === 0) return { ok: true, moved: 0 };
  const supabase = await createClient();
  const { error } = await supabase.rpc("plan_operations", {
    p_org_id: organization.id,
    p_moves: moves.map((move) => ({
      operation_id: move.operationId,
      plan_day: move.planDay,
      position: move.position,
      auto: true,
    })),
  });
  if (error) return { ok: false, error: planningError(error) };
  revalidatePlanning();
  return { ok: true, moved: moves.length };
}

export async function setOrderPlanningAction(input: unknown): Promise<PlanningResult> {
  const organization = await organizationWith("orders.manage");
  if (!organization) return DENIED;
  const parsed = orderPlanningSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_orders")
    .update({ priority: parsed.data.priority, due_date: parsed.data.dueDate })
    .eq("organization_id", organization.id)
    .eq("id", parsed.data.orderId)
    .select("id");
  if (error) return { ok: false, error: planningError(error) };
  if (data.length === 0) return { ok: false, error: "not_found" };
  revalidatePlanning();
  return { ok: true };
}

export async function saveDowntimeAction(input: unknown): Promise<PlanningResult> {
  const organization = await organizationWith("orders.manage", "machines.manage");
  if (!organization) return DENIED;
  const parsed = downtimeSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_machine_downtime", {
    p_org_id: organization.id,
    p_id: parsed.data.id as string,
    p_machine_id: parsed.data.machineId,
    p_starts_on: parsed.data.startsOn,
    p_ends_on: parsed.data.endsOn as string,
    p_reason_id: parsed.data.reasonId as string,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: planningError(error) };
  revalidatePlanning();
  revalidatePath("/machines");
  return { ok: true };
}

export async function archiveDowntimeAction(id: unknown): Promise<PlanningResult> {
  const organization = await organizationWith("orders.manage", "machines.manage");
  if (!organization) return DENIED;
  const parsed = downtimeSchema.shape.id.safeParse(id);
  if (!parsed.success || parsed.data === null) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_machine_downtime", {
    p_org_id: organization.id,
    p_id: parsed.data,
  });
  if (error) return { ok: false, error: planningError(error) };
  revalidatePlanning();
  return { ok: true };
}

export async function recordExternalResultAction(input: unknown): Promise<PlanningResult> {
  const organization = await organizationWith("orders.manage");
  if (!organization) return DENIED;
  const parsed = externalResultSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_external_result", {
    p_operation_id: parsed.data.operationId,
    p_days: parsed.data.days as number,
    p_cost: (parsed.data.cost === null ? null : numericParam(parsed.data.cost)) as number,
  });
  if (error) return { ok: false, error: planningError(error) };
  revalidatePath("/orders", "layout");
  return { ok: true };
}
