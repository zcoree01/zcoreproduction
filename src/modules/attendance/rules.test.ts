import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timezone";
import {
  boardCounts,
  boardRow,
  boardRows,
  crossesMidnight,
  endExtendedForBreaks,
  formatMinutes,
  monthRange,
  sessionTime,
  shiftLengthMinutes,
  shiftProblem,
  shiftWorkMinutes,
  totalTime,
  type AttendanceSession,
  type BoardEmployee,
} from "./rules";

const TZ = "Europe/Sarajevo";
const at = (local: string) => zonedLocalToUtc(local, TZ);

function session(overrides: Partial<AttendanceSession> = {}): AttendanceSession {
  return {
    id: "s1",
    employeeId: "e1",
    shiftId: "sh1",
    shiftCode: "I",
    shiftName: "Prva",
    workDate: "2026-10-20",
    scheduledStart: at("2026-10-20T06:00"),
    scheduledEnd: at("2026-10-20T14:00"),
    breaks: [],
    clockInAt: at("2026-10-20T06:00"),
    clockOutAt: at("2026-10-20T14:00"),
    clockInSource: "mobile",
    clockOutSource: "mobile",
    ...overrides,
  };
}

const now = new Date(at("2026-10-26T12:00"));

describe("sessionTime", () => {
  it("counts a full shift as regular time", () => {
    expect(sessionTime(session(), now)).toMatchObject({
      presentMinutes: 480,
      regularMinutes: 480,
      overtimeMinutes: 0,
      lateMinutes: 0,
    });
  });

  it("does not count early arrival", () => {
    const time = sessionTime(session({ clockInAt: at("2026-10-20T05:45") }), now);
    expect(time.presentMinutes).toBe(495);
    expect(time.regularMinutes).toBe(480);
  });

  it("deducts lateness and lets a late worker make it up as regular time, not overtime", () => {
    const late = sessionTime(session({ clockInAt: at("2026-10-20T06:10") }), now);
    expect(late).toMatchObject({ regularMinutes: 470, lateMinutes: 10, overtimeMinutes: 0 });

    // Arrived at 08:00 instead of 06:00 and stayed until 16:00.
    const madeUp = sessionTime(
      session({ clockInAt: at("2026-10-20T08:00"), clockOutAt: at("2026-10-20T16:00") }),
      now,
    );
    expect(madeUp).toMatchObject({ regularMinutes: 480, overtimeMinutes: 0, lateMinutes: 120 });
  });

  it("counts staying after the shift as overtime, rounded down to the step", () => {
    const stayed = session({ clockOutAt: at("2026-10-20T15:20") });
    expect(sessionTime(stayed, now).overtimeMinutes).toBe(80);
    expect(sessionTime(stayed, now, { overtimeStepMin: 15 }).overtimeMinutes).toBe(75);
    expect(sessionTime(stayed, now).regularMinutes).toBe(480);
  });

  it("deducts an unpaid break but not a paid one", () => {
    const unpaid = session({ breaks: [{ startsAt: null, minutes: 30, paid: false }] });
    expect(sessionTime(unpaid, now)).toMatchObject({ regularMinutes: 450, unpaidBreakMinutes: 30 });
    const paid = session({ breaks: [{ startsAt: null, minutes: 30, paid: true }] });
    expect(sessionTime(paid, now).regularMinutes).toBe(480);
  });

  it("deducts a fixed unpaid break only where it overlaps the counted time", () => {
    const breaks = [{ startsAt: at("2026-10-20T10:00"), minutes: 30, paid: false }];
    expect(sessionTime(session({ breaks }), now).regularMinutes).toBe(450);
    // Left at 10:15: only 15 minutes of the break were inside.
    const left = session({ breaks, clockOutAt: at("2026-10-20T10:15") });
    expect(sessionTime(left, now).regularMinutes).toBe(240);
    // Left before the break.
    const early = session({ breaks, clockOutAt: at("2026-10-20T09:00") });
    expect(sessionTime(early, now).regularMinutes).toBe(180);
  });

  it("skips a flexible break when less than half of the shift was worked", () => {
    const breaks = [{ startsAt: null, minutes: 30, paid: false }];
    expect(
      sessionTime(session({ breaks, clockOutAt: at("2026-10-20T09:00") }), now).regularMinutes,
    ).toBe(180);
  });

  it("handles a 12-hour shift with 30 minutes unpaid break", () => {
    const twelve = session({
      scheduledEnd: at("2026-10-20T18:00"),
      clockOutAt: at("2026-10-20T18:00"),
      breaks: [{ startsAt: null, minutes: 30, paid: false }],
    });
    expect(sessionTime(twelve, now).regularMinutes).toBe(690);
  });

  it("counts a night shift across midnight", () => {
    const night = session({
      scheduledStart: at("2026-10-20T22:00"),
      scheduledEnd: at("2026-10-21T06:00"),
      clockInAt: at("2026-10-20T21:50"),
      clockOutAt: at("2026-10-21T06:05"),
    });
    expect(sessionTime(night, now)).toMatchObject({ regularMinutes: 480, overtimeMinutes: 5 });
  });

  it("gives the night of the autumn DST change its real nine hours", () => {
    // 25 Oct 2026: clocks go back 03:00 → 02:00 in Sarajevo.
    const start = at("2026-10-24T22:00");
    const end = at("2026-10-25T06:00");
    expect((Date.parse(end) - Date.parse(start)) / 3_600_000).toBe(9);
    const night = session({
      scheduledStart: start,
      scheduledEnd: end,
      clockInAt: start,
      clockOutAt: end,
    });
    expect(sessionTime(night, now)).toMatchObject({ regularMinutes: 540, overtimeMinutes: 0 });
  });

  it("gives the night of the spring DST change its real seven hours", () => {
    // 29 Mar 2026: clocks go forward 02:00 → 03:00.
    const start = at("2026-03-28T22:00");
    const end = at("2026-03-29T06:00");
    const night = session({
      scheduledStart: start,
      scheduledEnd: end,
      clockInAt: start,
      clockOutAt: end,
    });
    expect(sessionTime(night, now).regularMinutes).toBe(420);
  });

  it("counts every present minute without a shift", () => {
    const free = session({
      shiftId: null,
      scheduledStart: null,
      scheduledEnd: null,
      clockInAt: at("2026-10-20T09:00"),
      clockOutAt: at("2026-10-20T11:30"),
    });
    expect(sessionTime(free, now)).toMatchObject({ regularMinutes: 150, overtimeMinutes: 0 });
  });

  it("counts an open session until now", () => {
    const open = session({
      workDate: "2026-10-26",
      scheduledStart: at("2026-10-26T06:00"),
      scheduledEnd: at("2026-10-26T14:00"),
      clockInAt: at("2026-10-26T06:00"),
      clockOutAt: null,
      clockOutSource: null,
    });
    expect(sessionTime(open, now)).toMatchObject({ regularMinutes: 360, open: true });
  });

  it("gives zero for an automatic clock-out without a shift (closed at clock-in)", () => {
    const auto = session({
      shiftId: null,
      scheduledStart: null,
      scheduledEnd: null,
      clockOutAt: at("2026-10-20T06:00"),
      clockOutSource: "auto",
    });
    expect(sessionTime(auto, now).regularMinutes).toBe(0);
  });
});

describe("totalTime", () => {
  it("sums sessions and counts distinct days", () => {
    const totals = totalTime(
      [
        session(),
        session({ id: "s2", clockOutAt: at("2026-10-20T15:00") }),
        session({
          id: "s3",
          workDate: "2026-10-21",
          scheduledStart: at("2026-10-21T06:00"),
          scheduledEnd: at("2026-10-21T14:00"),
          clockInAt: at("2026-10-21T06:00"),
          clockOutAt: at("2026-10-21T14:00"),
        }),
      ],
      now,
    );
    expect(totals).toEqual({
      presentMinutes: 480 + 540 + 480,
      regularMinutes: 1440,
      overtimeMinutes: 60,
      days: 2,
    });
  });
});

describe("shift definitions", () => {
  it("computes length across midnight", () => {
    expect(shiftLengthMinutes("06:00", "14:00")).toBe(480);
    expect(shiftLengthMinutes("22:00", "06:00")).toBe(480);
    expect(shiftLengthMinutes("18:00", "06:00")).toBe(720);
    expect(crossesMidnight("22:00", "06:00")).toBe(true);
    expect(crossesMidnight("06:00", "14:00")).toBe(false);
  });

  it("computes paid work and the end that keeps 8 working hours", () => {
    const breaks = [{ startsAt: null, minutes: 30, paid: false }];
    expect(shiftWorkMinutes("06:00", "14:00", breaks)).toBe(450);
    expect(endExtendedForBreaks("06:00", 480, breaks)).toBe("14:30");
    expect(endExtendedForBreaks("22:00", 480, breaks)).toBe("06:30");
    expect(shiftWorkMinutes("06:00", "14:00", [{ ...breaks[0]!, paid: true }])).toBe(480);
  });

  it("validates times and breaks like save_shift", () => {
    expect(shiftProblem("06:00", "06:00", [])).toEqual({ problem: "same_times" });
    expect(shiftProblem("06:00", "07:00", [{ startsAt: null, minutes: 60, paid: false }])).toEqual({
      problem: "breaks_too_long",
    });
    expect(
      shiftProblem("22:00", "06:00", [{ startsAt: "05:45", minutes: 30, paid: false }]),
    ).toEqual({ problem: "break_outside_shift", index: 0 });
    expect(shiftProblem("22:00", "06:00", [{ startsAt: "02:00", minutes: 30, paid: false }])).toBe(
      null,
    );
    expect(
      shiftProblem("06:00", "14:00", [{ startsAt: "05:00", minutes: 30, paid: true }]),
    ).toEqual({ problem: "break_outside_shift", index: 0 });
  });
});

describe("board", () => {
  const rules = { lateToleranceMin: 10, absentAfterMin: 120 };
  const scheduled = {
    shiftId: "sh1",
    code: "I",
    name: "Prva",
    scheduledStart: at("2026-10-26T06:00"),
  };
  const employee = (overrides: Partial<BoardEmployee>): BoardEmployee => ({
    id: "e1",
    number: 1,
    name: "Omer",
    department: null,
    scheduled: null,
    sessions: [],
    ...overrides,
  });
  const today = session({
    workDate: "2026-10-26",
    scheduledStart: at("2026-10-26T06:00"),
    scheduledEnd: at("2026-10-26T14:00"),
    clockInAt: at("2026-10-26T06:05"),
    clockOutAt: null,
    clockOutSource: null,
  });

  it("classifies by sessions and schedule", () => {
    const t = (local: string) => new Date(at(local));
    expect(boardRow(employee({ sessions: [today] }), rules, t("2026-10-26T07:00")).status).toBe(
      "present",
    );
    expect(boardRow(employee({ scheduled }), rules, t("2026-10-26T06:05")).status).toBe("expected");
    expect(boardRow(employee({ scheduled }), rules, t("2026-10-26T06:30")).status).toBe("late");
    expect(boardRow(employee({ scheduled }), rules, t("2026-10-26T08:00")).status).toBe("absent");
    expect(boardRow(employee({}), rules, t("2026-10-26T08:00")).status).toBe("off");
    const left = {
      ...today,
      clockOutAt: at("2026-10-26T14:00"),
      clockOutSource: "mobile" as const,
    };
    expect(boardRow(employee({ sessions: [left] }), rules, t("2026-10-26T15:00")).status).toBe(
      "left",
    );
  });

  it("marks arrivals after the tolerance as late", () => {
    const t = new Date(at("2026-10-26T07:00"));
    expect(boardRow(employee({ sessions: [today] }), rules, t).arrivedLate).toBe(false);
    const late = { ...today, clockInAt: at("2026-10-26T06:25") };
    const row = boardRow(employee({ sessions: [late] }), rules, t);
    expect(row).toMatchObject({ arrivedLate: true, lateMinutes: 25 });
  });

  it("sorts problems first and counts statuses", () => {
    const t = new Date(at("2026-10-26T09:00"));
    const rows = boardRows(
      [
        employee({ id: "a", sessions: [today] }),
        employee({ id: "b", scheduled }),
        employee({ id: "c" }),
      ],
      rules,
      t,
    );
    expect(rows.map((row) => row.status)).toEqual(["absent", "present", "off"]);
    expect(boardCounts(rows)).toMatchObject({ absent: 1, present: 1, off: 1, late: 0 });
  });
});

describe("formatMinutes", () => {
  it("formats hours and minutes", () => {
    expect(formatMinutes(450)).toBe("7:30");
    expect(formatMinutes(5)).toBe("0:05");
    expect(formatMinutes(-75)).toBe("-1:15");
  });
});

describe("monthRange", () => {
  it("covers the whole month, leap years included", () => {
    expect(monthRange("2026-10-27")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
