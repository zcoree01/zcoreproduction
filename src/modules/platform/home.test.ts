import { describe, expect, it } from "vitest";
import {
  firmTrend,
  formatKm,
  overdueLockedCount,
  platformHomeSchema,
  revenueProgress,
  stateSlices,
} from "./home";

const example = {
  today: "2026-11-09",
  firms: {
    using: 14,
    using_last_month: 12,
    trial: 3,
    active: 11,
    warning: 3,
    overdue: 0,
    locked: 1,
  },
  users: 412,
  todo: {
    directory_requests: 4,
    support_pending: 1,
    trials_ending: 2,
    deletions_scheduled: 1,
    problem_reports_open: 5,
    slow_open: 2,
  },
  overdue: [
    {
      organization_id: "6f1c2a52-0000-4000-8000-000000000001",
      name: "Firma d.o.o.",
      package_name: "Standard",
      period: "2026-10-01",
      amount: "450.00",
      days_late: 9,
      state: "locked",
    },
  ],
  revenue: {
    paid: "4350.00",
    expected: "5200.00",
    overdue_total: "1250.00",
    by_month: [{ period: "2025-12-01", paid: "300.00" }],
  },
  usage: { active_7d: 286, by_day: [{ day: "2026-10-11", users: 120 }] },
  problems: { open: 5, slow_open: 2, resolved_this_month: 12, avg_resolution_days: "1.4" },
};

describe("revenueProgress", () => {
  it("floors to a whole percent", () => {
    expect(revenueProgress("4350.00", "5200.00")).toBe(83);
  });
  it("is 0 when nothing is expected", () => {
    expect(revenueProgress("10", "0")).toBe(0);
  });
  it("is capped at 100", () => {
    expect(revenueProgress("6000", "5200")).toBe(100);
  });
});

describe("firmTrend", () => {
  it("goes up", () => {
    expect(firmTrend(14, 12)).toEqual({ delta: 2, direction: "up" });
  });
  it("goes down", () => {
    expect(firmTrend(10, 12)).toEqual({ delta: -2, direction: "down" });
  });
  it("stays the same", () => {
    expect(firmTrend(5, 5).direction).toBe("same");
  });
});

describe("stateSlices", () => {
  it("drops zeros and keeps the fixed order", () => {
    expect(stateSlices(example.firms)).toEqual([
      { key: "active", value: 11 },
      { key: "trial", value: 3 },
      { key: "warning", value: 3 },
      { key: "locked", value: 1 },
    ]);
  });
});

describe("platformHomeSchema", () => {
  it("accepts usage, problems and the new todo counts", () => {
    const parsed = platformHomeSchema.parse(example);
    expect(parsed.usage.active_7d).toBe(286);
    expect(parsed.problems.avg_resolution_days).toBe("1.4");
    expect(parsed.todo.slow_open).toBe(2);
    const none = platformHomeSchema.parse({
      ...example,
      problems: { ...example.problems, avg_resolution_days: null },
    });
    expect(none.problems.avg_resolution_days).toBeNull();
  });
  it("accepts the RPC example", () => {
    expect(platformHomeSchema.parse(example).revenue?.paid).toBe("4350.00");
  });
  it("accepts revenue: null", () => {
    expect(platformHomeSchema.parse({ ...example, revenue: null }).revenue).toBeNull();
  });
});

describe("formatKm", () => {
  it("groups thousands and drops zero cents", () => {
    expect(formatKm("4350.00")).toBe("4.350 KM");
    expect(formatKm("1234567.5")).toBe("1.234.567,50 KM");
    expect(formatKm("0.00")).toBe("0 KM");
  });
});

describe("overdueLockedCount", () => {
  const row = (state: "overdue" | "locked") => ({
    organization_id: "o",
    name: "n",
    package_name: null,
    period: "2026-11-01",
    amount: "10.00",
    days_late: 1,
    state,
  });
  it("counts only locked unpaid firms", () => {
    expect(overdueLockedCount([])).toBe(0);
    expect(overdueLockedCount([row("overdue"), row("locked"), row("locked")])).toBe(2);
    expect(overdueLockedCount([row("overdue")])).toBe(0);
  });
});
