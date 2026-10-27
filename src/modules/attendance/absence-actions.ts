"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DbError } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { nullableParam, numericParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import { zonedLocalToUtc } from "@/lib/timezone";
import { listPendingRequests, type PendingRequests } from "./absence-queries";
import {
  ABSENCE_DOCUMENT_TYPES,
  absenceDocumentSchema,
  absenceEntrySchema,
  absenceRequestSchema,
  correctionEntrySchema,
  correctionRequestSchema,
  decisionSchema,
  leaveDataSchema,
  leaveRulesSchema,
  REQUEST_ERRORS,
  type RequestActionResult,
} from "./absence-schemas";

// Absences, leave and corrections. Workers request for themselves (the
// database takes their employee from the session); managers enter, decide
// and set leave data. Who may decide what is checked again in the database
// (nobody decides their own requests; managers' requests need
// attendance.approve.managers).

const ABSENCE_DOCUMENTS_BUCKET = "absence-documents";

function fail(error: Exclude<RequestActionResult, { ok: true }>["error"]): RequestActionResult {
  return { ok: false, error };
}

function revalidateRequests() {
  revalidatePath("/attendance", "layout");
  revalidatePath("/floor/attendance");
}

function mapError(error: DbError, context: string): RequestActionResult {
  const message = error?.message ?? "";
  const rule = REQUEST_ERRORS.find((key) => message === key);
  if (rule) return fail(rule);
  switch (error?.code) {
    case "42501":
      return fail("denied");
    case "P0002":
      return fail("not_found");
    case "23P01":
      return fail("absence_overlaps");
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

// ---------------------------------------------------------------------------
// Worker (own employee)
// ---------------------------------------------------------------------------
export async function requestAbsenceAction(input: unknown): Promise<RequestActionResult> {
  const member = await requireMember();
  const parsed = absenceRequestSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_absence", {
    p_org_id: member.organization.id,
    p_kind: parsed.data.kind,
    p_start: parsed.data.startDate,
    p_end: parsed.data.endDate,
    p_note: nullableParam(parsed.data.note),
    p_reason: nullableParam(parsed.data.kind === "sick" ? parsed.data.reason : null),
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return mapError(error, "request absence");
  revalidateRequests();
  return { ok: true, id: data };
}

export async function requestCorrectionAction(input: unknown): Promise<RequestActionResult> {
  const member = await requireMember();
  const parsed = correctionRequestSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const timeZone = member.organization.timezone;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_correction", {
    p_org_id: member.organization.id,
    p_session_id: nullableParam(parsed.data.sessionId),
    p_clock_in_at: zonedLocalToUtc(parsed.data.clockIn, timeZone),
    p_clock_out_at: zonedLocalToUtc(parsed.data.clockOut, timeZone),
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return mapError(error, "request correction");
  revalidateRequests();
  return { ok: true, id: data };
}

export async function cancelMyAbsenceAction(absenceId: unknown): Promise<RequestActionResult> {
  await requireMember();
  const parsed = id.safeParse(absenceId);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_absence", { p_absence_id: parsed.data });
  if (error) return mapError(error, "cancel absence");
  revalidateRequests();
  return { ok: true };
}

export async function cancelMyCorrectionAction(
  correctionId: unknown,
): Promise<RequestActionResult> {
  await requireMember();
  const parsed = id.safeParse(correctionId);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_correction", { p_correction_id: parsed.data });
  if (error) return mapError(error, "cancel correction");
  revalidateRequests();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sick-note documents: prepare (signed upload URL) → browser upload → attach
// ---------------------------------------------------------------------------
export async function prepareAbsenceDocumentAction(
  input: unknown,
): Promise<{ ok: true; path: string; token: string } | Exclude<RequestActionResult, { ok: true }>> {
  const member = await requireMember();
  const parsed = absenceDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  // Visible = own absence or absences.read; the storage policy decides the upload.
  const absence = await supabase
    .from("absences")
    .select("id")
    .eq("organization_id", member.organization.id)
    .eq("id", parsed.data.absenceId)
    .maybeSingle();
  if (absence.error) throw absence.error;
  if (!absence.data) return { ok: false, error: "not_found" };

  const path = `${member.organization.id}/${parsed.data.absenceId}/${randomUUID()}.${ABSENCE_DOCUMENT_TYPES[parsed.data.contentType]}`;
  const { data, error } = await supabase.storage
    .from(ABSENCE_DOCUMENTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error) {
    console.error("absence document upload url failed", error);
    return { ok: false, error: "upload_failed" };
  }
  return { ok: true, path: data.path, token: data.token };
}

export async function attachAbsenceDocumentAction(
  input: unknown,
  path: unknown,
): Promise<RequestActionResult> {
  const member = await requireMember();
  const parsed = absenceDocumentSchema.safeParse(input);
  const parsedPath = z.string().max(500).safeParse(path);
  if (!parsed.success || !parsedPath.success) return fail("invalid");
  if (!parsedPath.data.startsWith(`${member.organization.id}/${parsed.data.absenceId}/`)) {
    return fail("invalid");
  }
  const supabase = await createClient();
  const info = await supabase.storage.from(ABSENCE_DOCUMENTS_BUCKET).info(parsedPath.data);
  if (info.error || !info.data.size) return fail("upload_failed");
  const contentType = absenceDocumentSchema.shape.contentType.safeParse(info.data.contentType);
  if (!contentType.success) return fail("invalid");

  const { error } = await supabase.rpc("attach_absence_document", {
    p_absence_id: parsed.data.absenceId,
    p_path: parsedPath.data,
    p_name: parsed.data.fileName,
    p_type: contentType.data,
    p_size: info.data.size,
  });
  if (error) return mapError(error, "attach document");
  revalidateRequests();
  return { ok: true };
}

/** 5-minute link to a sick note (own absence or absences.sensitive.read). */
export async function absenceDocumentUrlAction(
  absenceId: unknown,
): Promise<{ ok: true; url: string } | { ok: false; error: "not_found" }> {
  await requireMember();
  const parsed = id.safeParse(absenceId);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const supabase = await createClient();
  const details = await supabase
    .from("absence_details")
    .select("document_path")
    .eq("absence_id", parsed.data)
    .maybeSingle();
  if (details.error) throw details.error;
  if (!details.data?.document_path) return { ok: false, error: "not_found" };
  const signed = await supabase.storage
    .from(ABSENCE_DOCUMENTS_BUCKET)
    .createSignedUrl(details.data.document_path, 300);
  if (signed.error) return { ok: false, error: "not_found" };
  return { ok: true, url: signed.data.signedUrl };
}

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------
export async function enterAbsenceAction(input: unknown): Promise<RequestActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "absences.manage"))) return fail("denied");
  const parsed = absenceEntrySchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enter_absence", {
    p_org_id: member.organization.id,
    p_employee_id: parsed.data.employeeId,
    p_kind: parsed.data.kind,
    p_start: parsed.data.startDate,
    p_end: parsed.data.endDate,
    p_note: nullableParam(parsed.data.note),
    p_reason: nullableParam(parsed.data.kind === "sick" ? parsed.data.reason : null),
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return mapError(error, "enter absence");
  revalidateRequests();
  return { ok: true, id: data };
}

export async function decideAbsenceAction(
  absenceId: unknown,
  input: unknown,
): Promise<RequestActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "absences.manage"))) return fail("denied");
  const parsedId = id.safeParse(absenceId);
  const parsed = decisionSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("reject_note_required");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_absence", {
    p_absence_id: parsedId.data,
    p_approve: parsed.data.approve,
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  if (error) return mapError(error, "decide absence");
  revalidateRequests();
  return { ok: true };
}

export async function cancelAbsenceAction(
  absenceId: unknown,
  note: unknown,
): Promise<RequestActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "absences.manage"))) return fail("denied");
  const parsedId = id.safeParse(absenceId);
  const parsedNote = z
    .string()
    .trim()
    .max(500)
    .safeParse(note ?? "");
  if (!parsedId.success || !parsedNote.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_absence", {
    p_absence_id: parsedId.data,
    ...(parsedNote.data ? { p_note: parsedNote.data } : {}),
  });
  if (error) return mapError(error, "cancel absence");
  revalidateRequests();
  return { ok: true };
}

export async function enterCorrectionAction(input: unknown): Promise<RequestActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "attendance.manage"))) return fail("denied");
  const parsed = correctionEntrySchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const timeZone = member.organization.timezone;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enter_correction", {
    p_org_id: member.organization.id,
    p_employee_id: parsed.data.employeeId,
    p_session_id: nullableParam(parsed.data.sessionId),
    p_clock_in_at: zonedLocalToUtc(parsed.data.clockIn, timeZone),
    p_clock_out_at: zonedLocalToUtc(parsed.data.clockOut, timeZone),
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return mapError(error, "enter correction");
  revalidateRequests();
  return { ok: true, id: data };
}

export async function decideCorrectionAction(
  correctionId: unknown,
  input: unknown,
): Promise<RequestActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "attendance.manage"))) return fail("denied");
  const parsedId = id.safeParse(correctionId);
  const parsed = decisionSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("reject_note_required");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_correction", {
    p_correction_id: parsedId.data,
    p_approve: parsed.data.approve,
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  if (error) return mapError(error, "decide correction");
  revalidateRequests();
  return { ok: true };
}

export async function saveLeaveDataAction(input: unknown): Promise<RequestActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "absences.manage"))) return fail("denied");
  const parsed = leaveDataSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_leave_data", {
    p_employee_id: parsed.data.employeeId,
    p_year: parsed.data.year,
    p_hired_on: nullableParam(parsed.data.hiredOn),
    p_prior_service_months: parsed.data.priorServiceMonths,
    p_carried_over_days: numericParam(parsed.data.carriedOverDays),
    p_entitlement_override: nullableParam(numericParam(parsed.data.entitlementOverride)),
  });
  if (error) return mapError(error, "save leave data");
  revalidateRequests();
  return { ok: true };
}

export async function saveLeaveRulesAction(input: unknown): Promise<RequestActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "shifts.manage"))) return fail("denied");
  const parsed = leaveRulesSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("attendance_settings")
    .update(
      {
        leave_base_days: parsed.data.leaveBaseDays,
        leave_extra_days: parsed.data.leaveExtraDays,
        leave_extra_every_years: parsed.data.leaveExtraEveryYears,
        leave_max_days: parsed.data.leaveMaxDays,
        leave_probation_months: parsed.data.leaveProbationMonths,
      },
      { count: "exact" },
    )
    .eq("organization_id", member.organization.id);
  if (error) return mapError(error, "save leave rules");
  if (count === 0) return fail("denied");
  revalidatePath("/settings/shifts");
  revalidateRequests();
  return { ok: true };
}

/** For the notification bell (polled): requests the caller may decide. */
export async function pendingRequestsAction(): Promise<PendingRequests> {
  const member = await requireMember();
  const [absences, attendance] = await Promise.all([
    permitAction(member.organization.id, "absences.manage"),
    permitAction(member.organization.id, "attendance.manage"),
  ]);
  if (!absences && !attendance) return { absences: [], corrections: [] };
  return listPendingRequests(member.organization.id);
}
