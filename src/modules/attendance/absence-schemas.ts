import { z } from "zod";
import { optionalDecimal, optionalText, requiredText } from "@/lib/forms";
import { daysBetween } from "./schedule-rules";

// Absences, leave and corrections: shared by the forms and the server
// actions. Limits mirror migration 20261027120000.

export const ABSENCE_KINDS = ["vacation", "sick", "paid_leave", "unpaid_leave", "day_off"] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];
export const REQUEST_STATUSES = ["requested", "approved", "rejected", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const isoDate = z.iso.date();
/** <input type="datetime-local"> value in the organization's time zone. */
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const period = <T extends { startDate: string; endDate: string }>(value: T) => {
  const days = daysBetween(value.startDate, value.endDate);
  return days >= 0 && days <= 366;
};

const absenceFields = {
  kind: z.enum(ABSENCE_KINDS),
  startDate: isoDate,
  endDate: isoDate,
  /** Visible to managers. */
  note: optionalText(500),
  /** Sensitive (sick leave): only the employee, the director and HR see it. */
  reason: optionalText(500),
  idempotencyKey: z.uuid(),
};

export const absenceRequestSchema = z
  .object(absenceFields)
  .refine(period, { path: ["endDate"], message: "invalid_period" });
export type AbsenceRequestInput = z.infer<typeof absenceRequestSchema>;
export type AbsenceRequestFormValues = z.input<typeof absenceRequestSchema>;
export const ABSENCE_FIELDS = ["kind", "startDate", "endDate", "note", "reason"] as const;
export type AbsenceField = (typeof ABSENCE_FIELDS)[number];

export const absenceEntrySchema = z
  .object({ ...absenceFields, employeeId: z.uuid() })
  .refine(period, { path: ["endDate"], message: "invalid_period" });
export type AbsenceEntryInput = z.infer<typeof absenceEntrySchema>;
export type AbsenceEntryFormValues = z.input<typeof absenceEntrySchema>;
export const ABSENCE_ENTRY_FIELDS = [...ABSENCE_FIELDS, "employeeId"] as const;
export type AbsenceEntryField = (typeof ABSENCE_ENTRY_FIELDS)[number];

export const decisionSchema = z
  .object({ approve: z.boolean(), note: optionalText(500) })
  .refine((value) => value.approve || value.note !== null, {
    path: ["note"],
    message: "note required",
  });

const correctionFields = {
  /** "" = add a missing session. */
  sessionId: z.union([z.literal(""), z.uuid()]).transform((value) => value || null),
  clockIn: localDateTime,
  clockOut: localDateTime,
  reason: requiredText(500),
  idempotencyKey: z.uuid(),
};

const correctionPeriod = <T extends { clockIn: string; clockOut: string }>(value: T) => {
  const minutes =
    (Date.parse(`${value.clockOut}:00Z`) - Date.parse(`${value.clockIn}:00Z`)) / 60_000;
  return minutes > 0 && minutes <= 24 * 60;
};

export const correctionRequestSchema = z
  .object(correctionFields)
  .refine(correctionPeriod, { path: ["clockOut"], message: "invalid_period" });
export type CorrectionRequestInput = z.infer<typeof correctionRequestSchema>;
export type CorrectionRequestFormValues = z.input<typeof correctionRequestSchema>;
export const CORRECTION_FIELDS = ["clockIn", "clockOut", "reason"] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

export const correctionEntrySchema = z
  .object({ ...correctionFields, employeeId: z.uuid() })
  .refine(correctionPeriod, { path: ["clockOut"], message: "invalid_period" });
export type CorrectionEntryInput = z.infer<typeof correctionEntrySchema>;

const days = optionalDecimal({ maxScale: 1, max: "100" });

export const leaveDataSchema = z.object({
  employeeId: z.uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  hiredOn: z.union([z.literal(""), isoDate]).transform((value) => value || null),
  priorServiceMonths: z.coerce.number().int().min(0).max(720),
  carriedOverDays: days.transform((value) => value ?? "0"),
  /** "" = computed from the rules. */
  entitlementOverride: days,
});
export type LeaveDataInput = z.infer<typeof leaveDataSchema>;
export type LeaveDataFormValues = z.input<typeof leaveDataSchema>;
export const LEAVE_DATA_FIELDS = [
  "hiredOn",
  "priorServiceMonths",
  "carriedOverDays",
  "entitlementOverride",
] as const;
export type LeaveDataField = (typeof LEAVE_DATA_FIELDS)[number];

export const leaveRulesSchema = z.object({
  leaveBaseDays: z.coerce.number().int().min(0).max(60),
  leaveExtraDays: z.coerce.number().int().min(0).max(10),
  leaveExtraEveryYears: z.coerce.number().int().min(0).max(50),
  leaveMaxDays: z.coerce.number().int().min(0).max(60),
  leaveProbationMonths: z.coerce.number().int().min(0).max(24),
});
export type LeaveRulesInput = z.infer<typeof leaveRulesSchema>;
export type LeaveRulesFormValues = z.input<typeof leaveRulesSchema>;
export const LEAVE_RULES_FIELDS = [
  "leaveBaseDays",
  "leaveExtraDays",
  "leaveExtraEveryYears",
  "leaveMaxDays",
  "leaveProbationMonths",
] as const;
export type LeaveRulesField = (typeof LEAVE_RULES_FIELDS)[number];

export const ABSENCE_DOCUMENT_TYPES = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
} as const;
export const ABSENCE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const absenceDocumentSchema = z.object({
  absenceId: z.uuid(),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(Object.keys(ABSENCE_DOCUMENT_TYPES) as [keyof typeof ABSENCE_DOCUMENT_TYPES]),
  size: z.number().int().min(1).max(ABSENCE_DOCUMENT_MAX_BYTES),
});

/** Business-rule errors raised by the functions with a fixed message. */
export const REQUEST_ERRORS = [
  "not_an_employee",
  "absence_overlaps",
  "invalid_period",
  "already_decided",
  "reject_note_required",
  "correction_in_future",
  "correction_overlaps",
  "correction_pending",
  "reason_required",
  "session_changed",
] as const;
export type RequestError = (typeof REQUEST_ERRORS)[number];
export type RequestActionResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      error: RequestError | "invalid" | "denied" | "not_found" | "unexpected" | "upload_failed";
    };
