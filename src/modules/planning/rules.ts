// Production planning by days (D-041), pure and unit-tested.
//
// Every machine works through its planned operations in order: day by day,
// position by position. A long operation goes on into the next days (an
// EDM job of 20 h on a machine that runs unattended); an operation that
// cannot start on its planned day because the machine is still busy, out
// of service or it is not a working day makes that day overloaded. That is
// only a warning; the program offers to move work to later days, the
// lowest priority first and, among equal priorities, what was added last.
//
// Durations are seconds of planning time (not stock or money), so plain
// numbers are fine here.

import { addDays, isoWeekday } from "@/modules/attendance/schedule-rules";

export type PlanBasis = "planned" | "actual";

export type PlanMachine = {
  id: string;
  runsUnattended: boolean;
  /** Hours per day; null = 24 h when unattended, otherwise the organization's hours. */
  capacityHours: number | null;
};

export type PlanOperation = {
  id: string;
  orderId: string;
  sequence: number;
  machineId: string | null;
  planDay: string | null;
  position: number | null;
  addedAt: string | null;
  /** 1 = most urgent … 5. */
  priority: number;
  dueDate: string;
  status: "waiting" | "ready" | "in_progress" | "paused";
  /** Remaining machine time by the routing's cycle. */
  plannedSeconds: number;
  /** Remaining machine time by the actual cycle; null = not known yet. */
  actualSeconds: number | null;
  /** Setup still to do (0 once started). */
  setupSeconds: number;
  workerIds: string[];
};

export type Downtime = { machineId: string; startsOn: string; endsOn: string | null };

export type Calendar = {
  /** Non-working dates besides Saturday and Sunday (holidays for everybody). */
  holidays: ReadonlySet<string>;
  downtimes: readonly Downtime[];
};

export const HOUR = 3600;

export function isWorkingDay(day: string, calendar: Pick<Calendar, "holidays">): boolean {
  return isoWeekday(day) <= 5 && !calendar.holidays.has(day);
}

export function isDown(machineId: string, day: string, downtimes: readonly Downtime[]): boolean {
  return downtimes.some(
    (d) => d.machineId === machineId && d.startsOn <= day && (d.endsOn === null || day <= d.endsOn),
  );
}

export function capacitySeconds(machine: PlanMachine, workHoursPerDay: number): number {
  const hours = machine.capacityHours ?? (machine.runsUnattended ? 24 : workHoursPerDay);
  return Math.round(hours * HOUR);
}

/**
 * Remaining machine time of an operation: setup while not started, plus the
 * pieces still to make (ordered − good) × cycle. Null without a cycle.
 */
export function remainingSeconds(op: {
  started: boolean;
  setupMin: number;
  cycleSeconds: number | null;
  quantity: number;
  goodQuantity: number;
}): number | null {
  if (op.cycleSeconds === null) return null;
  const pieces = Math.max(op.quantity - op.goodQuantity, 0);
  return Math.round((op.started ? 0 : op.setupMin * 60) + pieces * op.cycleSeconds);
}

/** Actual cycle per piece from earlier runs: (run − setup) / pieces, summed over runs with time. */
export function historicCycleSeconds(
  runs: readonly { runSeconds: number; setupMin: number; pieces: number }[],
): number | null {
  let working = 0;
  let pieces = 0;
  for (const run of runs) {
    const time = run.runSeconds - run.setupMin * 60;
    // Runs without pieces or machine time beyond the setup say nothing.
    if (run.pieces <= 0 || time <= 0) continue;
    working += time;
    pieces += run.pieces;
  }
  return pieces > 0 ? working / pieces : null;
}

export const secondsOn = (op: PlanOperation, basis: PlanBasis) =>
  basis === "actual" ? (op.actualSeconds ?? op.plannedSeconds) : op.plannedSeconds;

/** Day the schedule counts an operation from: started work and past days are today. */
export function effectiveDay(op: PlanOperation, today: string): string | null {
  if (op.status === "in_progress" || op.status === "paused") return today;
  if (op.planDay === null) return null;
  return op.planDay < today ? today : op.planDay;
}

export type Segment = { operationId: string; day: string; seconds: number; start: boolean };

export type OperationForecast = {
  /** Day the machine can start it (null: not within the horizon). */
  startDay: string | null;
  endDay: string | null;
  /** Cannot start on its planned day. */
  late: boolean;
};

export type DayLoad = {
  capacity: number;
  /** Work carried over from earlier days. */
  carriedIn: number;
  /** Machine time of the operations planned on this day. */
  planned: number;
  used: number;
  working: boolean;
  down: boolean;
  /** An operation planned on this day cannot start on it. */
  overloaded: boolean;
};

export type MachineSchedule = {
  days: Map<string, DayLoad>;
  forecasts: Map<string, OperationForecast>;
  segments: Segment[];
};

/** Days the machine may stay busy or blocked in a row before the forecast gives up. */
const HORIZON_DAYS = 366;

function sortInDay(a: PlanOperation, b: PlanOperation): number {
  const started = (op: PlanOperation) =>
    op.status === "in_progress" || op.status === "paused" ? 0 : 1;
  return (
    started(a) - started(b) ||
    (a.planDay ?? "").localeCompare(b.planDay ?? "") ||
    (a.position ?? 0) - (b.position ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Runs one machine's planned operations through the days from `today`.
 * A new operation starts only on a working day without downtime; work in
 * progress goes on through the night and non-working days on a machine that
 * runs unattended, otherwise it waits for the next working day. Idle days
 * are skipped, so work planned far ahead is scheduled as well.
 */
export function scheduleMachine(input: {
  machine: PlanMachine;
  operations: readonly PlanOperation[];
  calendar: Calendar;
  today: string;
  workHoursPerDay: number;
  basis: PlanBasis;
}): MachineSchedule {
  const { machine, calendar, today, basis } = input;
  const capacity = capacitySeconds(machine, input.workHoursPerDay);
  const byDay = new Map<string, PlanOperation[]>();
  for (const op of input.operations) {
    const day = effectiveDay(op, today);
    if (day === null) continue;
    const list = byDay.get(day) ?? [];
    list.push(op);
    byDay.set(day, list);
  }
  for (const list of byDay.values()) list.sort(sortInDay);
  const plannedDays = [...byDay.keys()].sort();

  const days = new Map<string, DayLoad>();
  const forecasts = new Map<string, OperationForecast>();
  const segments: Segment[] = [];
  const queue: { op: PlanOperation; left: number; day: string }[] = [];
  let current: { op: PlanOperation; left: number } | null = null;

  let day = today;
  let busyDays = 0;
  for (;;) {
    if (queue.length === 0 && current === null) {
      const next = plannedDays.find((planned) => planned >= day);
      if (next === undefined) break;
      day = next;
      busyDays = 0;
    } else if (busyDays >= HORIZON_DAYS) {
      break;
    }
    const own = byDay.get(day) ?? [];
    for (const op of own) queue.push({ op, left: secondsOn(op, basis), day });

    const working = isWorkingDay(day, calendar);
    const down = isDown(machine.id, day, calendar.downtimes);
    const canStart = working && !down;
    const canRun = !down && (working || machine.runsUnattended);
    const dayCapacity = canRun ? capacity : 0;
    const carriedIn = current?.left ?? 0;
    let time = 0;

    const run = (job: { op: PlanOperation; left: number }, start: boolean) => {
      const seconds = Math.min(job.left, dayCapacity - time);
      time += seconds;
      job.left -= seconds;
      segments.push({ operationId: job.op.id, day, seconds, start });
      if (job.left <= 0) {
        const forecast = forecasts.get(job.op.id);
        if (forecast) forecast.endDay = day;
      }
    };

    if (current && dayCapacity > 0) {
      run(current, false);
      if (current.left <= 0) current = null;
    }
    while (canStart && current === null && queue.length > 0 && time < dayCapacity) {
      const next = queue.shift();
      if (!next) break;
      forecasts.set(next.op.id, { startDay: day, endDay: null, late: next.day < day });
      current = { op: next.op, left: next.left };
      run(current, true);
      if (current.left <= 0) current = null;
    }
    // An operation without time (no cycle) still starts and ends that day.
    while (canStart && current === null && queue[0] && queue[0].left <= 0) {
      const next = queue.shift();
      if (!next) break;
      forecasts.set(next.op.id, { startDay: day, endDay: day, late: next.day < day });
    }

    days.set(day, {
      capacity: dayCapacity,
      carriedIn,
      planned: own.reduce((sum, op) => sum + secondsOn(op, basis), 0),
      used: time,
      working,
      down,
      overloaded: false,
    });
    day = addDays(day, 1);
    busyDays += 1;
  }

  for (const job of queue) forecasts.set(job.op.id, { startDay: null, endDay: null, late: true });
  if (current) {
    const forecast = forecasts.get(current.op.id);
    if (forecast) forecast.endDay = null;
  }
  for (const op of input.operations) {
    const day = effectiveDay(op, today);
    const load = day ? days.get(day) : undefined;
    if (load && forecasts.get(op.id)?.late) load.overloaded = true;
  }
  return { days, forecasts, segments };
}

export type PlanMove = {
  operationId: string;
  planDay: string;
  position: number;
  auto: true;
};

/** Lowest priority first; among equal priorities what was added last. */
function moveOrder(a: PlanOperation, b: PlanOperation): number {
  return b.priority - a.priority || (b.addedAt ?? "").localeCompare(a.addedAt ?? "");
}

function nextStartDay(machineId: string, day: string, calendar: Calendar): string {
  let next = addDays(day, 1);
  for (
    let i = 0;
    i < HORIZON_DAYS &&
    (!isWorkingDay(next, calendar) || isDown(machineId, next, calendar.downtimes));
    i += 1
  ) {
    next = addDays(next, 1);
  }
  return next;
}

/**
 * Moves work out of overloaded days of one machine until every planned
 * operation can start on its day: from the earliest overloaded day, the
 * operation to move is the lowest priority, then the one added last; it
 * goes to the end of the next day the machine can start work. Started work
 * never moves. Returns the moves (with new positions for the days touched).
 */
export function rebalanceMachine(input: {
  machine: PlanMachine;
  operations: readonly PlanOperation[];
  calendar: Calendar;
  today: string;
  workHoursPerDay: number;
  basis: PlanBasis;
}): PlanMove[] {
  const ops = new Map(input.operations.map((op) => [op.id, { ...op }]));
  const touched = new Set<string>();

  for (let round = 0; round < 1000; round += 1) {
    const list = [...ops.values()];
    const schedule = scheduleMachine({ ...input, operations: list });
    const day = [...schedule.days.entries()]
      .filter(([, load]) => load.overloaded)
      .map(([date]) => date)
      .sort()[0];
    if (!day) break;
    const candidates = list
      .filter(
        (op) =>
          effectiveDay(op, input.today) === day &&
          op.status !== "in_progress" &&
          op.status !== "paused",
      )
      .sort(moveOrder);
    const victim = candidates[0];
    if (!victim) break;
    const target = nextStartDay(input.machine.id, day, input.calendar);
    const lastPosition = Math.max(
      0,
      ...list.filter((op) => op.planDay === target).map((op) => op.position ?? 0),
    );
    if (victim.planDay) touched.add(victim.planDay);
    touched.add(target);
    ops.set(victim.id, { ...victim, planDay: target, position: lastPosition + 1 });
  }

  const moves: PlanMove[] = [];
  for (const day of touched) {
    const inDay = [...ops.values()]
      .filter((op) => op.planDay === day)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    inDay.forEach((op, index) => {
      const before = input.operations.find((o) => o.id === op.id);
      if (before?.planDay !== day || before.position !== index + 1) {
        moves.push({ operationId: op.id, planDay: day, position: index + 1, auto: true });
      }
    });
  }
  return moves;
}

/**
 * Operator time per worker and day. On a machine that runs unattended the
 * operator is needed for the setup (the start of the job) only; otherwise
 * for the machine time. Every assigned operator is counted in full.
 */
export function operatorLoad(input: {
  segments: readonly Segment[];
  operations: ReadonlyMap<string, PlanOperation>;
  unattended: (machineId: string) => boolean;
}): Map<string, Map<string, number>> {
  const load = new Map<string, Map<string, number>>();
  for (const segment of input.segments) {
    const op = input.operations.get(segment.operationId);
    if (!op || !op.machineId) continue;
    const seconds = input.unattended(op.machineId)
      ? segment.start
        ? Math.min(op.setupSeconds, segment.seconds)
        : 0
      : segment.seconds;
    if (seconds <= 0) continue;
    for (const worker of op.workerIds) {
      const days = load.get(worker) ?? new Map<string, number>();
      days.set(segment.day, (days.get(segment.day) ?? 0) + seconds);
      load.set(worker, days);
    }
  }
  return load;
}

export type OperationWarning =
  | { kind: "late"; endDay: string | null; dueDate: string }
  | { kind: "cannot_start"; startDay: string | null }
  | { kind: "before_previous"; previousEnd: string | null }
  | { kind: "previous_unplanned" }
  | { kind: "no_operator" }
  | { kind: "past_day" };

/**
 * Warnings of one planned operation (never blocking): its order will be
 * late, it cannot start on its day, it is planned before the previous
 * operation of the order ends, the previous one is not planned, it has no
 * operator, its day is in the past.
 */
export function operationWarnings(input: {
  op: PlanOperation;
  forecast: OperationForecast | undefined;
  orderEnd: string | null | undefined;
  previous: { forecast: OperationForecast | undefined; planned: boolean } | null;
  today: string;
}): OperationWarning[] {
  const { op, forecast } = input;
  const warnings: OperationWarning[] = [];
  if (op.planDay === null) return warnings;
  if (op.planDay < input.today && op.status !== "in_progress" && op.status !== "paused") {
    warnings.push({ kind: "past_day" });
  }
  if (forecast?.late) warnings.push({ kind: "cannot_start", startDay: forecast.startDay });
  if (input.previous) {
    const previousEnd = input.previous.forecast?.endDay ?? null;
    if (!input.previous.planned) warnings.push({ kind: "previous_unplanned" });
    else if (previousEnd === null || previousEnd > op.planDay) {
      warnings.push({ kind: "before_previous", previousEnd });
    }
  }
  if (op.workerIds.length === 0) warnings.push({ kind: "no_operator" });
  if (input.orderEnd === null || (input.orderEnd !== undefined && input.orderEnd > op.dueDate)) {
    warnings.push({ kind: "late", endDay: input.orderEnd ?? null, dueDate: op.dueDate });
  }
  return warnings;
}

/** Sort for the list of operations not planned yet: priority, due date, order, sequence. */
export function unplannedOrder(
  a: { priority: number; dueDate: string; orderNumber: string; sequence: number },
  b: { priority: number; dueDate: string; orderNumber: string; sequence: number },
): number {
  return (
    a.priority - b.priority ||
    a.dueDate.localeCompare(b.dueDate) ||
    a.orderNumber.localeCompare(b.orderNumber) ||
    a.sequence - b.sequence
  );
}

/** New positions (1…n) after moving an item up or down within its day. */
export function shiftWithinDay(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Ids of a day after inserting `id` before `beforeId` (null = at the end). */
export function insertIntoDay(
  ids: readonly string[],
  id: string,
  beforeId: string | null,
): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = beforeId === null ? -1 : rest.indexOf(beforeId);
  if (at < 0) return [...rest, id];
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Hours with one decimal for display ("6,5"). */
export function hours(seconds: number): number {
  return Math.round((seconds / HOUR) * 10) / 10;
}
