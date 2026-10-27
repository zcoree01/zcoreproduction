import "server-only";
import { mondayOf } from "./schedule-rules";
import { monthRange } from "./rules";
import { absenceDaysByKind, effectiveRates } from "./month-rules";
import { monthTotals, type MonthTotals } from "./pay-rules";
import {
  getCalcSettings,
  getMonthData,
  type CalcSettings,
  type MonthEmployee,
} from "./payroll-queries";
import type { AbsenceKind } from "./absence-schemas";

// The monthly overview (also used by the exports): per employee hours,
// premiums, absences and net pay, computed on the server from the month's
// sessions (weekly mode also loads the days of the first week before the
// month).

export type MonthRow = {
  employee: MonthEmployee;
  totals: MonthTotals;
  absenceDays: Partial<Record<AbsenceKind, number>>;
};

export type MonthOverview = {
  month: string;
  from: string;
  to: string;
  settings: CalcSettings;
  /** Pay is shown (payroll.read). */
  withPay: boolean;
  rows: MonthRow[];
};

export async function getMonthOverview(
  organizationId: string,
  month: string,
  timeZone: string,
  today: string,
  now: Date,
): Promise<MonthOverview | null> {
  const { from, to } = monthRange(`${month}-01`);
  const sessionsFrom = mondayOf(from);
  const [settings, data] = await Promise.all([
    getCalcSettings(organizationId),
    getMonthData(organizationId, sessionsFrom, from, to),
  ]);
  if (!data) return null;
  const withPay = data.employees.some((employee) => employee.rates !== null);
  const rows = data.employees.map((employee) => {
    const calendar = { weekendDays: employee.weekendDays, holidays: new Set(employee.holidays) };
    const rates = employee.rates === null ? [] : effectiveRates(employee.rates, data.defaultRate);
    const totals = monthTotals(
      employee.sessions,
      settings,
      calendar,
      rates,
      { from, to },
      timeZone,
      now,
    );
    return {
      employee,
      totals: withPay ? totals : { ...totals, pay: null },
      absenceDays: absenceDaysByKind(employee.absences, { from, to }, calendar, today),
    };
  });
  return { month, from, to, settings, withPay, rows };
}
