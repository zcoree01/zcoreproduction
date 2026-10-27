import { describe, expect, it } from "vitest";
import {
  absenceDaysByKind,
  effectiveRates,
  formatMoney,
  hoursLabel,
  toWeekendDays,
} from "./month-rules";

const calendar = { weekendDays: [6, 7] as const, holidays: new Set(["2026-11-25"]) };
const november = { from: "2026-11-01", to: "2026-11-30" };

describe("absenceDaysByKind", () => {
  it("counts working days inside the month without weekends and holidays", () => {
    expect(
      absenceDaysByKind(
        [
          { kind: "vacation", startDate: "2026-10-28", endDate: "2026-11-04" },
          { kind: "vacation", startDate: "2026-11-23", endDate: "2026-11-27" },
        ],
        november,
        calendar,
        "2026-12-10",
      ),
    ).toEqual({ vacation: 3 + 4 });
  });

  it("runs an open sick leave until today and uses the employee's weekend", () => {
    expect(
      absenceDaysByKind(
        [{ kind: "sick", startDate: "2026-11-16", endDate: null }],
        november,
        { weekendDays: [2, 3], holidays: new Set() },
        "2026-11-22",
      ),
    ).toEqual({ sick: 5 });
  });
});

describe("helpers", () => {
  it("reads weekend days defensively", () => {
    expect(toWeekendDays(null)).toEqual([6, 7]);
    expect(toWeekendDays([7, 2, 2, 9])).toEqual([2, 7]);
  });

  it("falls back to the default rate before an own rate", () => {
    expect(effectiveRates([], "8")).toEqual([{ validFrom: "0001-01-01", rate: "8" }]);
    expect(effectiveRates([{ validFrom: "2026-06-01", rate: "9" }], "8")).toEqual([
      { validFrom: "0001-01-01", rate: "8" },
      { validFrom: "2026-06-01", rate: "9" },
    ]);
    expect(effectiveRates([], null)).toEqual([]);
  });

  it("formats hours and money", () => {
    expect(hoursLabel(450)).toBe("7,5");
    expect(hoursLabel(20)).toBe("0,3");
    expect(formatMoney("1234.5")).toBe("1.234,50");
    expect(formatMoney("86")).toBe("86,00");
  });
});
