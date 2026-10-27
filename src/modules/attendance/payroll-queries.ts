import "server-only";
import { z } from "zod";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import { ABSENCE_KINDS } from "./absence-schemas";
import type { MonthAbsence } from "./month-rules";
import { toWeekendDays } from "./month-rules";
import type { PayRules, RateChange } from "./pay-rules";
import { sessionSchema } from "./queries";
import type { AttendanceSession } from "./rules";
import type { IsoWeekday } from "./schedule-rules";

// Reads for calculation rules, pay and the monthly overview. Rates are only
// returned with payroll.read (the database decides); a worker gets their own.

const decimal = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => decimalFromDb(value));

export type CalcSettings = PayRules & { weekendDays: IsoWeekday[] };

/** Calculation rules and premiums of the organization (every member reads them). */
export async function getCalcSettings(organizationId: string): Promise<CalcSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_settings")
    .select(
      "overtime_mode, weekly_hours, weekly_overtime_warning_hours, overtime_step_min, night_start, night_end, weekend_days, overtime_pct, night_pct, weekend_pct, holiday_pct",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return {
    overtimeMode: data?.overtime_mode === "weekly" ? "weekly" : "daily",
    weeklyHours: data?.weekly_hours ?? 40,
    weeklyOvertimeWarningHours: data?.weekly_overtime_warning_hours ?? 10,
    overtimeStepMin: data?.overtime_step_min ?? 15,
    nightStart: (data?.night_start ?? "22:00").slice(0, 5),
    nightEnd: (data?.night_end ?? "06:00").slice(0, 5),
    weekendDays: toWeekendDays(data?.weekend_days),
    overtimePct: decimalFromDb(data?.overtime_pct) ?? "30",
    nightPct: decimalFromDb(data?.night_pct) ?? "30",
    weekendPct: decimalFromDb(data?.weekend_pct) ?? "30",
    holidayPct: decimalFromDb(data?.holiday_pct) ?? "50",
  };
}

/** Default net hourly rate (payroll.read, else null). */
export async function getDefaultRate(organizationId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payroll_settings")
    .select("default_hourly_rate")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return decimalFromDb(data?.default_hourly_rate);
}

const rateSchema = z.object({ valid_from: z.string(), rate: decimal });
const toRates = (rows: z.infer<typeof rateSchema>[]): RateChange[] =>
  rows.flatMap((row) => (row.rate === null ? [] : [{ validFrom: row.valid_from, rate: row.rate }]));

export type MonthEmployee = {
  id: string;
  number: number;
  name: string;
  department: string | null;
  weekendDays: IsoWeekday[];
  ownWeekend: boolean;
  holidayKeys: string[];
  holidays: string[];
  /** Null without payroll.read. */
  rates: RateChange[] | null;
  sessions: AttendanceSession[];
  absences: MonthAbsence[];
};

const monthSchema = z.object({
  employees: z.array(
    z.object({
      id: z.uuid(),
      number: z.number().int(),
      name: z.string(),
      department: z.string().nullable(),
      weekend_days: z.array(z.number()).nullable(),
      own_weekend: z.boolean(),
      holiday_keys: z.array(z.string()),
      holidays: z.array(z.string()),
      rates: z.array(rateSchema).nullable(),
      sessions: z.array(sessionSchema),
      absences: z.array(
        z.object({
          kind: z.enum(ABSENCE_KINDS),
          start_date: z.string(),
          end_date: z.string().nullable(),
        }),
      ),
    }),
  ),
  default_rate: decimal,
});

export type MonthData = { employees: MonthEmployee[]; defaultRate: string | null };

/** Everything for the monthly overview; null without attendance.read. */
export async function getMonthData(
  organizationId: string,
  sessionsFrom: string,
  from: string,
  to: string,
): Promise<MonthData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attendance_month", {
    p_org_id: organizationId,
    p_sessions_from: sessionsFrom,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  if (data === null) return null;
  const row = monthSchema.parse(data);
  return {
    defaultRate: row.default_rate,
    employees: row.employees.map((employee) => ({
      id: employee.id,
      number: employee.number,
      name: employee.name,
      department: employee.department,
      weekendDays: toWeekendDays(employee.weekend_days),
      ownWeekend: employee.own_weekend,
      holidayKeys: employee.holiday_keys,
      holidays: employee.holidays,
      rates: employee.rates === null ? null : toRates(employee.rates),
      sessions: employee.sessions,
      absences: employee.absences.map((absence) => ({
        kind: absence.kind,
        startDate: absence.start_date,
        endDate: absence.end_date,
      })),
    })),
  };
}

export type MyPayInputs = {
  rates: RateChange[];
  defaultRate: string | null;
  weekendDays: IsoWeekday[];
  holidays: string[];
};

export async function getMyPayInputs(
  organizationId: string,
  from: string,
  to: string,
): Promise<MyPayInputs | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_pay_inputs", {
    p_org_id: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  if (data === null) return null;
  const row = z
    .object({
      rates: z.array(rateSchema),
      default_rate: decimal,
      weekend_days: z.array(z.number()).nullable(),
      holidays: z.array(z.string()),
    })
    .parse(data);
  return {
    rates: toRates(row.rates),
    defaultRate: row.default_rate,
    weekendDays: toWeekendDays(row.weekend_days),
    holidays: row.holidays,
  };
}

export type OrgHoliday = {
  id: string;
  key: string;
  date: string;
  name: string;
  kind: "state" | "islamic" | "catholic" | "orthodox" | "other";
  confirmed: boolean;
  archived: boolean;
};

export type HolidayList = { holidays: OrgHoliday[]; scopes: Record<string, "all" | "selected"> };

export async function listOrgHolidays(organizationId: string, year: number): Promise<HolidayList> {
  const supabase = await createClient();
  const [holidays, rules] = await Promise.all([
    supabase
      .from("org_holidays")
      .select("id, key, date, name, kind, confirmed, archived_at")
      .eq("organization_id", organizationId)
      .gte("date", `${year}-01-01`)
      .lte("date", `${year}-12-31`)
      .order("date"),
    supabase.from("org_holiday_rules").select("key, scope").eq("organization_id", organizationId),
  ]);
  if (holidays.error) throw holidays.error;
  if (rules.error) throw rules.error;
  const kind = z.enum(["state", "islamic", "catholic", "orthodox", "other"]);
  return {
    holidays: holidays.data.map((row) => ({
      id: row.id,
      key: row.key,
      date: row.date,
      name: row.name,
      kind: kind.catch("other").parse(row.kind),
      confirmed: row.confirmed,
      archived: row.archived_at !== null,
    })),
    scopes: Object.fromEntries(
      rules.data.flatMap((row) =>
        row.scope === "all" || row.scope === "selected" ? [[row.key, row.scope]] : [],
      ),
    ),
  };
}

/** Holiday keys that are non-working for selected employees (with a name for the form). */
export async function listSelectableHolidays(
  organizationId: string,
): Promise<{ key: string; name: string }[]> {
  const supabase = await createClient();
  const [rules, holidays] = await Promise.all([
    supabase
      .from("org_holiday_rules")
      .select("key")
      .eq("organization_id", organizationId)
      .eq("scope", "selected"),
    supabase
      .from("org_holidays")
      .select("key, name, date")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("date", { ascending: false }),
  ]);
  if (rules.error) throw rules.error;
  if (holidays.error) throw holidays.error;
  const keys = new Set(rules.data.map((row) => row.key));
  const names = new Map<string, string>();
  for (const row of holidays.data)
    if (keys.has(row.key) && !names.has(row.key)) names.set(row.key, row.name);
  return [...names.entries()]
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "bs"));
}
