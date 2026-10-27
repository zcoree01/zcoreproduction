import { addDays } from "./schedule-rules";

// Annual leave entitlement and balance (pure, unit-tested). Rules are set per
// organization (defaults: 20 days, +1 day for every 5 full years of service,
// at most 30 days; during the first 6 months one day per full month worked).
// Days are whole working days (Monday–Friday until holidays exist).

export type LeaveRules = {
  baseDays: number;
  extraDays: number;
  /** 0 = no extra days for service. */
  extraEveryYears: number;
  maxDays: number;
  probationMonths: number;
};

export type LeaveData = {
  hiredOn: string | null;
  priorServiceMonths: number;
  carriedOverDays: number;
  entitlementOverride: number | null;
  usedDays: number;
  pendingDays: number;
};

/** Full months from `from` to `to` (both included). */
export function fullMonths(from: string, to: string): number {
  const end = addDays(to, 1);
  const [ys, ms, ds] = from.split("-").map(Number) as [number, number, number];
  const [ye, me, de] = end.split("-").map(Number) as [number, number, number];
  const months = (ye - ys) * 12 + (me - ms) - (de < ds ? 1 : 0);
  return Math.max(0, months);
}

/** Days for a full year of service (base + extra for years of service, capped). */
export function fullYearDays(rules: LeaveRules, serviceMonths: number): number {
  const years = Math.floor(serviceMonths / 12);
  const extra =
    rules.extraEveryYears > 0 ? Math.floor(years / rules.extraEveryYears) * rules.extraDays : 0;
  return Math.min(rules.maxDays, rules.baseDays + extra);
}

/**
 * Entitlement for `year`:
 * - an override wins;
 * - years of service = earlier service + time in the company up to 1 January;
 * - while the worker has fewer than `probationMonths` months in the company at
 *   the end of the year: one day per full month worked in that year;
 * - hired during the year (after the first months): the proportional part,
 *   rounded to whole days;
 * - otherwise the full days.
 */
export function leaveEntitlement(year: number, rules: LeaveRules, data: LeaveData): number {
  if (data.entitlementOverride !== null) return data.entitlementOverride;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (!data.hiredOn) return fullYearDays(rules, data.priorServiceMonths);
  if (data.hiredOn > yearEnd) return 0;

  const serviceAtStart =
    data.priorServiceMonths +
    (data.hiredOn < yearStart ? fullMonths(data.hiredOn, addDays(yearStart, -1)) : 0);
  const full = fullYearDays(rules, serviceAtStart);
  const firstDay = data.hiredOn > yearStart ? data.hiredOn : yearStart;
  const monthsInYear = fullMonths(firstDay, yearEnd);
  const monthsInCompany = fullMonths(data.hiredOn, yearEnd);

  if (monthsInCompany < rules.probationMonths) return Math.min(monthsInYear, full);
  if (data.hiredOn > yearStart) return Math.round((full * monthsInYear) / 12);
  return full;
}

export type LeaveBalance = {
  entitlement: number;
  carriedOver: number;
  used: number;
  pending: number;
  /** Entitlement + carried over − used − requested. */
  available: number;
};

export function leaveBalance(year: number, rules: LeaveRules, data: LeaveData): LeaveBalance {
  const entitlement = leaveEntitlement(year, rules, data);
  return {
    entitlement,
    carriedOver: data.carriedOverDays,
    used: data.usedDays,
    pending: data.pendingDays,
    available: entitlement + data.carriedOverDays - data.usedDays - data.pendingDays,
  };
}

/** Monday–Friday days in [from, to] (mirrors private.working_days). */
export function workingDays(from: string, to: string): number {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}
