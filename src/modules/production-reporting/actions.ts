"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DbError } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { nullableParam, numericParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import { listPendingCloseRequests, type PendingCloseRequest } from "./queries";
import {
  closeDecisionSchema,
  closeRequestSchema,
  cutSchema,
  pauseSchema,
  reportSchema,
  voidReportSchema,
  WORK_ERRORS,
  type WorkActionResult,
  type WorkError,
} from "./schemas";

// Floor actions (start, pause, report, finish, cutting) and closing orders.
// The database functions decide who may act on which operation (the worker
// who sees it, inspectors for inspections, orders.close.approve for closing);
// the permission-only actions are checked here first as well.

function fail(error: Exclude<WorkActionResult, { ok: true }>["error"]): WorkActionResult {
  return { ok: false, error };
}

function revalidateWorkScreens() {
  revalidatePath("/floor", "layout");
  revalidatePath("/orders", "layout");
  revalidatePath("/machines", "layout");
}

function mapError(error: DbError, context: string): WorkActionResult {
  const message = error?.message ?? "";
  const rule = WORK_ERRORS.find((key) => message === key || message.startsWith(`${key} `));
  if (rule) return fail(rule satisfies WorkError);
  switch (error?.code) {
    case "42501":
      return fail("denied");
    case "P0002":
      return fail("not_found");
    case "22023":
    case "23503":
    case "23514":
      return fail("invalid");
    default:
      console.error(`${context} failed`, error);
      return fail("unexpected");
  }
}

const id = z.uuid();

export async function startWorkAction(operationId: unknown): Promise<WorkActionResult> {
  await requireMember();
  const parsed = id.safeParse(operationId);
  if (!parsed.success) return fail("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("start_operation_work", { p_operation_id: parsed.data });
  if (error) return mapError(error, "start work");
  revalidateWorkScreens();
  return { ok: true };
}

export async function pauseWorkAction(
  operationId: unknown,
  input: unknown,
): Promise<WorkActionResult> {
  await requireMember();
  const parsedId = id.safeParse(operationId);
  const parsed = pauseSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return fail("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("pause_operation_work", {
    p_operation_id: parsedId.data,
    p_reason_id: parsed.data.reasonId,
    ...(parsed.data.notes ? { p_notes: parsed.data.notes } : {}),
  });
  if (error) return mapError(error, "pause work");
  revalidateWorkScreens();
  return { ok: true };
}

/** Good / scrap (in parts); with finish also ends the operation. */
export async function reportQuantityAction(
  operationId: unknown,
  input: unknown,
): Promise<WorkActionResult> {
  await requireMember();
  const parsedId = id.safeParse(operationId);
  const parsed = reportSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return fail("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("report_operation_quantity", {
    p_operation_id: parsedId.data,
    p_good: numericParam(parsed.data.good),
    p_scrap: numericParam(parsed.data.scrap),
    p_scrap_reason_id: nullableParam(parsed.data.scrapReasonId),
    p_notes: nullableParam(parsed.data.notes),
    p_idempotency_key: parsed.data.idempotencyKey,
    p_finish: parsed.data.finish,
  });
  if (error) return mapError(error, "report quantity");
  revalidateWorkScreens();
  return { ok: true };
}

/** "Ready for further processing" with the number of cut pieces. */
export async function finishCuttingAction(
  orderId: unknown,
  input: unknown,
): Promise<WorkActionResult> {
  await requireMember();
  const parsedId = id.safeParse(orderId);
  const parsed = cutSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return fail("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("finish_cutting", {
    p_order_id: parsedId.data,
    p_quantity: numericParam(parsed.data.quantity),
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return mapError(error, "finish cutting");
  revalidateWorkScreens();
  return { ok: true };
}

/** Inspector (or manager): close the order although fewer good pieces were made. */
export async function requestCloseAction(
  orderId: unknown,
  input: unknown,
): Promise<WorkActionResult> {
  const member = await requireMember();
  const parsedId = id.safeParse(orderId);
  const parsed = closeRequestSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return fail("invalid");
  const [inspector, manager] = await Promise.all([
    permitAction(member.organization.id, "quality.inspect"),
    permitAction(member.organization.id, "orders.manage"),
  ]);
  if (!inspector && !manager) return fail("denied");

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_order_close", {
    p_order_id: parsedId.data,
    p_reason: parsed.data.reason,
  });
  if (error) return mapError(error, "request close");
  revalidateWorkScreens();
  return { ok: true };
}

/** Head of production approves (order completed) or rejects (note required). */
export async function decideCloseAction(
  requestId: unknown,
  input: unknown,
): Promise<WorkActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "orders.close.approve"))) return fail("denied");
  const parsedId = id.safeParse(requestId);
  const parsed = closeDecisionSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("reject_note_required");

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_order_close", {
    p_request_id: parsedId.data,
    p_approve: parsed.data.approve,
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  if (error) return mapError(error, "decide close");
  revalidateWorkScreens();
  return { ok: true };
}

/** A wrong report is voided with a reason (it stays in the log). */
export async function voidReportAction(
  reportId: unknown,
  input: unknown,
): Promise<WorkActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "orders.manage"))) return fail("denied");
  const parsedId = id.safeParse(reportId);
  const parsed = voidReportSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("void_reason_required");

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_production_report", {
    p_report_id: parsedId.data,
    p_reason: parsed.data.reason,
  });
  if (error) return mapError(error, "void report");
  revalidateWorkScreens();
  return { ok: true };
}

/** For the approvers' notification bell (polled); empty without orders.close.approve. */
export async function pendingCloseRequestsAction(): Promise<PendingCloseRequest[]> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "orders.close.approve"))) return [];
  return listPendingCloseRequests(member.organization.id);
}
