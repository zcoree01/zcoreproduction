import { addDays, daysBetween } from "@/modules/attendance/schedule-rules";
import { MAX_DAYS, reportFiltersSchema, type ReportFilters } from "./schemas";

// Report filters ↔ URL (D-043), pure.

export type PeriodPreset = "thisMonth" | "lastMonth" | "last30";

export function defaultPeriod(today: string, preset: PeriodPreset): { from: string; to: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case "thisMonth":
      return { from: monthStart, to: today };
    case "lastMonth": {
      const lastDay = addDays(monthStart, -1);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
    case "last30":
      return { from: addDays(today, -29), to: today };
  }
}

/**
 * Filters from search params; a missing, reversed or too long period falls
 * back to this month (invalid = the user's period was not usable).
 */
export function parseReportParams(
  params: Record<string, string | undefined>,
  today: string,
): { filters: ReportFilters; invalid: boolean } {
  const fallback = defaultPeriod(today, "thisMonth");
  const parsed = reportFiltersSchema.safeParse({
    ...params,
    from: params.from || fallback.from,
    to: params.to || fallback.to,
  });
  if (parsed.success) {
    const span = daysBetween(parsed.data.from, parsed.data.to);
    if (span >= 0 && span < MAX_DAYS) return { filters: parsed.data, invalid: false };
  }
  const rest = reportFiltersSchema.safeParse({ ...params, ...fallback });
  return {
    filters: rest.success ? rest.data : reportFiltersSchema.parse(fallback),
    invalid: Boolean(params.from || params.to),
  };
}

export function reportQuery(filters: ReportFilters): string {
  const query = new URLSearchParams({ tab: filters.tab, from: filters.from, to: filters.to });
  if (filters.tab === "production") query.set("group", filters.group);
  for (const key of ["machine", "employee", "customer", "order"] as const) {
    const value = filters[key];
    if (value) query.set(key, value);
  }
  return query.toString();
}
