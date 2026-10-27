import "server-only";
import { z } from "zod";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import {
  ABSENCE_KINDS,
  REQUEST_STATUSES,
  type AbsenceKind,
  type RequestStatus,
} from "./absence-schemas";
import type { LeaveData, LeaveRules } from "./leave-rules";

// Reads for absences, leave and corrections. Access is decided by the
// database (own employee / absences.read / attendance.read; sick-leave
// details only for absences.sensitive.read).

const kind = z.enum(ABSENCE_KINDS);
const status = z.enum(REQUEST_STATUSES);
const numberish = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => Number(decimalFromDb(value) ?? "0"));

const leaveSchema = z
  .object({
    hired_on: z.string().nullable(),
    prior_service_months: z.number().int(),
    carried_over_days: numberish,
    entitlement_override: z.union([z.number(), z.string()]).nullable(),
    used_days: numberish,
    pending_days: numberish,
    rules: z
      .object({
        base_days: z.number().int(),
        extra_days: z.number().int(),
        extra_every_years: z.number().int(),
        max_days: z.number().int(),
        probation_months: z.number().int(),
      })
      .nullable(),
  })
  .transform((row): { data: LeaveData; rules: LeaveRules } => ({
    data: {
      hiredOn: row.hired_on,
      priorServiceMonths: row.prior_service_months,
      carriedOverDays: row.carried_over_days,
      entitlementOverride:
        row.entitlement_override === null ? null : Number(row.entitlement_override),
      usedDays: row.used_days,
      pendingDays: row.pending_days,
    },
    rules: {
      baseDays: row.rules?.base_days ?? 20,
      extraDays: row.rules?.extra_days ?? 1,
      extraEveryYears: row.rules?.extra_every_years ?? 5,
      maxDays: row.rules?.max_days ?? 30,
      probationMonths: row.rules?.probation_months ?? 6,
    },
  }));

export type MyAbsence = {
  id: string;
  kind: AbsenceKind;
  startDate: string;
  /** null = open sick leave. */
  endDate: string | null;
  status: RequestStatus;
  note: string | null;
  decisionNote: string | null;
  workingDays: number;
  hasDocument: boolean;
  interruption: {
    status: "requested" | "approved" | "rejected";
    lastDay: string;
    decisionNote: string | null;
  } | null;
};

export type MyCorrection = {
  id: string;
  sessionId: string | null;
  clockInAt: string;
  clockOutAt: string;
  reason: string;
  status: RequestStatus;
  decisionNote: string | null;
};

export type MyRequests = {
  absences: MyAbsence[];
  corrections: MyCorrection[];
  leave: { data: LeaveData; rules: LeaveRules };
};

const myRequestsSchema = z.object({
  absences: z.array(
    z.object({
      id: z.uuid(),
      kind,
      start_date: z.string(),
      end_date: z.string().nullable(),
      status,
      note: z.string().nullable(),
      decision_note: z.string().nullable(),
      working_days: z.number().int(),
      has_document: z.boolean(),
      interruption_status: z.enum(["requested", "approved", "rejected"]).nullable().optional(),
      interruption_end_date: z.string().nullable().optional(),
      interruption_decision_note: z.string().nullable().optional(),
    }),
  ),
  corrections: z.array(
    z.object({
      id: z.uuid(),
      session_id: z.uuid().nullable(),
      clock_in_at: z.string(),
      clock_out_at: z.string(),
      reason: z.string(),
      status,
      decision_note: z.string().nullable(),
    }),
  ),
  leave: leaveSchema,
});

/** The caller's own requests and leave data; null when not an employee. */
export async function getMyRequests(
  organizationId: string,
  year: number,
): Promise<MyRequests | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_requests", {
    p_org_id: organizationId,
    p_year: year,
  });
  if (error) throw error;
  if (data === null) return null;
  const row = myRequestsSchema.parse(data);
  return {
    absences: row.absences.map((item) => ({
      id: item.id,
      kind: item.kind,
      startDate: item.start_date,
      endDate: item.end_date,
      status: item.status,
      note: item.note,
      decisionNote: item.decision_note,
      workingDays: item.working_days,
      hasDocument: item.has_document,
      interruption:
        item.interruption_status && item.interruption_end_date
          ? {
              status: item.interruption_status,
              lastDay: item.interruption_end_date,
              decisionNote: item.interruption_decision_note ?? null,
            }
          : null,
    })),
    corrections: row.corrections.map((item) => ({
      id: item.id,
      sessionId: item.session_id,
      clockInAt: item.clock_in_at,
      clockOutAt: item.clock_out_at,
      reason: item.reason,
      status: item.status,
      decisionNote: item.decision_note,
    })),
    leave: row.leave,
  };
}

export type PendingAbsence = {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: AbsenceKind;
  startDate: string;
  endDate: string | null;
  workingDays: number;
  note: string | null;
  requestedAt: string;
  hasDocument: boolean;
};

export type PendingCorrection = {
  id: string;
  employeeId: string;
  employeeName: string;
  sessionId: string | null;
  clockInAt: string;
  clockOutAt: string;
  originalIn: string | null;
  originalOut: string | null;
  reason: string;
  requestedAt: string;
};

export type PendingInterruption = {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: AbsenceKind;
  startDate: string;
  endDate: string;
  lastDay: string;
  note: string | null;
  requestedAt: string;
};

export type PendingRequests = {
  absences: PendingAbsence[];
  interruptions: PendingInterruption[];
  corrections: PendingCorrection[];
};

const pendingSchema = z.object({
  absences: z.array(
    z.object({
      id: z.uuid(),
      employee_id: z.uuid(),
      employee_name: z.string(),
      kind,
      start_date: z.string(),
      end_date: z.string().nullable(),
      working_days: z.number().int(),
      note: z.string().nullable(),
      requested_at: z.string(),
      has_document: z.boolean(),
    }),
  ),
  interruptions: z
    .array(
      z.object({
        id: z.uuid(),
        employee_id: z.uuid(),
        employee_name: z.string(),
        kind,
        start_date: z.string(),
        end_date: z.string(),
        last_day: z.string(),
        note: z.string().nullable(),
        requested_at: z.string(),
      }),
    )
    .default([]),
  corrections: z.array(
    z.object({
      id: z.uuid(),
      employee_id: z.uuid(),
      employee_name: z.string(),
      session_id: z.uuid().nullable(),
      clock_in_at: z.string(),
      clock_out_at: z.string(),
      original_in: z.string().nullable(),
      original_out: z.string().nullable(),
      reason: z.string(),
      requested_at: z.string(),
    }),
  ),
});

/** Requests the caller may decide (empty without the permissions). */
export async function listPendingRequests(organizationId: string): Promise<PendingRequests> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_requests", { p_org_id: organizationId });
  if (error) throw error;
  const row = pendingSchema.parse(data);
  return {
    absences: row.absences.map((item) => ({
      id: item.id,
      employeeId: item.employee_id,
      employeeName: item.employee_name,
      kind: item.kind,
      startDate: item.start_date,
      endDate: item.end_date,
      workingDays: item.working_days,
      note: item.note,
      requestedAt: item.requested_at,
      hasDocument: item.has_document,
    })),
    interruptions: row.interruptions.map((item) => ({
      id: item.id,
      employeeId: item.employee_id,
      employeeName: item.employee_name,
      kind: item.kind,
      startDate: item.start_date,
      endDate: item.end_date,
      lastDay: item.last_day,
      note: item.note,
      requestedAt: item.requested_at,
    })),
    corrections: row.corrections.map((item) => ({
      id: item.id,
      employeeId: item.employee_id,
      employeeName: item.employee_name,
      sessionId: item.session_id,
      clockInAt: item.clock_in_at,
      clockOutAt: item.clock_out_at,
      originalIn: item.original_in,
      originalOut: item.original_out,
      reason: item.reason,
      requestedAt: item.requested_at,
    })),
  };
}

export type AbsenceRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: AbsenceKind;
  startDate: string;
  /** null = open sick leave. */
  endDate: string | null;
  status: RequestStatus;
  workingDays: number;
  note: string | null;
  decisionNote: string | null;
  /** Only with absences.sensitive.read. */
  reason: string | null;
  hasDocument: boolean;
};

const rangeSchema = z.array(
  z.object({
    id: z.uuid(),
    employee_id: z.uuid(),
    employee_name: z.string(),
    kind,
    start_date: z.string(),
    end_date: z.string().nullable(),
    status,
    working_days: z.number().int(),
    note: z.string().nullable(),
    decision_note: z.string().nullable(),
    reason: z.string().nullable(),
    has_document: z.boolean(),
  }),
);

export async function listAbsences(
  organizationId: string,
  from: string,
  to: string,
): Promise<AbsenceRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("absences_range", {
    p_org_id: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  if (data === null) return null;
  return rangeSchema.parse(data).map((item) => ({
    id: item.id,
    employeeId: item.employee_id,
    employeeName: item.employee_name,
    kind: item.kind,
    startDate: item.start_date,
    endDate: item.end_date,
    status: item.status,
    workingDays: item.working_days,
    note: item.note,
    decisionNote: item.decision_note,
    reason: item.reason,
    hasDocument: item.has_document,
  }));
}

export type LeaveOverviewRow = {
  id: string;
  number: number;
  name: string;
  leave: { data: LeaveData; rules: LeaveRules };
};

export async function getLeaveOverview(
  organizationId: string,
  year: number,
): Promise<LeaveOverviewRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leave_overview", {
    p_org_id: organizationId,
    p_year: year,
  });
  if (error) throw error;
  if (data === null) return null;
  return z
    .array(
      z.object({ id: z.uuid(), number: z.number().int(), name: z.string(), leave: leaveSchema }),
    )
    .parse(data);
}

export async function getLeaveRules(organizationId: string): Promise<LeaveRules> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_settings")
    .select(
      "leave_base_days, leave_extra_days, leave_extra_every_years, leave_max_days, leave_probation_months",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return {
    baseDays: data?.leave_base_days ?? 20,
    extraDays: data?.leave_extra_days ?? 1,
    extraEveryYears: data?.leave_extra_every_years ?? 5,
    maxDays: data?.leave_max_days ?? 30,
    probationMonths: data?.leave_probation_months ?? 6,
  };
}
