// Calendar dates ("YYYY-MM-DD") for the schedule (pure, unit-tested). Work
// dates are calendar days in the organization's time zone, so the arithmetic
// is done on UTC midnights and never crosses a DST change.

const DAY = 86_400_000;

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY);
}

/** Days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY);
}

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const WEEKDAYS: readonly IsoWeekday[] = [7, 1, 2, 3, 4, 5, 6];

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): IsoWeekday {
  return WEEKDAYS[new Date(toUtc(date)).getUTCDay()] ?? 7;
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Every date from `from` to `to`, both included. */
export function dateRange(from: string, to: string): string[] {
  const count = daysBetween(from, to);
  return Array.from({ length: Math.max(0, count + 1) }, (_, index) => addDays(from, index));
}

/** 0-based day of a rotation's cycle on `date` (null before the start). */
export function rotationDay(date: string, startDate: string, cycleDays: number): number | null {
  const offset = daysBetween(startDate, date);
  if (offset < 0 || cycleDays < 1) return null;
  return offset % cycleDays;
}

export type ScheduleView = "week" | "month";

/** Visible range of the schedule grid around `date`. */
export function scheduleRange(view: ScheduleView, date: string): { from: string; to: string } {
  if (view === "week") {
    const from = mondayOf(date);
    return { from, to: addDays(from, 6) };
  }
  const from = `${date.slice(0, 8)}01`;
  const next = `${addDays(from, 31).slice(0, 8)}01`;
  return { from, to: addDays(next, -1) };
}

/** Start of the previous / next page of the grid. */
export function shiftRange(view: ScheduleView, date: string, direction: -1 | 1): string {
  if (view === "week") return addDays(mondayOf(date), 7 * direction);
  const first = `${date.slice(0, 8)}01`;
  return direction === 1
    ? `${addDays(first, 31).slice(0, 8)}01`
    : `${addDays(first, -1).slice(0, 8)}01`;
}

export function isWeekend(date: string): boolean {
  return isoWeekday(date) >= 6;
}
