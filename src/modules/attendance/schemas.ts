import { z } from "zod";
import { optionalText, requiredText } from "@/lib/forms";
import { shiftProblem } from "./rules";

// Shared by the forms and the server actions. Limits mirror the CHECKs and
// function rules in migration 20261026140000.

/** "HH:MM" (24 h). */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const breakSchema = z.object({
  name: optionalText(60),
  /** "" = taken any time during the shift. */
  startsAt: z.union([z.literal(""), timeOfDay]).transform((value) => value || null),
  minutes: z.coerce.number().int().min(1).max(240),
  paid: z.boolean(),
});

export const shiftSchema = z
  .object({
    name: requiredText(60),
    code: requiredText(10),
    startsAt: timeOfDay,
    endsAt: timeOfDay,
    color: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
    breaks: z.array(breakSchema).max(20),
  })
  .superRefine((value, ctx) => {
    const problem = shiftProblem(value.startsAt, value.endsAt, value.breaks);
    if (!problem) return;
    ctx.addIssue({
      code: "custom",
      message: problem.problem,
      path: problem.problem === "same_times" ? ["endsAt"] : ["breaks"],
    });
  });
export type ShiftInput = z.infer<typeof shiftSchema>;
export type ShiftFormValues = z.input<typeof shiftSchema>;
export const SHIFT_FIELDS = ["name", "code", "startsAt", "endsAt", "color", "breaks"] as const;
export type ShiftField = (typeof SHIFT_FIELDS)[number];

export const OPERATION_WITHOUT_CLOCK_IN = ["auto_clock_in", "warn", "block"] as const;
export type OperationWithoutClockIn = (typeof OPERATION_WITHOUT_CLOCK_IN)[number];

export const attendanceRulesSchema = z.object({
  earlyWindowMin: z.coerce.number().int().min(0).max(240),
  lateToleranceMin: z.coerce.number().int().min(0).max(120),
  absentAfterMin: z.coerce.number().int().min(1).max(720),
  autoCloseAfterHours: z.coerce.number().int().min(12).max(48),
  operationWithoutClockIn: z.enum(OPERATION_WITHOUT_CLOCK_IN),
});
export type AttendanceRules = z.infer<typeof attendanceRulesSchema>;
export type AttendanceRulesFormValues = z.input<typeof attendanceRulesSchema>;
export const RULES_FIELDS = [
  "earlyWindowMin",
  "lateToleranceMin",
  "absentAfterMin",
  "autoCloseAfterHours",
  "operationWithoutClockIn",
] as const;
export type RulesField = (typeof RULES_FIELDS)[number];

export const clockSchema = z.object({
  direction: z.enum(["in", "out"]),
  /** Generated when the screen opens; a resend returns the first result. */
  idempotencyKey: z.uuid(),
});

export const resolveAlertSchema = z.object({ note: optionalText(500) });

/** Business-rule errors raised by the attendance functions with a fixed message. */
export const CLOCK_ERRORS = [
  "not_an_employee",
  "module_disabled",
  "already_clocked_in",
  "not_clocked_in",
] as const;
export type ClockError = (typeof CLOCK_ERRORS)[number];
export type ClockActionResult =
  { ok: true } | { ok: false; error: ClockError | "invalid" | "denied" | "unexpected" | "offline" };

export const SHIFT_ERRORS = [
  "invalid_shift_times",
  "breaks_too_long",
  "break_outside_shift",
] as const;
