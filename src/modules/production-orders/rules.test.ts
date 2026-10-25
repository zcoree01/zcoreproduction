import { describe, expect, it } from "vitest";
import {
  barPlan,
  computedPriority,
  daysBetween,
  daysNeeded,
  DEFAULT_ORDER_SETTINGS,
  dueWarning,
  effectivePriority,
  formatOrderNumber,
  isoWeek,
  isValidOrderNumberTemplate,
  orderSettingsFromSettings,
  overridesComputedPriority,
  plannedOperationSeconds,
  plannedOrderSeconds,
  slackDays,
} from "./rules";

describe("order numbers", () => {
  it("formats the product owner's example RN13-0526-358", () => {
    // 2026-01-29 is in ISO week 5.
    expect(formatOrderNumber("RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ}", 3, 13, "2026-01-29", 358)).toBe(
      "RN13-0526-358",
    );
  });

  it("pads the sequence and grows beyond the digits when needed", () => {
    expect(formatOrderNumber("RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ}", 3, 7, "2026-10-25", 1)).toBe(
      "RN7-4326-001",
    );
    expect(formatOrderNumber("{GODINA4}/{BROJ}", 4, 1, "2026-10-25", 12345)).toBe("2026/12345");
  });

  it("uses ISO weeks", () => {
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2026-10-25")).toBe(43);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(isoWeek("2024-12-30")).toBe(1);
  });

  it("validates templates like the database", () => {
    expect(isValidOrderNumberTemplate("RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ}")).toBe(true);
    expect(isValidOrderNumberTemplate("{GODINA4}/{BROJ}")).toBe(true);
    // Without a year numbers would repeat after the yearly restart.
    expect(isValidOrderNumberTemplate("RN-{BROJ}")).toBe(false);
    expect(isValidOrderNumberTemplate("RN-{GODINA}")).toBe(false);
    expect(isValidOrderNumberTemplate("RN{NEPOZNATO}{GODINA}{BROJ}")).toBe(false);
    expect(isValidOrderNumberTemplate("RN,{GODINA}{BROJ}")).toBe(false);
    expect(isValidOrderNumberTemplate(`${"X".repeat(55)}{GODINA}{BROJ}`)).toBe(false);
  });
});

describe("order settings", () => {
  it("falls back to defaults for missing or invalid values", () => {
    expect(orderSettingsFromSettings(null)).toEqual(DEFAULT_ORDER_SETTINGS);
    expect(
      orderSettingsFromSettings({
        order_number_template: "RN-{BROJ}",
        order_number_digits: 9,
        priority_thresholds: [1, 2],
        due_warning_days: [],
        work_hours_per_day: 30,
      }),
    ).toEqual(DEFAULT_ORDER_SETTINGS);
  });

  it("reads stored values", () => {
    expect(
      orderSettingsFromSettings({
        order_number_template: "{GODINA4}-{BROJ}",
        order_number_digits: 4,
        priority_mode: "automatic",
        priority_thresholds: [1, 2, 5, 14],
        due_warning_days: [14, 5],
        work_hours_per_day: 16,
      }),
    ).toEqual({
      numberTemplate: "{GODINA4}-{BROJ}",
      numberDigits: 4,
      priorityMode: "automatic",
      priorityThresholds: [1, 2, 5, 14],
      dueWarningDays: [14, 5],
      workHoursPerDay: 16,
    });
  });
});

describe("planned time", () => {
  const ops = [
    { setupTimeMin: "30", cycleTimeS: "95" },
    { setupTimeMin: "20", cycleTimeS: "140" },
    { setupTimeMin: null, cycleTimeS: null },
  ];

  it("is setup + quantity × cycle per operation", () => {
    // 30 min = 1800 s + 100 × 95 s = 11300 s.
    expect(plannedOperationSeconds({ setupTimeMin: "30", cycleTimeS: "95" }, "100")).toBe("11300");
    expect(plannedOperationSeconds({ setupTimeMin: "2.5", cycleTimeS: "1.5" }, "3")).toBe("154.5");
  });

  it("sums the operations of an order", () => {
    // 11300 + (1200 + 14000) + 0.
    expect(plannedOrderSeconds(ops, "100")).toBe("26500");
    expect(plannedOrderSeconds([], "100")).toBe("0");
  });

  it("works with decimal quantities (kg, m)", () => {
    expect(plannedOrderSeconds([{ setupTimeMin: "0", cycleTimeS: "60" }], "2.5")).toBe("150");
  });
});

describe("schedule", () => {
  it("counts calendar days", () => {
    expect(daysBetween("2026-10-25", "2026-11-04")).toBe(10);
    expect(daysBetween("2026-10-25", "2026-10-24")).toBe(-1);
    // Across the end of daylight saving time.
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("needs whole working days for the remaining time", () => {
    expect(daysNeeded("0", 8)).toBe(0);
    expect(daysNeeded("28800", 8)).toBe(1);
    expect(daysNeeded("28801", 8)).toBe(2);
    expect(daysNeeded("26500", 16)).toBe(1);
  });

  it("computes slack and priority from the thresholds", () => {
    const thresholds = DEFAULT_ORDER_SETTINGS.priorityThresholds;
    // 10 days to the due date, 2 days of work → 8 days to spare.
    expect(slackDays(10, "57600", 8)).toBe(8);
    expect(computedPriority(-2, thresholds)).toBe(1);
    expect(computedPriority(0, thresholds)).toBe(1);
    expect(computedPriority(1, thresholds)).toBe(2);
    expect(computedPriority(7, thresholds)).toBe(3);
    expect(computedPriority(8, thresholds)).toBe(4);
    expect(computedPriority(11, thresholds)).toBe(5);
  });

  it("lets a manual priority win and flags overrides in automatic mode", () => {
    expect(effectivePriority(null, "manual", 1)).toBe(3);
    expect(effectivePriority(null, "automatic", 1)).toBe(1);
    expect(effectivePriority(4, "automatic", 1)).toBe(4);
    expect(overridesComputedPriority(4, "automatic", 1)).toBe(true);
    expect(overridesComputedPriority(1, "automatic", 1)).toBe(false);
    expect(overridesComputedPriority(4, "manual", 1)).toBe(false);
  });

  it("warns 10, 7 and 3 days ahead only while work has not started", () => {
    const base = { status: "planned" as const, slack: 5, started: false, warningDays: [10, 7, 3] };
    expect(dueWarning({ ...base, daysToDue: 11 })).toBeNull();
    expect(dueWarning({ ...base, daysToDue: 10 })).toEqual({ kind: "due_soon", days: 10 });
    expect(dueWarning({ ...base, daysToDue: 6 })).toEqual({ kind: "due_soon", days: 7 });
    expect(dueWarning({ ...base, daysToDue: 3 })).toEqual({ kind: "due_soon", days: 3 });
    expect(dueWarning({ ...base, daysToDue: 3, started: true })).toBeNull();
  });

  it("warns when the work no longer fits or the date has passed", () => {
    const base = { status: "in_progress" as const, started: true, warningDays: [10, 7, 3] };
    expect(dueWarning({ ...base, daysToDue: 20, slack: -1 })).toEqual({ kind: "behind" });
    expect(dueWarning({ ...base, daysToDue: -1, slack: -3 })).toEqual({ kind: "overdue" });
    expect(dueWarning({ ...base, status: "completed", daysToDue: -1, slack: -3 })).toBeNull();
    expect(dueWarning({ ...base, status: "cancelled", daysToDue: 1, slack: -3 })).toBeNull();
  });
});

describe("bar calculation", () => {
  it("fits pieces into the usable length of a bar", () => {
    // 3000 − 200 = 2800 mm; 30 + 2 = 32 mm per piece → 87 pieces.
    expect(
      barPlan({
        barLength: "3000",
        remnant: "200",
        pieceLength: "30",
        kerf: "2",
        quantity: "500",
        wholePieces: true,
      }),
    ).toEqual({ usableLength: "2800", perPiece: "32", piecesPerBar: 87, barsNeeded: 6 });
  });

  it("works without kerf and remnant and with decimals", () => {
    expect(
      barPlan({
        barLength: "3000",
        remnant: null,
        pieceLength: "30",
        kerf: null,
        quantity: "100",
        wholePieces: true,
      }),
    ).toEqual({ usableLength: "3000", perPiece: "30", piecesPerBar: 100, barsNeeded: 1 });
    expect(
      barPlan({
        barLength: "1000",
        remnant: "0",
        pieceLength: "33.3",
        kerf: "0.2",
        quantity: null,
        wholePieces: true,
      })?.piecesPerBar,
    ).toBe(29);
  });

  it("has no plan when lengths are missing or nothing fits", () => {
    const base = { remnant: null, kerf: null, quantity: "10", wholePieces: true };
    expect(barPlan({ ...base, barLength: null, pieceLength: "30" })).toBeNull();
    expect(barPlan({ ...base, barLength: "3000", pieceLength: null })).toBeNull();
    expect(barPlan({ ...base, barLength: "20", pieceLength: "30" })).toBeNull();
    expect(barPlan({ ...base, barLength: "300", remnant: "300", pieceLength: "30" })).toBeNull();
  });

  it("counts no bars for quantities that are not pieces", () => {
    expect(
      barPlan({
        barLength: "3000",
        remnant: null,
        pieceLength: "30",
        kerf: null,
        quantity: "12.5",
        wholePieces: false,
      })?.barsNeeded,
    ).toBeNull();
  });
});
