"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, invalidFields, type ActionResult, type DbError } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { nullableParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import { listAttendanceAlerts, type AttendanceAlert } from "./queries";
import {
  attendanceRulesSchema,
  CLOCK_ERRORS,
  clockSchema,
  resolveAlertSchema,
  RULES_FIELDS,
  SHIFT_ERRORS,
  SHIFT_FIELDS,
  shiftSchema,
  type ClockActionResult,
  type RulesField,
  type ShiftField,
} from "./schemas";

// Clock-in / clock-out (the caller's own employee; the database records the
// time and recognises the shift), shift definitions and rules
// (shifts.manage), alerts (attendance.manage).

function revalidateAttendance() {
  revalidatePath("/floor", "layout");
  revalidatePath("/attendance");
}

function clockFail(error: Exclude<ClockActionResult, { ok: true }>["error"]): ClockActionResult {
  return { ok: false, error };
}

export async function clockAction(input: unknown): Promise<ClockActionResult> {
  const member = await requireMember();
  const parsed = clockSchema.safeParse(input);
  if (!parsed.success) return clockFail("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc(parsed.data.direction === "in" ? "clock_in" : "clock_out", {
    p_org_id: member.organization.id,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    const rule = CLOCK_ERRORS.find((key) => error.message === key);
    if (rule) return clockFail(rule);
    if (error.code === "42501") return clockFail("denied");
    console.error("clock failed", error);
    return clockFail("unexpected");
  }
  revalidateAttendance();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Shifts (shifts.manage)
// ---------------------------------------------------------------------------
type ShiftError = (typeof SHIFT_ERRORS)[number] | "duplicate_name" | "duplicate_code";
export type ShiftActionResult = ActionResult<ShiftField, ShiftError>;

function shiftDbError(error: DbError): ShiftActionResult {
  const message = error?.message ?? "";
  const rule = SHIFT_ERRORS.find((key) => message === key);
  if (rule) return actionFail(rule, rule === "invalid_shift_times" ? ["endsAt"] : ["breaks"]);
  if (error?.code === "23505" && message.includes("shifts_name_active")) {
    return actionFail("duplicate_name", ["name"]);
  }
  if (error?.code === "23505" && message.includes("shifts_code_active")) {
    return actionFail("duplicate_code", ["code"]);
  }
  if (error?.code === "42501") return actionFail("denied");
  if (error?.code === "P0002") return actionFail("not_found");
  console.error("save shift failed", error);
  return actionFail("unexpected");
}

export async function saveShiftAction(
  shiftId: string | null,
  input: unknown,
): Promise<ShiftActionResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "shifts.manage"))) {
    return actionFail("denied");
  }
  const parsedId = z.uuid().nullable().safeParse(shiftId);
  const parsed = shiftSchema.safeParse(input);
  if (!parsedId.success) return actionFail("invalid");
  if (!parsed.success) return actionFail("invalid", invalidFields(parsed.error, SHIFT_FIELDS));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_shift", {
    p_org_id: member.organization.id,
    p_id: nullableParam(parsedId.data),
    p_name: parsed.data.name,
    p_code: parsed.data.code,
    p_starts_at: parsed.data.startsAt,
    p_ends_at: parsed.data.endsAt,
    p_color: parsed.data.color,
    p_breaks: parsed.data.breaks.map((item) => ({
      name: item.name,
      starts_at: item.startsAt,
      minutes: item.minutes,
      paid: item.paid,
    })),
  });
  if (error) return shiftDbError(error);
  revalidatePath("/settings/shifts");
  return { ok: true, id: data };
}

export async function setShiftArchivedAction(
  shiftId: unknown,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "denied" | "not_found" | "unexpected" }> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "shifts.manage"))) {
    return { ok: false, error: "denied" };
  }
  const parsed = z.uuid().safeParse(shiftId);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_shift_archived", {
    p_shift_id: parsed.data,
    p_archived: archived,
  });
  if (error) {
    if (error.code === "P0002") return { ok: false, error: "not_found" };
    console.error("archive shift failed", error);
    return { ok: false, error: "unexpected" };
  }
  revalidatePath("/settings/shifts");
  return { ok: true };
}

export async function saveAttendanceRulesAction(
  input: unknown,
): Promise<
  { ok: true } | { ok: false; error: "invalid" | "denied" | "unexpected"; fields: RulesField[] }
> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "shifts.manage"))) {
    return { ok: false, error: "denied", fields: [] };
  }
  const parsed = attendanceRulesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fields: invalidFields(parsed.error, RULES_FIELDS) };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("attendance_settings")
    .update(
      {
        early_window_min: parsed.data.earlyWindowMin,
        late_tolerance_min: parsed.data.lateToleranceMin,
        absent_after_min: parsed.data.absentAfterMin,
        auto_close_after_hours: parsed.data.autoCloseAfterHours,
        operation_without_clock_in: parsed.data.operationWithoutClockIn,
      },
      { count: "exact" },
    )
    .eq("organization_id", member.organization.id);
  if (error || count === 0) {
    if (error) console.error("attendance rules update failed", error);
    return { ok: false, error: count === 0 ? "denied" : "unexpected", fields: [] };
  }
  revalidatePath("/settings/shifts");
  revalidateAttendance();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Alerts (attendance.manage)
// ---------------------------------------------------------------------------
export async function resolveAlertAction(
  alertId: unknown,
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "denied" | "not_found" | "unexpected" }> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "attendance.manage"))) {
    return { ok: false, error: "denied" };
  }
  const parsedId = z.uuid().safeParse(alertId);
  const parsed = resolveAlertSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_attendance_alert", {
    p_alert_id: parsedId.data,
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  if (error) {
    if (error.code === "P0002") return { ok: false, error: "not_found" };
    if (error.code === "42501") return { ok: false, error: "denied" };
    console.error("resolve alert failed", error);
    return { ok: false, error: "unexpected" };
  }
  revalidateAttendance();
  return { ok: true };
}

/** For the notification bell (polled); empty without attendance.manage. */
export async function pendingAttendanceAlertsAction(): Promise<AttendanceAlert[]> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "attendance.manage"))) return [];
  return listAttendanceAlerts(member.organization.id);
}
