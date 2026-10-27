import { z } from "zod";
import { isUnique, optionalDecimal, requiredText } from "@/lib/forms";
import { timeOfDay } from "./schemas";

// Calculation rules, pay settings, hourly rates, work calendars and holidays.
// Limits mirror migration 20261028090000.

const isoDate = z.iso.date();
const weekday = z.coerce.number().int().min(1).max(7);

export const calcRulesSchema = z
  .object({
    overtimeMode: z.enum(["daily", "weekly"]),
    weeklyHours: z.coerce.number().int().min(1).max(80),
    weeklyOvertimeWarningHours: z.coerce.number().int().min(0).max(80),
    overtimeStepMin: z.coerce.number().int().min(0).max(60),
    nightStart: timeOfDay,
    nightEnd: timeOfDay,
    weekendDays: z.array(weekday).max(7).refine(isUnique),
  })
  .refine((value) => value.nightStart !== value.nightEnd, { path: ["nightEnd"] });
export type CalcRulesInput = z.infer<typeof calcRulesSchema>;
export type CalcRulesFormValues = z.input<typeof calcRulesSchema>;
export const CALC_RULES_FIELDS = [
  "overtimeMode",
  "weeklyHours",
  "weeklyOvertimeWarningHours",
  "overtimeStepMin",
  "nightStart",
  "nightEnd",
  "weekendDays",
] as const;
export type CalcRulesField = (typeof CALC_RULES_FIELDS)[number];

const percent = optionalDecimal({ maxScale: 2, max: "500" }).pipe(z.string());
const money = optionalDecimal({ maxScale: 2, max: "99999999" });

export const paySettingsSchema = z.object({
  overtimePct: percent,
  nightPct: percent,
  weekendPct: percent,
  holidayPct: percent,
  /** Net KM per hour; "" = none. */
  defaultHourlyRate: money,
});
export type PaySettingsInput = z.infer<typeof paySettingsSchema>;
export type PaySettingsFormValues = z.input<typeof paySettingsSchema>;
export const PAY_SETTINGS_FIELDS = [
  "overtimePct",
  "nightPct",
  "weekendPct",
  "holidayPct",
  "defaultHourlyRate",
] as const;
export type PaySettingsField = (typeof PAY_SETTINGS_FIELDS)[number];

export const hourlyRateSchema = z.object({
  employeeId: z.uuid(),
  validFrom: isoDate,
  /** "" removes the rate of that date. */
  rate: money,
});

export const workCalendarSchema = z.object({
  employeeId: z.uuid(),
  /** false = the organization's weekend days. */
  ownWeekend: z.boolean(),
  weekendDays: z.array(weekday).max(7).refine(isUnique),
  holidayKeys: z
    .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
    .max(100)
    .refine(isUnique),
});

export const holidaySchema = z.object({
  name: requiredText(80),
  date: isoDate,
});

export const HOLIDAY_SCOPES = ["none", "all", "selected"] as const;
export type HolidayScope = (typeof HOLIDAY_SCOPES)[number];
export const holidayScopeSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  scope: z.enum(HOLIDAY_SCOPES),
});

export type PayrollActionResult =
  | { ok: true; count?: number }
  | { ok: false; error: "invalid" | "denied" | "not_found" | "unexpected" };
