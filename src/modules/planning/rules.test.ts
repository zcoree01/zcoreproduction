import { describe, expect, it } from "vitest";
import {
  capacitySeconds,
  historicCycleSeconds,
  HOUR,
  insertIntoDay,
  isWorkingDay,
  operationWarnings,
  operatorLoad,
  rebalanceMachine,
  remainingSeconds,
  scheduleMachine,
  shiftWithinDay,
  type Calendar,
  type PlanMachine,
  type PlanOperation,
} from "./rules";

// 2030-05-06 is a Monday.
const MON = "2030-05-06";
const TUE = "2030-05-07";
const WED = "2030-05-08";
const FRI = "2030-05-10";
const SAT = "2030-05-11";
const NEXT_MON = "2030-05-13";

const cnc: PlanMachine = { id: "cnc", runsUnattended: false, capacityHours: null };
const edm: PlanMachine = { id: "edm", runsUnattended: true, capacityHours: null };
const calendar: Calendar = { holidays: new Set(), downtimes: [] };

function op(id: string, overrides: Partial<PlanOperation> = {}): PlanOperation {
  return {
    id,
    orderId: `order-${id}`,
    sequence: 10,
    machineId: "cnc",
    planDay: MON,
    position: 1,
    addedAt: "2030-05-01T08:00:00Z",
    priority: 3,
    dueDate: "2030-06-30",
    status: "ready",
    plannedSeconds: 4 * HOUR,
    actualSeconds: null,
    setupSeconds: 30 * 60,
    workerIds: ["w1"],
    ...overrides,
  };
}

const schedule = (
  machine: PlanMachine,
  operations: PlanOperation[],
  extra: Partial<Calendar> = {},
) =>
  scheduleMachine({
    machine,
    operations,
    calendar: { ...calendar, ...extra },
    today: MON,
    workHoursPerDay: 8,
    basis: "planned",
  });

describe("capacity and durations", () => {
  it("uses the machine's hours, 24 h unattended, otherwise the organization's", () => {
    expect(capacitySeconds(cnc, 8)).toBe(8 * HOUR);
    expect(capacitySeconds(edm, 8)).toBe(24 * HOUR);
    expect(capacitySeconds({ ...edm, capacityHours: 20 }, 8)).toBe(20 * HOUR);
  });

  it("counts the setup until started and the pieces still to make", () => {
    expect(
      remainingSeconds({
        started: false,
        setupMin: 30,
        cycleSeconds: 90,
        quantity: 40,
        goodQuantity: 0,
      }),
    ).toBe(1800 + 3600);
    expect(
      remainingSeconds({
        started: true,
        setupMin: 30,
        cycleSeconds: 90,
        quantity: 40,
        goodQuantity: 30,
      }),
    ).toBe(900);
    expect(
      remainingSeconds({
        started: false,
        setupMin: 0,
        cycleSeconds: null,
        quantity: 1,
        goodQuantity: 0,
      }),
    ).toBeNull();
  });

  it("takes the actual cycle of earlier runs without their setup", () => {
    expect(
      historicCycleSeconds([
        { runSeconds: 3600, setupMin: 10, pieces: 30 },
        { runSeconds: 1000, setupMin: 0, pieces: 10 },
        { runSeconds: 500, setupMin: 0, pieces: 0 },
        { runSeconds: 300, setupMin: 10, pieces: 5 },
      ]),
    ).toBe((3000 + 1000) / 40);
    expect(historicCycleSeconds([])).toBeNull();
  });

  it("knows weekends and holidays", () => {
    expect(isWorkingDay(FRI, calendar)).toBe(true);
    expect(isWorkingDay(SAT, calendar)).toBe(false);
    expect(isWorkingDay(TUE, { holidays: new Set([TUE]) })).toBe(false);
  });
});

describe("machine schedule", () => {
  it("lets an unattended EDM job run on through the night", () => {
    const result = schedule(edm, [op("e", { machineId: "edm", plannedSeconds: 30 * HOUR })]);
    expect(result.forecasts.get("e")).toEqual({ startDay: MON, endDay: TUE, late: false });
    expect(result.days.get(MON)?.overloaded).toBe(false);
    expect(result.days.get(TUE)?.carriedIn).toBe(6 * HOUR);
  });

  it("schedules work planned far ahead (idle days are skipped)", () => {
    const result = scheduleMachine({
      machine: cnc,
      operations: [op("far", { planDay: "2032-03-02", plannedSeconds: 10 * HOUR })],
      calendar,
      today: MON,
      workHoursPerDay: 8,
      basis: "planned",
    });
    expect(result.forecasts.get("far")).toEqual({
      startDay: "2032-03-02",
      endDay: "2032-03-03",
      late: false,
    });
  });

  it("carries attended work to the next working day and over the weekend", () => {
    const result = schedule(cnc, [op("a", { planDay: FRI, plannedSeconds: 12 * HOUR })]);
    expect(result.forecasts.get("a")).toEqual({ startDay: FRI, endDay: NEXT_MON, late: false });
    expect(result.days.get(SAT)?.capacity).toBe(0);
  });

  it("marks a day when planned work cannot start on it", () => {
    const result = schedule(cnc, [
      op("a", { plannedSeconds: 6 * HOUR }),
      op("b", { position: 2, plannedSeconds: 2 * HOUR }),
      op("c", { position: 3, plannedSeconds: 1 * HOUR }),
    ]);
    expect(result.forecasts.get("b")?.late).toBe(false);
    expect(result.forecasts.get("c")).toMatchObject({ startDay: TUE, late: true });
    expect(result.days.get(MON)?.overloaded).toBe(true);
    expect(result.days.get(MON)?.planned).toBe(9 * HOUR);
  });

  it("starts nothing while the machine is down and goes on after an open-ended downtime ends", () => {
    const down = schedule(cnc, [op("a")], {
      downtimes: [{ machineId: "cnc", startsOn: MON, endsOn: TUE }],
    });
    expect(down.forecasts.get("a")).toMatchObject({ startDay: WED, late: true });
    const open = schedule(cnc, [op("a")], {
      downtimes: [{ machineId: "cnc", startsOn: MON, endsOn: null }],
    });
    expect(open.forecasts.get("a")).toEqual({ startDay: null, endDay: null, late: true });
  });

  it("puts started work first and past days on today, by the actual cycle when asked", () => {
    const result = scheduleMachine({
      machine: cnc,
      operations: [
        op("past", { planDay: "2030-05-02", plannedSeconds: 2 * HOUR }),
        op("running", {
          planDay: TUE,
          status: "in_progress",
          plannedSeconds: 2 * HOUR,
          actualSeconds: 7 * HOUR,
        }),
      ],
      calendar,
      today: MON,
      workHoursPerDay: 8,
      basis: "actual",
    });
    expect(result.forecasts.get("running")).toMatchObject({ startDay: MON, endDay: MON });
    expect(result.forecasts.get("past")).toMatchObject({ startDay: MON, endDay: TUE, late: false });
  });
});

describe("moving work out of an overloaded day", () => {
  it("moves the lowest priority first, then what was added last", () => {
    const moves = rebalanceMachine({
      machine: cnc,
      operations: [
        op("urgent-late", {
          position: 1,
          priority: 1,
          addedAt: "2030-05-05T10:00:00Z",
          plannedSeconds: 4 * HOUR,
        }),
        op("normal-early", {
          position: 2,
          priority: 3,
          addedAt: "2030-05-01T10:00:00Z",
          plannedSeconds: 4 * HOUR,
        }),
        op("normal-late", {
          position: 3,
          priority: 3,
          addedAt: "2030-05-04T10:00:00Z",
          plannedSeconds: 1 * HOUR,
        }),
        op("tue", { planDay: TUE, position: 1, plannedSeconds: 1 * HOUR }),
      ],
      calendar,
      today: MON,
      workHoursPerDay: 8,
      basis: "planned",
    });
    expect(moves).toContainEqual({
      operationId: "normal-late",
      planDay: TUE,
      position: 2,
      auto: true,
    });
    expect(moves.map((m) => m.operationId)).not.toContain("urgent-late");
  });

  it("cascades into later days, skips the weekend and never moves started work", () => {
    const moves = rebalanceMachine({
      machine: cnc,
      operations: [
        op("running", { planDay: FRI, status: "in_progress", plannedSeconds: 8 * HOUR }),
        op("a", { planDay: FRI, position: 2, plannedSeconds: 2 * HOUR }),
      ],
      calendar,
      today: FRI,
      workHoursPerDay: 8,
      basis: "planned",
    });
    expect(moves).toEqual([{ operationId: "a", planDay: NEXT_MON, position: 1, auto: true }]);
  });

  it("returns nothing when every day fits", () => {
    expect(
      rebalanceMachine({
        machine: cnc,
        operations: [op("a"), op("b", { position: 2 })],
        calendar,
        today: MON,
        workHoursPerDay: 8,
        basis: "planned",
      }),
    ).toEqual([]);
  });
});

describe("operators and warnings", () => {
  it("needs the operator for the setup only on an unattended machine", () => {
    const edmJob = op("e", { machineId: "edm", plannedSeconds: 20 * HOUR, setupSeconds: HOUR });
    const cncJob = op("c", { machineId: "cnc", plannedSeconds: 5 * HOUR });
    const segments = [...schedule(edm, [edmJob]).segments, ...schedule(cnc, [cncJob]).segments];
    const load = operatorLoad({
      segments,
      operations: new Map([
        ["e", edmJob],
        ["c", cncJob],
      ]),
      unattended: (id) => id === "edm",
    });
    expect(load.get("w1")?.get(MON)).toBe(6 * HOUR);
  });

  it("warns about lateness, order of operations and a missing operator", () => {
    const warnings = operationWarnings({
      op: op("b", { workerIds: [], dueDate: TUE }),
      forecast: { startDay: MON, endDay: WED, late: false },
      orderEnd: WED,
      previous: { forecast: { startDay: MON, endDay: TUE, late: false }, planned: true },
      today: MON,
    });
    expect(warnings).toEqual([
      { kind: "before_previous", previousEnd: TUE },
      { kind: "no_operator" },
      { kind: "late", endDay: WED, dueDate: TUE },
    ]);
    expect(
      operationWarnings({
        op: op("a", { planDay: "2030-05-02" }),
        forecast: undefined,
        orderEnd: MON,
        previous: { forecast: undefined, planned: false },
        today: MON,
      }),
    ).toEqual([{ kind: "past_day" }, { kind: "previous_unplanned" }]);
  });

  it("reorders within a day", () => {
    expect(shiftWithinDay(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(shiftWithinDay(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(insertIntoDay(["a", "b"], "x", "b")).toEqual(["a", "x", "b"]);
    expect(insertIntoDay(["a", "b"], "a", null)).toEqual(["b", "a"]);
  });
});
