import { addDecimals } from "@/lib/decimal";
import { downtimeByReason, scrapRatePercent } from "./rules";

// The foreman's day overview (pure, unit-tested): filters and totals over the
// rows returned by production_day.

type Located = {
  orderNumber: string;
  machineId: string | null;
  employeeId: string | null;
};

export type DayReport = Located & {
  id: string;
  at: string;
  orderId: string;
  operationCode: string;
  machineCode: string | null;
  employeeName: string | null;
  good: string;
  scrap: string;
  scrapReason: string | null;
  voided: boolean;
};

export type DayDowntime = Located & {
  id: string;
  startedAt: string;
  endedAt: string | null;
  /** Part of the downtime inside the day (open ones until now). */
  seconds: string;
  orderId: string;
  operationCode: string;
  machineCode: string | null;
  employeeName: string | null;
  reason: string;
  source: "pause" | "entry";
  notes: string | null;
};

export type DayWorking = Located & {
  startedAt: string;
  orderId: string;
  operationCode: string;
  operationName: string;
  machineCode: string | null;
  employeeName: string;
};

export type DayToolChange = Located & {
  id: string;
  at: string;
  orderId: string;
  operationCode: string;
  machineCode: string | null;
  employeeName: string | null;
  tool: string;
  insert: string | null;
  reason: string;
  minutes: string | null;
};

export type ProductionDay = {
  reports: DayReport[];
  downtime: DayDowntime[];
  working: DayWorking[];
  toolChanges: DayToolChange[];
};

export type DayFilters = {
  /** machines.id */
  machine: string | null;
  /** employees.id */
  worker: string | null;
  /** Part of the order number (case-insensitive). */
  order: string;
};

function matches(row: Located, filters: DayFilters): boolean {
  if (filters.machine && row.machineId !== filters.machine) return false;
  if (filters.worker && row.employeeId !== filters.worker) return false;
  const order = filters.order.trim().toLowerCase();
  return order === "" || row.orderNumber.toLowerCase().includes(order);
}

export function filterDay(day: ProductionDay, filters: DayFilters): ProductionDay {
  return {
    reports: day.reports.filter((row) => matches(row, filters)),
    downtime: day.downtime.filter((row) => matches(row, filters)),
    working: day.working.filter((row) => matches(row, filters)),
    toolChanges: day.toolChanges.filter((row) => matches(row, filters)),
  };
}

/**
 * Totals of the (filtered) day: good and scrap of valid reports (scrap never
 * counts as good), scrap rate, downtime inside the day by reason, open
 * downtime and tool changes.
 */
export function daySummary(day: ProductionDay) {
  const valid = day.reports.filter((row) => !row.voided);
  const good = addDecimals(
    valid.map((row) => row.good),
    3,
  );
  const scrap = addDecimals(
    valid.map((row) => row.scrap),
    3,
  );
  return {
    good,
    scrap,
    scrapRate: scrapRatePercent(good, scrap),
    reports: valid.length,
    downtimeSeconds: addDecimals(
      day.downtime.map((row) => row.seconds),
      3,
    ),
    downtimeByReason: downtimeByReason(day.downtime),
    openDowntime: day.downtime.filter((row) => row.endedAt === null).length,
    toolChanges: day.toolChanges.length,
  };
}

/** Workers that appear in the day (for the filter), by name. */
export function dayWorkers(day: ProductionDay): { id: string; name: string }[] {
  const names = new Map<string, string>();
  for (const row of [...day.reports, ...day.downtime, ...day.working, ...day.toolChanges]) {
    if (row.employeeId && row.employeeName) names.set(row.employeeId, row.employeeName);
  }
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
