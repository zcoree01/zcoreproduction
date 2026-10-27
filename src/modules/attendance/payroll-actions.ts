"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DbError } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { nullableParam, numericParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import {
  calcRulesSchema,
  holidayScopeSchema,
  holidaySchema,
  hourlyRateSchema,
  paySettingsSchema,
  workCalendarSchema,
  type PayrollActionResult,
} from "./payroll-schemas";

// Calculation rules (shifts.manage), premiums and hourly rates
// (payroll.manage), work calendars (attendance.manage) and holidays
// (shifts.manage). The database checks the same permissions again.

function fail(error: Exclude<PayrollActionResult, { ok: true }>["error"]): PayrollActionResult {
  return { ok: false, error };
}

function mapError(error: DbError, context: string): PayrollActionResult {
  switch (error?.code) {
    case "42501":
      return fail("denied");
    case "P0002":
      return fail("not_found");
    case "22023":
    case "23503":
    case "23505":
    case "23514":
      return fail("invalid");
    default:
      console.error(`${context} failed`, error);
      return fail("unexpected");
  }
}

function revalidatePayroll() {
  revalidatePath("/attendance", "layout");
  revalidatePath("/settings", "layout");
  revalidatePath("/floor/attendance");
}

async function orgWith(permission: Parameters<typeof permitAction>[1]): Promise<string | null> {
  const member = await requireMember();
  return (await permitAction(member.organization.id, permission)) ? member.organization.id : null;
}

export async function saveCalcRulesAction(input: unknown): Promise<PayrollActionResult> {
  const org = await orgWith("shifts.manage");
  if (!org) return fail("denied");
  const parsed = calcRulesSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("attendance_settings")
    .update(
      {
        overtime_mode: parsed.data.overtimeMode,
        weekly_hours: parsed.data.weeklyHours,
        weekly_overtime_warning_hours: parsed.data.weeklyOvertimeWarningHours,
        overtime_step_min: parsed.data.overtimeStepMin,
        night_start: parsed.data.nightStart,
        night_end: parsed.data.nightEnd,
        weekend_days: parsed.data.weekendDays,
      },
      { count: "exact" },
    )
    .eq("organization_id", org);
  if (error) return mapError(error, "save calc rules");
  if (count === 0) return fail("denied");
  revalidatePayroll();
  return { ok: true };
}

export async function savePaySettingsAction(input: unknown): Promise<PayrollActionResult> {
  const org = await orgWith("payroll.manage");
  if (!org) return fail("denied");
  const parsed = paySettingsSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_pay_settings", {
    p_org_id: org,
    p_overtime_pct: numericParam(parsed.data.overtimePct),
    p_night_pct: numericParam(parsed.data.nightPct),
    p_weekend_pct: numericParam(parsed.data.weekendPct),
    p_holiday_pct: numericParam(parsed.data.holidayPct),
    p_default_hourly_rate: nullableParam(numericParam(parsed.data.defaultHourlyRate)),
  });
  if (error) return mapError(error, "save pay settings");
  revalidatePayroll();
  return { ok: true };
}

export async function setHourlyRateAction(input: unknown): Promise<PayrollActionResult> {
  const org = await orgWith("payroll.manage");
  if (!org) return fail("denied");
  const parsed = hourlyRateSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_hourly_rate", {
    p_employee_id: parsed.data.employeeId,
    p_valid_from: parsed.data.validFrom,
    p_rate: nullableParam(numericParam(parsed.data.rate)),
  });
  if (error) return mapError(error, "set hourly rate");
  revalidatePayroll();
  return { ok: true };
}

export async function saveWorkCalendarAction(input: unknown): Promise<PayrollActionResult> {
  const org = await orgWith("attendance.manage");
  if (!org) return fail("denied");
  const parsed = workCalendarSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_work_calendar", {
    p_employee_id: parsed.data.employeeId,
    p_weekend_days: nullableParam(parsed.data.ownWeekend ? parsed.data.weekendDays : null),
    p_holiday_keys: parsed.data.holidayKeys,
  });
  if (error) return mapError(error, "save work calendar");
  revalidatePayroll();
  return { ok: true };
}

export async function importHolidaysAction(year: unknown): Promise<PayrollActionResult> {
  const org = await orgWith("shifts.manage");
  if (!org) return fail("denied");
  const parsed = z.coerce.number().int().min(2000).max(2100).safeParse(year);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_org_holidays", {
    p_org_id: org,
    p_year: parsed.data,
  });
  if (error) return mapError(error, "import holidays");
  revalidatePayroll();
  return { ok: true, count: data };
}

export async function saveHolidayAction(
  holidayId: string | null,
  input: unknown,
  archived = false,
): Promise<PayrollActionResult> {
  const org = await orgWith("shifts.manage");
  if (!org) return fail("denied");
  const parsedId = z.uuid().nullable().safeParse(holidayId);
  const parsed = holidaySchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_org_holiday", {
    p_org_id: org,
    p_id: nullableParam(parsedId.data),
    p_name: parsed.data.name,
    p_date: parsed.data.date,
    p_archived: archived,
  });
  if (error) return mapError(error, "save holiday");
  revalidatePayroll();
  return { ok: true };
}

export async function setHolidayScopeAction(input: unknown): Promise<PayrollActionResult> {
  const org = await orgWith("shifts.manage");
  if (!org) return fail("denied");
  const parsed = holidayScopeSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_holiday_scope", {
    p_org_id: org,
    p_key: parsed.data.key,
    p_scope: parsed.data.scope,
  });
  if (error) return mapError(error, "set holiday scope");
  revalidatePayroll();
  return { ok: true };
}
