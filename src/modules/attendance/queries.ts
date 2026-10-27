import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceSession, BoardEmployee, BoardRules } from "./rules";
import { OPERATION_WITHOUT_CLOCK_IN, type AttendanceRules } from "./schemas";

// Reads for the attendance screens. Access is decided by the database
// functions (own employee / attendance.read / attendance.manage).

export const sessionSchema = z
  .object({
    id: z.uuid(),
    employee_id: z.uuid(),
    shift_id: z.uuid().nullable(),
    shift_code: z.string().nullable(),
    shift_name: z.string().nullable(),
    work_date: z.string(),
    scheduled_start: z.string().nullable(),
    scheduled_end: z.string().nullable(),
    breaks: z.array(
      z.object({
        starts_at: z.string().nullable(),
        minutes: z.number().int(),
        paid: z.boolean(),
      }),
    ),
    clock_in_at: z.string(),
    clock_out_at: z.string().nullable(),
    clock_in_source: z.enum(["mobile", "kiosk", "operation", "manual"]),
    clock_out_source: z.enum(["mobile", "kiosk", "auto", "manual"]).nullable(),
  })
  .transform((row): AttendanceSession => ({
    id: row.id,
    employeeId: row.employee_id,
    shiftId: row.shift_id,
    shiftCode: row.shift_code,
    shiftName: row.shift_name,
    workDate: row.work_date,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    breaks: row.breaks.map((item) => ({
      startsAt: item.starts_at,
      minutes: item.minutes,
      paid: item.paid,
    })),
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    clockInSource: row.clock_in_source,
    clockOutSource: row.clock_out_source,
  }));

export type MyAttendance = {
  employeeId: string;
  open: AttendanceSession | null;
  sessions: AttendanceSession[];
  /** From the schedule (part B); null when nothing is planned. */
  todayShift: { code: string; name: string; startsAt: string; endsAt: string } | null;
  /** The shift a clock-in now would be counted in. */
  expectedShift: {
    code: string;
    name: string;
    scheduledStart: string;
    scheduledEnd: string;
  } | null;
};

const myAttendanceSchema = z.object({
  employee_id: z.uuid(),
  open: sessionSchema.nullable(),
  sessions: z.array(sessionSchema),
  today_shift: z
    .object({ code: z.string(), name: z.string(), starts_at: z.string(), ends_at: z.string() })
    .nullable(),
  expected_shift: z
    .object({
      code: z.string(),
      name: z.string(),
      scheduled_start: z.string(),
      scheduled_end: z.string(),
    })
    .nullable(),
});

/** The caller's attendance for work dates [from, to]; null when not an employee or module off. */
export async function getMyAttendance(
  organizationId: string,
  from: string,
  to: string,
): Promise<MyAttendance | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_attendance", {
    p_org_id: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  if (data === null) return null;
  const row = myAttendanceSchema.parse(data);
  return {
    employeeId: row.employee_id,
    open: row.open,
    sessions: row.sessions,
    todayShift: row.today_shift
      ? {
          code: row.today_shift.code,
          name: row.today_shift.name,
          startsAt: row.today_shift.starts_at.slice(0, 5),
          endsAt: row.today_shift.ends_at.slice(0, 5),
        }
      : null,
    expectedShift: row.expected_shift
      ? {
          code: row.expected_shift.code,
          name: row.expected_shift.name,
          scheduledStart: row.expected_shift.scheduled_start,
          scheduledEnd: row.expected_shift.scheduled_end,
        }
      : null,
  };
}

const boardSchema = z.object({
  employees: z.array(
    z.object({
      id: z.uuid(),
      number: z.number().int(),
      name: z.string(),
      department: z.string().nullable(),
      scheduled: z
        .object({
          shift_id: z.uuid(),
          code: z.string(),
          name: z.string(),
          scheduled_start: z.string(),
        })
        .nullable(),
      absence: z.string().nullable().optional(),
      sessions: z.array(sessionSchema),
    }),
  ),
  settings: z
    .object({ late_tolerance_min: z.number().int(), absent_after_min: z.number().int() })
    .nullable(),
});

export type AttendanceBoard = { employees: BoardEmployee[]; rules: BoardRules };

/** Everyone's attendance on a work date (attendance.read, else null). */
export async function getAttendanceBoard(
  organizationId: string,
  date: string,
): Promise<AttendanceBoard | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attendance_board", {
    p_org_id: organizationId,
    p_date: date,
  });
  if (error) throw error;
  if (data === null) return null;
  const row = boardSchema.parse(data);
  return {
    employees: row.employees.map((employee) => ({
      id: employee.id,
      number: employee.number,
      name: employee.name,
      department: employee.department,
      scheduled: employee.scheduled
        ? {
            shiftId: employee.scheduled.shift_id,
            code: employee.scheduled.code,
            name: employee.scheduled.name,
            scheduledStart: employee.scheduled.scheduled_start,
          }
        : null,
      absence: employee.absence ?? null,
      sessions: employee.sessions,
    })),
    rules: {
      lateToleranceMin: row.settings?.late_tolerance_min ?? 10,
      absentAfterMin: row.settings?.absent_after_min ?? 120,
    },
  };
}

export type AttendanceAlert = {
  id: string;
  kind: "auto_clock_out" | "auto_clock_in";
  employeeId: string;
  employeeName: string;
  sessionId: string;
  clockInAt: string;
  clockOutAt: string | null;
  createdAt: string;
};

/** Open alerts (attendance.manage, else none). */
export async function listAttendanceAlerts(organizationId: string): Promise<AttendanceAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_attendance_alerts", {
    p_org_id: organizationId,
  });
  if (error) throw error;
  return data.flatMap((row) => {
    const kind = z.enum(["auto_clock_out", "auto_clock_in"]).safeParse(row.kind);
    if (!kind.success) return [];
    return [
      {
        id: row.alert_id,
        kind: kind.data,
        employeeId: row.employee_id,
        employeeName: row.employee_name,
        sessionId: row.session_id,
        clockInAt: row.clock_in_at,
        clockOutAt: row.clock_out_at,
        createdAt: row.created_at,
      },
    ];
  });
}

export type ShiftBreakRow = {
  name: string | null;
  startsAt: string | null;
  minutes: number;
  paid: boolean;
};

export type ShiftRow = {
  id: string;
  name: string;
  code: string;
  startsAt: string;
  endsAt: string;
  color: string | null;
  archivedAt: string | null;
  breaks: ShiftBreakRow[];
};

/** Shift definitions with their breaks, active first (every member reads them). */
export async function listShifts(organizationId: string): Promise<ShiftRow[]> {
  const supabase = await createClient();
  const query = supabase
    .from("shifts")
    .select(
      "id, name, code, starts_at, ends_at, color, archived_at, shift_breaks (position, name, starts_at, duration_min, paid)",
    )
    .eq("organization_id", organizationId)
    .order("archived_at", { nullsFirst: true })
    .order("starts_at")
    .order("name");
  const { data, error } = await query;
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    startsAt: row.starts_at.slice(0, 5),
    endsAt: row.ends_at.slice(0, 5),
    color: row.color,
    archivedAt: row.archived_at,
    breaks: [...row.shift_breaks]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        name: item.name,
        startsAt: item.starts_at?.slice(0, 5) ?? null,
        minutes: item.duration_min,
        paid: item.paid,
      })),
  }));
}

export async function getAttendanceRules(organizationId: string): Promise<AttendanceRules> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_settings")
    .select(
      "early_window_min, late_tolerance_min, absent_after_min, auto_close_after_hours, operation_without_clock_in",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return {
    earlyWindowMin: data?.early_window_min ?? 60,
    lateToleranceMin: data?.late_tolerance_min ?? 10,
    absentAfterMin: data?.absent_after_min ?? 120,
    autoCloseAfterHours: data?.auto_close_after_hours ?? 22,
    operationWithoutClockIn: z
      .enum(OPERATION_WITHOUT_CLOCK_IN)
      .catch("auto_clock_in")
      .parse(data?.operation_without_clock_in),
  };
}
