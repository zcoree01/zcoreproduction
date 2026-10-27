import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timezone";
import {
  monthTotals,
  rateOn,
  roundMoney,
  sessionBreakdowns,
  sessionPay,
  type EmployeeCalendar,
  type PayRules,
} from "./pay-rules";
import type { AttendanceSession } from "./rules";

const TZ = "Europe/Sarajevo";
const at = (local: string) => zonedLocalToUtc(local, TZ);
const now = new Date(at("2026-12-01T12:00"));

const rules: PayRules = {
  overtimeMode: "daily",
  weeklyHours: 40,
  weeklyOvertimeWarningHours: 10,
  overtimeStepMin: 15,
  nightStart: "22:00",
  nightEnd: "06:00",
  overtimePct: "30",
  nightPct: "30",
  weekendPct: "30",
  holidayPct: "50",
};

const calendar: EmployeeCalendar = { weekendDays: [6, 7], holidays: new Set() };

let counter = 0;
function shift(date: string, from: string, to: string, out?: string, startsNextDay = false) {
  counter += 1;
  const endDate = startsNextDay
    ? new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : date;
  const session: AttendanceSession = {
    id: `s${counter}`,
    employeeId: "e1",
    shiftId: "sh",
    shiftCode: "I",
    shiftName: "I",
    workDate: date,
    scheduledStart: at(`${date}T${from}`),
    scheduledEnd: at(`${endDate}T${to}`),
    breaks: [],
    clockInAt: at(`${date}T${from}`),
    clockOutAt: at(out ?? `${endDate}T${to}`),
    clockInSource: "mobile",
    clockOutSource: "mobile",
  };
  return session;
}

describe("sessionBreakdowns", () => {
  it("rounds overtime up to the step", () => {
    const [day] = sessionBreakdowns(
      [shift("2026-11-02", "06:00", "14:00", "2026-11-02T14:20")],
      rules,
      calendar,
      TZ,
      now,
    );
    expect(day).toMatchObject({ regularMin: 480, overtimeMin: 30, workedMin: 510 });
    const [exact] = sessionBreakdowns(
      [shift("2026-11-02", "06:00", "14:00", "2026-11-02T14:20")],
      { ...rules, overtimeStepMin: 0 },
      calendar,
      TZ,
      now,
    );
    expect(exact?.overtimeMin).toBe(20);
  });

  it("counts night minutes of a night shift and over the autumn DST change", () => {
    const [night] = sessionBreakdowns(
      [shift("2026-11-03", "22:00", "06:00", undefined, true)],
      rules,
      calendar,
      TZ,
      now,
    );
    expect(night).toMatchObject({ regularMin: 480, nightMin: 480 });
    const [dst] = sessionBreakdowns(
      [shift("2026-10-24", "22:00", "06:00", undefined, true)],
      rules,
      calendar,
      TZ,
      now,
    );
    expect(dst).toMatchObject({ regularMin: 540, nightMin: 540 });
    const [evening] = sessionBreakdowns(
      [shift("2026-11-03", "14:00", "22:00", "2026-11-03T23:00")],
      { ...rules, overtimeStepMin: 0 },
      calendar,
      TZ,
      now,
    );
    expect(evening).toMatchObject({ overtimeMin: 60, nightMin: 60 });
  });

  it("counts weekend minutes by the employee's own weekend days", () => {
    const saturday = shift("2026-11-07", "06:00", "14:00");
    expect(sessionBreakdowns([saturday], rules, calendar, TZ, now)[0]?.weekendMin).toBe(480);
    // A turnus worker whose weekend is Tuesday–Wednesday works Saturday as a normal day.
    expect(
      sessionBreakdowns([saturday], rules, { ...calendar, weekendDays: [2, 3] }, TZ, now)[0]
        ?.weekendMin,
    ).toBe(0);
    // A night shift from Friday to Saturday: only the part after midnight is weekend.
    const friday = shift("2026-11-06", "22:00", "06:00", undefined, true);
    expect(sessionBreakdowns([friday], rules, calendar, TZ, now)[0]?.weekendMin).toBe(360);
  });

  it("counts holiday minutes only on the employee's non-working holidays", () => {
    const day = shift("2026-11-25", "06:00", "14:00");
    expect(sessionBreakdowns([day], rules, calendar, TZ, now)[0]?.holidayMin).toBe(0);
    expect(
      sessionBreakdowns(
        [day],
        rules,
        { ...calendar, holidays: new Set(["2026-11-25"]) },
        TZ,
        now,
      )[0]?.holidayMin,
    ).toBe(480);
  });

  it("finds weekly overtime above the weekly hours", () => {
    // Six 8-hour days Monday–Saturday = 48 h: the last 8 h are overtime.
    const week = ["02", "03", "04", "05", "06", "07"].map((day) =>
      shift(`2026-11-${day}`, "06:00", "14:00"),
    );
    const result = sessionBreakdowns(week, { ...rules, overtimeMode: "weekly" }, calendar, TZ, now);
    expect(result.map((item) => item.overtimeMin)).toEqual([0, 0, 0, 0, 0, 480]);
    expect(result.reduce((sum, item) => sum + item.regularMin, 0)).toBe(2400);
  });
});

describe("pay", () => {
  it("pays hours with the rate and adds premiums", () => {
    // 8 h regular + 30 min overtime, of which nothing at night: 10 × 8.5 + 10 × 0.5 × 30 %.
    const [day] = sessionBreakdowns(
      [shift("2026-11-02", "06:00", "14:00", "2026-11-02T14:30")],
      rules,
      calendar,
      TZ,
      now,
    );
    expect(roundMoney(sessionPay(day!, "10", rules)!)).toBe("86.5");
    expect(sessionPay(day!, null, rules)).toBeNull();
  });

  it("adds coinciding premiums (night on a holiday)", () => {
    const [night] = sessionBreakdowns(
      [shift("2026-11-24", "22:00", "06:00", undefined, true)],
      rules,
      { ...calendar, holidays: new Set(["2026-11-25"]) },
      TZ,
      now,
    );
    // 8 h × 10 = 80; night 8 h × 3 = 24; holiday 6 h (after midnight) × 5 = 30.
    expect(night).toMatchObject({ nightMin: 480, holidayMin: 360 });
    expect(roundMoney(sessionPay(night!, "10", rules)!)).toBe("134");
  });

  it("uses the rate valid on the work date", () => {
    const rates = [
      { validFrom: "2026-01-01", rate: "8" },
      { validFrom: "2026-11-15", rate: "9.5" },
    ];
    expect(rateOn("2026-11-14", rates)).toBe("8");
    expect(rateOn("2026-11-15", rates)).toBe("9.5");
    expect(rateOn("2025-12-31", rates)).toBeNull();
  });

  it("rounds money to cents", () => {
    expect(roundMoney("10.005")).toBe("10.01");
    expect(roundMoney("10.004")).toBe("10");
  });
});

describe("monthTotals", () => {
  it("sums the month, keeps earlier days for the weekly limit and warns about long weeks", () => {
    const sessions = [
      shift("2026-10-30", "06:00", "14:00"),
      ...["02", "03", "04", "05", "06", "07", "08"].map((day) =>
        shift(`2026-11-${day}`, "06:00", "18:00"),
      ),
    ];
    const totals = monthTotals(
      sessions,
      { ...rules, overtimeMode: "weekly" },
      calendar,
      [{ validFrom: "2026-01-01", rate: "10" }],
      { from: "2026-11-01", to: "2026-11-30" },
      TZ,
      now,
    );
    // 7 × 12 h = 84 h in one week: 40 regular, 44 overtime (> 10 h → warning).
    expect(totals).toMatchObject({
      days: 7,
      regularMin: 2400,
      overtimeMin: 2640,
      weekendMin: 2 * 720,
      overtimeWarnings: ["2026-11-02"],
      unpricedSessions: 0,
    });
    // 84 h × 10 + 44 h × 3 + 24 h weekend × 3 = 840 + 132 + 72.
    expect(totals.pay).toBe("1044");
  });

  it("reports sessions without a rate", () => {
    const totals = monthTotals(
      [shift("2026-11-02", "06:00", "14:00")],
      rules,
      calendar,
      [],
      { from: "2026-11-01", to: "2026-11-30" },
      TZ,
      now,
    );
    expect(totals).toMatchObject({ pay: null, unpricedSessions: 1, regularMin: 480 });
  });
});
