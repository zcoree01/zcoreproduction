import { describe, expect, it } from "vitest";
import {
  fullMonths,
  fullYearDays,
  leaveBalance,
  leaveEntitlement,
  workingDays,
  type LeaveData,
  type LeaveRules,
} from "./leave-rules";

const rules: LeaveRules = {
  baseDays: 20,
  extraDays: 1,
  extraEveryYears: 5,
  maxDays: 30,
  probationMonths: 6,
};

const data = (overrides: Partial<LeaveData> = {}): LeaveData => ({
  hiredOn: "2015-03-01",
  priorServiceMonths: 0,
  carriedOverDays: 0,
  entitlementOverride: null,
  usedDays: 0,
  pendingDays: 0,
  ...overrides,
});

describe("fullMonths", () => {
  it("counts whole months, both days included", () => {
    expect(fullMonths("2026-03-01", "2026-12-31")).toBe(10);
    expect(fullMonths("2026-03-15", "2026-12-31")).toBe(9);
    expect(fullMonths("2026-01-01", "2026-01-30")).toBe(0);
    expect(fullMonths("2026-01-01", "2026-01-31")).toBe(1);
  });
});

describe("fullYearDays", () => {
  it("adds a day per 5 years of service and caps at the maximum", () => {
    expect(fullYearDays(rules, 4 * 12 + 11)).toBe(20);
    expect(fullYearDays(rules, 5 * 12)).toBe(21);
    expect(fullYearDays(rules, 12 * 12)).toBe(22);
    expect(fullYearDays(rules, 80 * 12)).toBe(30);
    expect(fullYearDays({ ...rules, extraEveryYears: 0 }, 40 * 12)).toBe(20);
    expect(fullYearDays({ ...rules, extraEveryYears: 3 }, 9 * 12)).toBe(23);
  });
});

describe("leaveEntitlement", () => {
  it("counts service up to 1 January including earlier service", () => {
    // Hired 1 Mar 2015: 11 years and 10 months on 1 Jan 2027 → 2 extra days.
    expect(leaveEntitlement(2027, rules, data())).toBe(22);
    // 9 years and 10 months on 1 Jan 2025 → 1 extra day.
    expect(leaveEntitlement(2025, rules, data())).toBe(21);
    expect(leaveEntitlement(2025, rules, data({ priorServiceMonths: 3 }))).toBe(22);
  });

  it("gives one day per month until the first months are worked", () => {
    // Hired 1 Sep 2026: 4 full months by the end of the year.
    expect(leaveEntitlement(2026, rules, data({ hiredOn: "2026-09-01" }))).toBe(4);
    // Next year: full days.
    expect(leaveEntitlement(2027, rules, data({ hiredOn: "2026-09-01" }))).toBe(20);
  });

  it("gives the proportional part in the year of hiring after the first months", () => {
    // Hired 1 Mar 2026: 10 months → 20 × 10 / 12 ≈ 17.
    expect(leaveEntitlement(2026, rules, data({ hiredOn: "2026-03-01" }))).toBe(17);
  });

  it("uses the override and handles unknown hire dates and future hires", () => {
    expect(leaveEntitlement(2026, rules, data({ entitlementOverride: 25 }))).toBe(25);
    expect(leaveEntitlement(2026, rules, data({ hiredOn: null, priorServiceMonths: 120 }))).toBe(
      22,
    );
    expect(leaveEntitlement(2026, rules, data({ hiredOn: "2027-02-01" }))).toBe(0);
  });
});

describe("leaveBalance", () => {
  it("subtracts used and requested days and adds the carry-over", () => {
    expect(
      leaveBalance(2026, rules, data({ carriedOverDays: 3, usedDays: 10, pendingDays: 5 })),
    ).toEqual({ entitlement: 22, carriedOver: 3, used: 10, pending: 5, available: 10 });
  });
});

describe("workingDays", () => {
  it("counts Monday to Friday", () => {
    expect(workingDays("2026-10-26", "2026-11-01")).toBe(5);
    expect(workingDays("2026-10-31", "2026-11-01")).toBe(0);
    expect(workingDays("2026-10-30", "2026-11-02")).toBe(2);
  });
});
