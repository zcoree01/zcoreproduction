import { describe, expect, it } from "vitest";
import {
  actualCycleSeconds,
  cycleDeviationPercent,
  downtimeByReason,
  hasShortage,
  orderScrapRatePercent,
  remainingQuantity,
  reportProblem,
  scrapRatePercent,
  unreportedOnFinish,
  workButtons,
  type ReportCheck,
} from "./rules";

const base: ReportCheck = {
  input: "100",
  reportedGood: "0",
  reportedScrap: "0",
  good: "40",
  scrap: "0",
  wholePieces: true,
  finish: false,
};

describe("remainingQuantity", () => {
  it("is what arrived minus good and scrap", () => {
    expect(remainingQuantity("100", "40", "2")).toBe("58");
    expect(remainingQuantity("12.5", "10.25", "0")).toBe("2.25");
  });

  it("never goes below zero (voided reports upstream)", () => {
    expect(remainingQuantity("10", "12", "1")).toBe("0");
  });
});

describe("reportProblem", () => {
  it("accepts a part report within what arrived", () => {
    expect(reportProblem(base)).toBeNull();
    expect(reportProblem({ ...base, reportedGood: "40", good: "58", scrap: "2" })).toBeNull();
  });

  it("needs a quantity unless finishing", () => {
    expect(reportProblem({ ...base, good: "0" })).toBe("quantity_required");
    expect(reportProblem({ ...base, good: "0", reportedGood: "10", finish: true })).toBeNull();
  });

  it("refuses more than reached the operation (good and scrap together)", () => {
    expect(reportProblem({ ...base, reportedGood: "90", good: "10", scrap: "1" })).toBe(
      "quantity_exceeds_input",
    );
    expect(reportProblem({ ...base, input: "0", good: "1" })).toBe("quantity_exceeds_input");
  });

  it("counts pieces whole, other units with decimals", () => {
    expect(reportProblem({ ...base, good: "1.5" })).toBe("whole_pieces_required");
    expect(reportProblem({ ...base, scrap: "0.5" })).toBe("whole_pieces_required");
    expect(reportProblem({ ...base, input: "12.5", good: "12.5", wholePieces: false })).toBeNull();
  });

  it("cannot finish an operation on which nothing was reported", () => {
    expect(reportProblem({ ...base, good: "0", finish: true })).toBe("nothing_reported");
  });
});

describe("unreportedOnFinish", () => {
  it("shows pieces that would be left without a report", () => {
    expect(unreportedOnFinish({ ...base, reportedGood: "50", good: "40", scrap: "5" })).toBe("5");
    expect(unreportedOnFinish({ ...base, good: "100" })).toBe("0");
  });
});

describe("hasShortage", () => {
  it("compares good pieces with the ordered quantity exactly", () => {
    expect(hasShortage("119", "120")).toBe(true);
    expect(hasShortage("120", "120")).toBe(false);
    expect(hasShortage("121", "120")).toBe(false);
    expect(hasShortage("12.499", "12.5")).toBe(true);
  });
});

describe("workButtons", () => {
  it("offers start on an arrived operation nobody started", () => {
    expect(workButtons({ blocked: null, working: false, operationStatus: "ready" })).toEqual({
      start: true,
      pause: false,
      report: false,
      finish: false,
    });
  });

  it("lets the worker who is working pause, report and finish", () => {
    expect(workButtons({ blocked: null, working: true, operationStatus: "in_progress" })).toEqual({
      start: false,
      pause: true,
      report: true,
      finish: true,
    });
  });

  it("offers continue, report and finish on a paused operation", () => {
    expect(workButtons({ blocked: null, working: false, operationStatus: "paused" })).toEqual({
      start: true,
      pause: false,
      report: true,
      finish: true,
    });
  });

  it("blocks starting until pieces arrive, but a started operation can still be finished", () => {
    expect(
      workButtons({ blocked: "not_arrived", working: false, operationStatus: "waiting" }),
    ).toEqual({ start: false, pause: false, report: false, finish: false });
    expect(
      workButtons({ blocked: "order_paused", working: true, operationStatus: "in_progress" }),
    ).toEqual({ start: false, pause: true, report: true, finish: true });
  });

  it("offers nothing on foreign, closed or done operations", () => {
    for (const blocked of ["not_assigned", "order_closed", "operation_done"] as const) {
      expect(workButtons({ blocked, working: false, operationStatus: "in_progress" })).toEqual({
        start: false,
        pause: false,
        report: false,
        finish: false,
      });
    }
  });
});

describe("actualCycleSeconds", () => {
  it("is machine time without the planned setup per reported piece", () => {
    // 30 min run, 10 min setup, 10 pieces → 120 s per piece.
    expect(
      actualCycleSeconds({
        runSeconds: "1800",
        setupTimeMin: "10",
        goodQuantity: "9",
        scrapQuantity: "1",
      }),
    ).toBe("120");
  });

  it("is null without pieces and never negative", () => {
    const base = { runSeconds: "300", setupTimeMin: "10", goodQuantity: "0", scrapQuantity: "0" };
    expect(actualCycleSeconds(base)).toBeNull();
    expect(actualCycleSeconds({ ...base, goodQuantity: "2" })).toBe("0");
  });
});

describe("cycleDeviationPercent", () => {
  it("compares actual with planned", () => {
    expect(cycleDeviationPercent("120", "100")).toBe("20");
    expect(cycleDeviationPercent("90", "100")).toBe("-10");
    expect(cycleDeviationPercent(null, "100")).toBeNull();
    expect(cycleDeviationPercent("90", null)).toBeNull();
  });
});

describe("scrapRatePercent", () => {
  it("is scrap of all reported pieces", () => {
    expect(scrapRatePercent("9", "1")).toBe("10");
    expect(scrapRatePercent("2", "1")).toBe("33.3");
    expect(scrapRatePercent("0", "0")).toBeNull();
  });
});

describe("downtimeByReason", () => {
  it("sums per reason, longest first", () => {
    expect(
      downtimeByReason([
        { reason: "Kvar", seconds: "600" },
        { reason: "Alat", seconds: "300" },
        { reason: "Kvar", seconds: "60.5" },
      ]),
    ).toEqual([
      { reason: "Kvar", seconds: "660.5", count: 2 },
      { reason: "Alat", seconds: "300", count: 1 },
    ]);
  });
});

describe("orderScrapRatePercent", () => {
  it("relates all scrap to the pieces that entered production", () => {
    expect(
      orderScrapRatePercent([
        { operationSequence: 1, good: "5", scrap: "0" },
        { operationSequence: 3, good: "4", scrap: "1" },
      ]),
    ).toBe("20");
    expect(orderScrapRatePercent([])).toBeNull();
  });
});
