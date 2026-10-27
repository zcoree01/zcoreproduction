import { z } from "zod";
import { isUnique, requiredText } from "@/lib/forms";
import { daysBetween, isoWeekday } from "./schedule-rules";

// Schedule, crews and rotations: shared by the forms and the server actions.
// Limits mirror migration 20261027100000.

const isoDate = z.iso.date();

export const crewSchema = z.object({
  name: requiredText(60),
  color: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  employeeIds: z.array(z.uuid()).max(500).refine(isUnique),
});
export type CrewInput = z.infer<typeof crewSchema>;
export type CrewFormValues = z.input<typeof crewSchema>;
export const CREW_FIELDS = ["name", "color", "employeeIds"] as const;
export type CrewField = (typeof CREW_FIELDS)[number];

export const MAX_CYCLE_DAYS = 56;

export const rotationSchema = z
  .object({
    name: requiredText(60),
    cycleDays: z.coerce.number().int().min(1).max(MAX_CYCLE_DAYS),
    /** Shift per day of the cycle ("" = day off); as long as the cycle. */
    days: z.array(z.union([z.literal(""), z.uuid()])).max(MAX_CYCLE_DAYS),
  })
  .refine((value) => value.days.length === value.cycleDays, { path: ["days"] })
  .refine((value) => value.days.some((day) => day !== ""), {
    path: ["days"],
    message: "no_working_days",
  });
export type RotationInput = z.infer<typeof rotationSchema>;
export type RotationFormValues = z.input<typeof rotationSchema>;
export const ROTATION_FIELDS = ["name", "cycleDays", "days"] as const;
export type RotationField = (typeof ROTATION_FIELDS)[number];

export const assignmentSchema = z
  .object({
    rotationId: z.uuid(),
    target: z.enum(["crew", "employee"]),
    targetId: z.uuid(),
    startDate: isoDate,
    endDate: z.union([z.literal(""), isoDate]).transform((value) => value || null),
  })
  .refine((value) => value.endDate === null || daysBetween(value.startDate, value.endDate) >= 0, {
    path: ["endDate"],
  });
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type AssignmentFormValues = z.input<typeof assignmentSchema>;
export const ASSIGNMENT_FIELDS = ["rotationId", "targetId", "startDate", "endDate"] as const;
export type AssignmentField = (typeof ASSIGNMENT_FIELDS)[number];

export const scheduleEntriesSchema = z
  .array(
    z.object({
      employeeId: z.uuid(),
      workDate: isoDate,
      /** null = day off (removes the entry). */
      shiftId: z.uuid().nullable(),
    }),
  )
  .min(1)
  .max(2000);
export type ScheduleEntry = z.infer<typeof scheduleEntriesSchema>[number];

/** Rotations are written for at most 62 days at a time. */
export const applyRangeSchema = z.object({ from: isoDate, to: isoDate }).refine((value) => {
  const days = daysBetween(value.from, value.to);
  return days >= 0 && days <= 61;
});

export const copyWeekSchema = z
  .object({ sourceMonday: isoDate, targetMonday: isoDate })
  .refine(
    (value) =>
      isoWeekday(value.sourceMonday) === 1 &&
      isoWeekday(value.targetMonday) === 1 &&
      value.sourceMonday !== value.targetMonday,
  );

export type ScheduleActionError = "invalid" | "denied" | "not_found" | "unexpected" | "offline";
