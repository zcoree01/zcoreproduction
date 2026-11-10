import { z } from "zod";
import {
  MAX_DESCRIPTION,
  PROBLEM_CATEGORIES,
  PROBLEM_STATUSES,
} from "@/modules/support/problem-reports/schemas";

// Zcore side of problem reports: answers, states, scheduled support sessions.

export const platformReplySchema = z.object({
  reportId: z.uuid(),
  body: z.string().trim().min(1).max(MAX_DESCRIPTION),
  status: z.enum(PROBLEM_STATUSES).nullable(),
});

export const setReportStatusSchema = z.object({
  reportId: z.uuid(),
  status: z.enum(PROBLEM_STATUSES),
});

export const MIN_SESSION_MINUTES = 15;
export const MAX_SESSION_MINUTES = 480;
/** The database allows a start up to a minute in the past (clock skew). */
const START_SLACK_MS = 60_000;

export const scheduleSessionSchema = z.object({
  reportId: z.uuid(),
  /** UTC instant (ISO) of the start. */
  start: z.iso
    .datetime({ offset: true })
    .refine((value) => new Date(value).getTime() >= Date.now() - START_SLACK_MS),
  minutes: z.number().int().min(MIN_SESSION_MINUTES).max(MAX_SESSION_MINUTES),
  reason: z.string().trim().min(1).max(1000),
});

/** Query-string filters of the report list; unknown values are dropped. */
export const reportsFilterSchema = z.object({
  status: z.enum(PROBLEM_STATUSES).optional().catch(undefined),
  category: z.enum(PROBLEM_CATEGORIES).optional().catch(undefined),
  org: z.uuid().optional().catch(undefined),
});
export type ReportsFilter = z.infer<typeof reportsFilterSchema>;

export const REPORTS_TABS = ["reports", "support"] as const;
export type ReportsTab = (typeof REPORTS_TABS)[number];
export function reportsTab(value: string | undefined): ReportsTab {
  return value === "support" ? "support" : "reports";
}

export type ReportsError = "invalid" | "denied" | "not_found" | "support_open" | "unexpected";
