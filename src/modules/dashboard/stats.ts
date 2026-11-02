import { addDecimals, compareDecimals } from "@/lib/decimal";
import { zonedDate } from "@/lib/timezone";
import type { OrderStatus } from "@/modules/production-orders/status-rules";

// Pure figures for the dashboard widgets (D-037), unit-tested.

/** The `count` dates ending with `today` (YYYY-MM-DD), oldest first. */
export function lastDays(today: string, count: number): string[] {
  const end = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - (count - 1 - index));
    return day.toISOString().slice(0, 10);
  });
}

type Report = { at: string; good: string; scrap: string; voided: boolean };

/** Good and scrap of valid reports per day in the organization's time zone. */
export function dailyOutput(
  reports: readonly Report[],
  days: readonly string[],
  timeZone: string,
): { date: string; good: string; scrap: string }[] {
  const totals = new Map(days.map((date) => [date, { good: "0", scrap: "0" }]));
  for (const report of reports) {
    if (report.voided) continue;
    const total = totals.get(zonedDate(new Date(report.at), timeZone));
    if (!total) continue;
    total.good = addDecimals([total.good, report.good], 3);
    total.scrap = addDecimals([total.scrap, report.scrap], 3);
  }
  return days.map((date) => ({ date, ...(totals.get(date) ?? { good: "0", scrap: "0" }) }));
}

/** Scrap of valid reports per reason (null = no reason given), largest first. */
export function scrapByReason(
  reports: readonly (Report & { scrapReason: string | null })[],
): { reason: string | null; scrap: string }[] {
  const totals = new Map<string | null, string>();
  for (const report of reports) {
    if (report.voided || compareDecimals(report.scrap, "0") <= 0) continue;
    totals.set(
      report.scrapReason,
      addDecimals([totals.get(report.scrapReason) ?? "0", report.scrap], 3),
    );
  }
  return [...totals.entries()]
    .map(([reason, scrap]) => ({ reason, scrap }))
    .sort(
      (a, b) => compareDecimals(b.scrap, a.scrap) || (a.reason ?? "").localeCompare(b.reason ?? ""),
    );
}

const OVERVIEW_STATUSES = [
  "draft",
  "planned",
  "waiting_material",
  "cutting",
  "ready",
  "in_progress",
  "paused",
  "quality_check",
] as const satisfies readonly OrderStatus[];

/** Open orders per status (fixed order, zeros kept) and how many are late. */
export function ordersOverview(
  orders: readonly { status: OrderStatus; dueWarning: { kind: string } | null }[],
): {
  byStatus: { status: (typeof OVERVIEW_STATUSES)[number]; count: number }[];
  total: number;
  overdue: number;
  behind: number;
} {
  return {
    byStatus: OVERVIEW_STATUSES.map((status) => ({
      status,
      count: orders.filter((order) => order.status === status).length,
    })),
    total: orders.length,
    overdue: orders.filter((order) => order.dueWarning?.kind === "overdue").length,
    behind: orders.filter((order) => order.dueWarning?.kind === "behind").length,
  };
}

/** Largest value of a series as a decimal string ("0" for an empty one). */
export function seriesMax(values: readonly string[]): string {
  return values.reduce((max, value) => (compareDecimals(value, max) > 0 ? value : max), "0");
}
