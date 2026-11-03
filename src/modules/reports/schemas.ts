import { z } from "zod";

// Report filters from the URL (D-043). Dates are local calendar days.

export const REPORT_TABS = ["production", "machines", "orders", "costs"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

export const PRODUCTION_GROUPS = ["day", "machine", "employee", "order", "customer"] as const;
export type ProductionGroup = (typeof PRODUCTION_GROUPS)[number];

/** Longest period one report covers (the database allows 367 days). */
export const MAX_DAYS = 366;

const day = z.iso.date();
const optionalId = z.uuid().optional().catch(undefined);

export const reportFiltersSchema = z.object({
  tab: z.enum(REPORT_TABS).catch("production"),
  from: day,
  to: day,
  group: z.enum(PRODUCTION_GROUPS).catch("day"),
  machine: optionalId,
  employee: optionalId,
  customer: optionalId,
  order: optionalId,
});

export type ReportFilters = z.infer<typeof reportFiltersSchema>;
