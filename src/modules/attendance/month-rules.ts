import type { AbsenceKind } from "./absence-schemas";
import type { EmployeeCalendar, RateChange } from "./pay-rules";
import { addDays, isoWeekday, type IsoWeekday } from "./schedule-rules";

// Helpers of the monthly overview (pure, unit-tested).

export type MonthAbsence = { kind: AbsenceKind; startDate: string; endDate: string | null };

/**
 * Working days of absences inside [from, to] per kind: the employee's
 * weekend days and non-working holidays are not counted; an open sick leave
 * runs until `today`.
 */
export function absenceDaysByKind(
  absences: readonly MonthAbsence[],
  range: { from: string; to: string },
  calendar: EmployeeCalendar,
  today: string,
): Partial<Record<AbsenceKind, number>> {
  const result: Partial<Record<AbsenceKind, number>> = {};
  for (const absence of absences) {
    const end = absence.endDate ?? (today < range.to ? today : range.to);
    const first = absence.startDate > range.from ? absence.startDate : range.from;
    const last = end < range.to ? end : range.to;
    for (let day = first; day <= last; day = addDays(day, 1)) {
      if (calendar.weekendDays.includes(isoWeekday(day)) || calendar.holidays.has(day)) continue;
      result[absence.kind] = (result[absence.kind] ?? 0) + 1;
    }
  }
  return result;
}

/** Weekend days from the database (smallint[]), defaulting to Saturday–Sunday. */
export function toWeekendDays(values: readonly number[] | null | undefined): IsoWeekday[] {
  const days = (values ?? [6, 7]).filter(
    (value): value is IsoWeekday => Number.isInteger(value) && value >= 1 && value <= 7,
  );
  return [...new Set(days)].sort();
}

/** Own rates, or the organization's default rate valid from the beginning. */
export function effectiveRates(
  own: readonly RateChange[],
  defaultRate: string | null,
): RateChange[] {
  if (own.length > 0) {
    return defaultRate === null
      ? [...own]
      : [{ validFrom: "0001-01-01", rate: defaultRate }, ...own];
  }
  return defaultRate === null ? [] : [{ validFrom: "0001-01-01", rate: defaultRate }];
}

/** Minutes as decimal hours with one decimal ("7,5"). */
export function hoursLabel(minutes: number): string {
  const tenths = Math.round(minutes / 6);
  return `${Math.floor(tenths / 10)},${tenths % 10}`;
}

/** "1234.5" → "1.234,50" (KM). */
export function formatMoney(value: string): string {
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value.startsWith("-") ? "-" : ""}${grouped},${fraction.padEnd(2, "0").slice(0, 2)}`;
}
