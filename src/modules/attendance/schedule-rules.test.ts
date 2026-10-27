import { describe, expect, it } from "vitest";
import {
  addDays,
  dateRange,
  daysBetween,
  isoWeekday,
  isWeekend,
  mondayOf,
  rotationDay,
  scheduleRange,
  shiftRange,
} from "./schedule-rules";

describe("calendar dates", () => {
  it("adds days across months, years and the DST weekend", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-10-26", "2026-10-24")).toBe(-2);
  });

  it("knows weekdays and Mondays", () => {
    expect(isoWeekday("2026-10-26")).toBe(1);
    expect(isoWeekday("2026-11-01")).toBe(7);
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
    expect(isWeekend("2026-10-31")).toBe(true);
    expect(isWeekend("2026-10-30")).toBe(false);
  });

  it("lists a range including both ends", () => {
    expect(dateRange("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(dateRange("2026-11-02", "2026-11-01")).toEqual([]);
  });
});

describe("rotationDay", () => {
  it("repeats the cycle from the start date", () => {
    expect(rotationDay("2026-10-26", "2026-10-26", 14)).toBe(0);
    expect(rotationDay("2026-11-02", "2026-10-26", 14)).toBe(7);
    expect(rotationDay("2026-11-09", "2026-10-26", 14)).toBe(0);
    expect(rotationDay("2026-10-25", "2026-10-26", 14)).toBeNull();
  });

  it("gives four crews on an 8-day turnus different days", () => {
    // Crews start 2 days apart: on one date each is on a different pair of days.
    const starts = ["2026-10-26", "2026-10-28", "2026-10-30", "2026-11-01"];
    const days = starts.map((start) => rotationDay("2026-11-03", start, 8));
    expect(days).toEqual([0, 6, 4, 2]);
  });
});

describe("schedule grid range", () => {
  it("shows a week from Monday or a whole month", () => {
    expect(scheduleRange("week", "2026-10-29")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(scheduleRange("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(scheduleRange("month", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("pages by week or month", () => {
    expect(shiftRange("week", "2026-10-29", 1)).toBe("2026-11-02");
    expect(shiftRange("week", "2026-10-29", -1)).toBe("2026-10-19");
    expect(shiftRange("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftRange("month", "2026-01-15", -1)).toBe("2025-12-01");
  });
});
