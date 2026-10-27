// Attendance rules (pure, unit-tested). All arithmetic is on UTC instants, so
// a shift in the night of a daylight-saving change has its real length; the
// shift's scheduled start/end and breaks are snapshotted on the session when
// the worker clocks in. Minutes are whole numbers (seconds are truncated at
// the end of each calculation).

export type SessionBreak = {
  /** Fixed start (ISO, UTC) or null = taken any time during the shift. */
  startsAt: string | null;
  minutes: number;
  paid: boolean;
};

export type ClockInSource = "mobile" | "kiosk" | "operation" | "manual";
export type ClockOutSource = "mobile" | "kiosk" | "auto" | "manual";

export type AttendanceSession = {
  id: string;
  employeeId: string;
  shiftId: string | null;
  shiftCode: string | null;
  shiftName: string | null;
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  breaks: SessionBreak[];
  clockInAt: string;
  clockOutAt: string | null;
  clockInSource: ClockInSource;
  clockOutSource: ClockOutSource | null;
};

export type SessionTime = {
  /** Clock-in to clock-out (or now). */
  presentMinutes: number;
  /** Counted regular time: within the shift (plus making up a late start), minus unpaid breaks. */
  regularMinutes: number;
  /** After the shift's end (and the made-up lateness), rounded down to the step. */
  overtimeMinutes: number;
  unpaidBreakMinutes: number;
  /** Minutes after the scheduled start (0 when on time or without a shift). */
  lateMinutes: number;
  open: boolean;
};

const MINUTE = 60_000;

function ms(iso: string): number {
  return Date.parse(iso);
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Time of one session.
 * - Without a shift every present minute is regular.
 * - Early arrival is not counted; counting starts at the shift's start.
 * - A late worker may make up the lateness after the shift's end as regular
 *   time; only what goes beyond that is overtime.
 * - Unpaid breaks with a fixed time are deducted where they overlap the
 *   counted time; flexible ones when at least half of the shift was worked.
 * - Overtime is rounded down to `overtimeStepMin` (0 = exact minutes).
 */
export function sessionTime(
  session: AttendanceSession,
  now: Date,
  options: { overtimeStepMin?: number } = {},
): SessionTime {
  const clockIn = ms(session.clockInAt);
  const clockOut = Math.max(clockIn, session.clockOutAt ? ms(session.clockOutAt) : now.getTime());
  const presentMinutes = Math.floor((clockOut - clockIn) / MINUTE);
  const open = session.clockOutAt === null;

  if (!session.scheduledStart || !session.scheduledEnd) {
    return {
      presentMinutes,
      regularMinutes: presentMinutes,
      overtimeMinutes: 0,
      unpaidBreakMinutes: 0,
      lateMinutes: 0,
      open,
    };
  }

  const start = ms(session.scheduledStart);
  const end = ms(session.scheduledEnd);
  const late = Math.max(0, clockIn - start);
  const countedStart = Math.max(clockIn, start);
  const regularEnd = Math.max(countedStart, Math.min(clockOut, end + late));
  const span = regularEnd - countedStart;

  let unpaid = 0;
  for (const item of session.breaks) {
    if (item.paid) continue;
    const length = item.minutes * MINUTE;
    if (item.startsAt) {
      const breakStart = ms(item.startsAt);
      unpaid += overlap(countedStart, regularEnd, breakStart, breakStart + length);
    } else if (span * 2 >= end - start) {
      unpaid += Math.min(length, span);
    }
  }
  unpaid = Math.min(unpaid, span);

  const overtimeRaw = Math.max(0, clockOut - Math.max(end + late, countedStart));
  const step = options.overtimeStepMin ?? 0;
  const overtimeMinutes = Math.floor(overtimeRaw / MINUTE);

  return {
    presentMinutes,
    regularMinutes: Math.floor((span - unpaid) / MINUTE),
    overtimeMinutes: step > 0 ? overtimeMinutes - (overtimeMinutes % step) : overtimeMinutes,
    unpaidBreakMinutes: Math.floor(unpaid / MINUTE),
    lateMinutes: Math.floor(late / MINUTE),
    open,
  };
}

export type TimeTotals = {
  presentMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  days: number;
};

/** Totals over sessions (days = distinct work dates). */
export function totalTime(
  sessions: readonly AttendanceSession[],
  now: Date,
  options: { overtimeStepMin?: number } = {},
): TimeTotals {
  const totals: TimeTotals = { presentMinutes: 0, regularMinutes: 0, overtimeMinutes: 0, days: 0 };
  const dates = new Set<string>();
  for (const session of sessions) {
    const time = sessionTime(session, now, options);
    totals.presentMinutes += time.presentMinutes;
    totals.regularMinutes += time.regularMinutes;
    totals.overtimeMinutes += time.overtimeMinutes;
    dates.add(session.workDate);
  }
  totals.days = dates.size;
  return totals;
}

// ---------------------------------------------------------------------------
// Shift definitions
// ---------------------------------------------------------------------------

/** "HH:MM" → minutes after midnight. */
export function timeToMinutes(time: string): number {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function minutesToTime(total: number): string {
  const value = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Nominal length (a day without a DST change); an end not after the start is on the next day. */
export function shiftLengthMinutes(startsAt: string, endsAt: string): number {
  const start = timeToMinutes(startsAt);
  const end = timeToMinutes(endsAt);
  return end > start ? end - start : end + 1440 - start;
}

export function crossesMidnight(startsAt: string, endsAt: string): boolean {
  return timeToMinutes(endsAt) <= timeToMinutes(startsAt);
}

export type ShiftBreakDef = { startsAt: string | null; minutes: number; paid: boolean };

/** Paid working minutes of a shift: length minus unpaid breaks. */
export function shiftWorkMinutes(
  startsAt: string,
  endsAt: string,
  breaks: readonly ShiftBreakDef[],
): number {
  const unpaid = breaks.filter((item) => !item.paid).reduce((sum, item) => sum + item.minutes, 0);
  return shiftLengthMinutes(startsAt, endsAt) - unpaid;
}

/**
 * End time that keeps `workMinutes` of paid work when unpaid breaks are added
 * on top (e.g. 06:00 + 8 h + 30 min unpaid → 14:30).
 */
export function endExtendedForBreaks(
  startsAt: string,
  workMinutes: number,
  breaks: readonly ShiftBreakDef[],
): string {
  const unpaid = breaks.filter((item) => !item.paid).reduce((sum, item) => sum + item.minutes, 0);
  return minutesToTime(timeToMinutes(startsAt) + workMinutes + unpaid);
}

export type ShiftProblem = "same_times" | "breaks_too_long" | "break_outside_shift";

/** Mirrors the checks of save_shift(). */
export function shiftProblem(
  startsAt: string,
  endsAt: string,
  breaks: readonly ShiftBreakDef[],
): { problem: ShiftProblem; index?: number } | null {
  if (timeToMinutes(startsAt) === timeToMinutes(endsAt)) return { problem: "same_times" };
  const length = shiftLengthMinutes(startsAt, endsAt);
  let total = 0;
  for (const [index, item] of breaks.entries()) {
    total += item.minutes;
    if (item.startsAt !== null) {
      const offset = (timeToMinutes(item.startsAt) - timeToMinutes(startsAt) + 1440) % 1440;
      if (offset + item.minutes > length) return { problem: "break_outside_shift", index };
    }
  }
  if (total >= length) return { problem: "breaks_too_long" };
  return null;
}

// ---------------------------------------------------------------------------
// Foreman's board
// ---------------------------------------------------------------------------

export type BoardStatus =
  /** Clocked in now. */
  | "present"
  /** Was in today, has clocked out. */
  | "left"
  /** Scheduled, start + tolerance passed, not here yet. */
  | "late"
  /** Scheduled, not clocked in until start + absent limit. */
  | "absent"
  /** Scheduled, start (+ tolerance) not reached yet. */
  | "expected"
  /** Not scheduled and not here. */
  /** Approved absence (vacation, sick leave, …) and not here. */
  | "on_leave"
  | "off";

export type BoardEmployee = {
  id: string;
  number: number;
  name: string;
  department: string | null;
  scheduled: { shiftId: string; code: string; name: string; scheduledStart: string } | null;
  sessions: AttendanceSession[];
  /** Approved absence on the day (kind), if any. */
  absence?: string | null;
};

export type BoardRules = { lateToleranceMin: number; absentAfterMin: number };

export type BoardRow = BoardEmployee & {
  status: BoardStatus;
  /** Clocked in later than start + tolerance (present or left). */
  arrivedLate: boolean;
  lateMinutes: number;
  /** Open session / first session of the day. */
  current: AttendanceSession | null;
};

export function boardRow(employee: BoardEmployee, rules: BoardRules, now: Date): BoardRow {
  const open = employee.sessions.find((session) => session.clockOutAt === null) ?? null;
  const first = employee.sessions[0] ?? null;
  const reference = open ?? first;
  const late = reference ? sessionTime(reference, now).lateMinutes : 0;
  const arrivedLate = late > rules.lateToleranceMin;
  const base = { ...employee, current: reference, lateMinutes: late, arrivedLate };

  if (open) return { ...base, status: "present" };
  if (first) return { ...base, status: "left" };
  if (employee.absence) return { ...base, status: "on_leave" };
  if (!employee.scheduled) return { ...base, status: "off" };

  const sinceStart = Math.floor((now.getTime() - ms(employee.scheduled.scheduledStart)) / MINUTE);
  if (sinceStart >= rules.absentAfterMin) return { ...base, status: "absent" };
  if (sinceStart > rules.lateToleranceMin) {
    return { ...base, status: "late", lateMinutes: sinceStart };
  }
  return { ...base, status: "expected" };
}

const STATUS_ORDER: Record<BoardStatus, number> = {
  absent: 0,
  late: 1,
  present: 2,
  expected: 3,
  left: 4,
  on_leave: 5,
  off: 6,
};

export function boardRows(
  employees: readonly BoardEmployee[],
  rules: BoardRules,
  now: Date,
): BoardRow[] {
  return employees
    .map((employee) => boardRow(employee, rules, now))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

export function boardCounts(rows: readonly BoardRow[]): Record<BoardStatus, number> {
  const counts: Record<BoardStatus, number> = {
    present: 0,
    left: 0,
    late: 0,
    absent: 0,
    expected: 0,
    on_leave: 0,
    off: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** "7:30" style hours and minutes. */
export function formatMinutes(total: number): string {
  const sign = total < 0 ? "-" : "";
  const value = Math.abs(total);
  return `${sign}${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** First and last day of the month of a "YYYY-MM-DD" date. */
export function monthRange(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = date.slice(0, 8);
  return { from: `${prefix}01`, to: `${prefix}${String(last).padStart(2, "0")}` };
}
