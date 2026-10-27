import { addDecimals, divideDecimal, fromScaled, multiplyDecimal, toScaled } from "@/lib/decimal";
import { zonedLocalToUtc } from "@/lib/timezone";
import { sessionTime, type AttendanceSession } from "./rules";
import { addDays, isoWeekday, mondayOf, type IsoWeekday } from "./schedule-rules";

// Monthly hours and net pay (pure, unit-tested, used on the server). All time
// arithmetic is on UTC instants; local windows (night, weekend days,
// holidays) are converted from the organization's time zone per calendar
// day, so DST nights have their real length. Money is a decimal string (no
// floats); net pay = hourly rate × hours + premiums for overtime, night,
// weekend and holiday minutes (they add up when they coincide).

export type PayRules = {
  overtimeMode: "daily" | "weekly";
  /** Weekly mode: worked hours per ISO week above this are overtime. */
  weeklyHours: number;
  /** Weekly overtime above this many hours raises a warning for the foreman. */
  weeklyOvertimeWarningHours: number;
  /** Overtime is rounded UP to this step (0 = exact minutes). */
  overtimeStepMin: number;
  /** "HH:MM"; the night window may cross midnight. */
  nightStart: string;
  nightEnd: string;
  /** Premiums in percent (decimal strings), e.g. "30". */
  overtimePct: string;
  nightPct: string;
  weekendPct: string;
  holidayPct: string;
};

export type EmployeeCalendar = {
  /** ISO weekdays that are the employee's weekend. */
  weekendDays: readonly IsoWeekday[];
  /** Non-working holidays of this employee ("YYYY-MM-DD"). */
  holidays: ReadonlySet<string>;
};

/** Net hourly rate valid from a date (decimal string). */
export type RateChange = { validFrom: string; rate: string };

export type SessionBreakdown = {
  sessionId: string;
  workDate: string;
  workedMin: number;
  regularMin: number;
  overtimeMin: number;
  nightMin: number;
  weekendMin: number;
  holidayMin: number;
};

const MINUTE = 60_000;

type Interval = { start: number; end: number };

function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function localDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function at(date: string, time: string, timeZone: string): number {
  return Date.parse(zonedLocalToUtc(`${date}T${time}`, timeZone));
}

/** Calendar days (local) touched by the interval. */
function daysOf(interval: Interval, timeZone: string): string[] {
  const days: string[] = [];
  const last = localDate(interval.end - 1, timeZone);
  for (let day = localDate(interval.start, timeZone); day <= last; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * The interval a session is paid for: from the shift's start (early arrival
 * is not paid) to the clock-out, minus unpaid breaks with a fixed time.
 */
function paidIntervals(session: AttendanceSession, now: Date): Interval[] {
  const clockIn = Date.parse(session.clockInAt);
  const clockOut = Math.max(
    clockIn,
    session.clockOutAt ? Date.parse(session.clockOutAt) : now.getTime(),
  );
  const start = session.scheduledStart
    ? Math.max(clockIn, Date.parse(session.scheduledStart))
    : clockIn;
  let parts: Interval[] = start < clockOut ? [{ start, end: clockOut }] : [];
  for (const item of session.breaks) {
    if (item.paid || !item.startsAt) continue;
    const breakStart = Date.parse(item.startsAt);
    const cut = { start: breakStart, end: breakStart + item.minutes * MINUTE };
    parts = parts.flatMap((part) => {
      if (overlap(part, cut) === 0) return [part];
      const pieces: Interval[] = [];
      if (cut.start > part.start) pieces.push({ start: part.start, end: cut.start });
      if (cut.end < part.end) pieces.push({ start: cut.end, end: part.end });
      return pieces;
    });
  }
  return parts;
}

function nightMinutes(parts: Interval[], rules: PayRules, timeZone: string): number {
  let total = 0;
  for (const part of parts) {
    for (const day of [addDays(daysOf(part, timeZone)[0] ?? "", -1), ...daysOf(part, timeZone)]) {
      const crosses = rules.nightEnd <= rules.nightStart;
      const window = {
        start: at(day, rules.nightStart, timeZone),
        end: at(crosses ? addDays(day, 1) : day, rules.nightEnd, timeZone),
      };
      total += overlap(part, window);
    }
  }
  return Math.floor(total / MINUTE);
}

function dayMinutes(parts: Interval[], timeZone: string, counts: (day: string) => boolean): number {
  let total = 0;
  for (const part of parts) {
    for (const day of daysOf(part, timeZone)) {
      if (!counts(day)) continue;
      total += overlap(part, {
        start: at(day, "00:00", timeZone),
        end: at(addDays(day, 1), "00:00", timeZone),
      });
    }
  }
  return Math.floor(total / MINUTE);
}

function roundUp(minutes: number, step: number): number {
  return step > 0 && minutes % step !== 0 ? minutes + step - (minutes % step) : minutes;
}

/**
 * Per-session breakdown. Daily mode: overtime is the time after the shift
 * (sessionTime). Weekly mode: worked minutes of an ISO week above the weekly
 * hours become overtime in the session where the limit is crossed and after
 * it. Overtime is rounded up to the step per session.
 */
export function sessionBreakdowns(
  sessions: readonly AttendanceSession[],
  rules: PayRules,
  calendar: EmployeeCalendar,
  timeZone: string,
  now: Date,
): SessionBreakdown[] {
  const ordered = [...sessions].sort((a, b) => a.clockInAt.localeCompare(b.clockInAt));
  const weekTotals = new Map<string, number>();
  return ordered.map((session) => {
    const time = sessionTime(session, now);
    const parts = paidIntervals(session, now);
    let regularMin = time.regularMinutes;
    let overtimeMin = time.overtimeMinutes;
    if (rules.overtimeMode === "weekly") {
      const worked = time.regularMinutes + time.overtimeMinutes;
      const week = mondayOf(session.workDate);
      const before = weekTotals.get(week) ?? 0;
      const limit = rules.weeklyHours * 60;
      overtimeMin = Math.max(0, before + worked - Math.max(limit, before));
      regularMin = worked - overtimeMin;
      weekTotals.set(week, before + worked);
    }
    overtimeMin = roundUp(overtimeMin, rules.overtimeStepMin);
    return {
      sessionId: session.id,
      workDate: session.workDate,
      workedMin: regularMin + overtimeMin,
      regularMin,
      overtimeMin,
      nightMin: nightMinutes(parts, rules, timeZone),
      weekendMin: dayMinutes(parts, timeZone, (day) =>
        calendar.weekendDays.includes(isoWeekday(day)),
      ),
      holidayMin: dayMinutes(parts, timeZone, (day) => calendar.holidays.has(day)),
    };
  });
}

/** Rate valid on `date` (the latest change on or before it), or null. */
export function rateOn(date: string, rates: readonly RateChange[]): string | null {
  let current: RateChange | null = null;
  for (const change of rates) {
    if (change.validFrom <= date && (!current || change.validFrom > current.validFrom))
      current = change;
  }
  return current?.rate ?? null;
}

function hours(minutes: number): string {
  return divideDecimal(String(minutes), "60", 6);
}

/** Net pay of one session; null without a rate. */
export function sessionPay(
  breakdown: SessionBreakdown,
  rate: string | null,
  rules: PayRules,
): string | null {
  if (rate === null) return null;
  const base = multiplyDecimal(rate, hours(breakdown.regularMin + breakdown.overtimeMin));
  const premium = (minutes: number, pct: string) =>
    divideDecimal(multiplyDecimal(multiplyDecimal(rate, hours(minutes)), pct), "100", 6);
  return addDecimals([
    base,
    premium(breakdown.overtimeMin, rules.overtimePct),
    premium(breakdown.nightMin, rules.nightPct),
    premium(breakdown.weekendMin, rules.weekendPct),
    premium(breakdown.holidayMin, rules.holidayPct),
  ]);
}

/** Money with 2 decimals (half away from zero). */
export function roundMoney(value: string): string {
  const cents = toScaled(divideDecimal(value, "1", 2), 2);
  return fromScaled(cents, 2);
}

export type MonthTotals = {
  days: number;
  workedMin: number;
  regularMin: number;
  overtimeMin: number;
  nightMin: number;
  weekendMin: number;
  holidayMin: number;
  /** Net pay; null when no session has a rate. */
  pay: string | null;
  /** Sessions without a rate (pay is incomplete). */
  unpricedSessions: number;
  /** Mondays of weeks whose overtime is above the warning limit. */
  overtimeWarnings: string[];
};

/**
 * Totals of the sessions whose work date is in [from, to]. `sessions` may
 * start earlier (weekly mode needs the whole first week).
 */
export function monthTotals(
  sessions: readonly AttendanceSession[],
  rules: PayRules,
  calendar: EmployeeCalendar,
  rates: readonly RateChange[],
  range: { from: string; to: string },
  timeZone: string,
  now: Date,
): MonthTotals {
  const breakdowns = sessionBreakdowns(sessions, rules, calendar, timeZone, now);
  const inRange = breakdowns.filter(
    (item) => item.workDate >= range.from && item.workDate <= range.to,
  );
  const totals: MonthTotals = {
    days: new Set(inRange.map((item) => item.workDate)).size,
    workedMin: 0,
    regularMin: 0,
    overtimeMin: 0,
    nightMin: 0,
    weekendMin: 0,
    holidayMin: 0,
    pay: null,
    unpricedSessions: 0,
    overtimeWarnings: [],
  };
  const pays: string[] = [];
  const weekOvertime = new Map<string, number>();
  for (const item of inRange) {
    totals.workedMin += item.workedMin;
    totals.regularMin += item.regularMin;
    totals.overtimeMin += item.overtimeMin;
    totals.nightMin += item.nightMin;
    totals.weekendMin += item.weekendMin;
    totals.holidayMin += item.holidayMin;
    const week = mondayOf(item.workDate);
    weekOvertime.set(week, (weekOvertime.get(week) ?? 0) + item.overtimeMin);
    const pay = sessionPay(item, rateOn(item.workDate, rates), rules);
    if (pay === null) totals.unpricedSessions += 1;
    else pays.push(pay);
  }
  totals.pay = pays.length > 0 ? roundMoney(addDecimals(pays)) : null;
  totals.overtimeWarnings = [...weekOvertime.entries()]
    .filter(([, minutes]) => minutes > rules.weeklyOvertimeWarningHours * 60)
    .map(([week]) => week)
    .sort();
  return totals;
}
