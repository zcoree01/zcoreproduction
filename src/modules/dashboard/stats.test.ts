import { describe, expect, it } from "vitest";
import { dailyOutput, lastDays, ordersOverview, scrapByReason, seriesMax } from "./stats";

const report = (
  at: string,
  good: string,
  scrap: string,
  extra: Partial<{ voided: boolean; scrapReason: string | null }> = {},
) => ({
  at,
  good,
  scrap,
  voided: false,
  scrapReason: null,
  ...extra,
});

describe("dashboard stats", () => {
  it("lists the last days across a month end", () => {
    expect(lastDays("2026-11-02", 4)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("sums good and scrap per local day, without voided reports", () => {
    const rows = dailyOutput(
      [
        report("2026-11-01T10:00:00Z", "10", "1"),
        report("2026-11-01T12:00:00Z", "5.5", "0"),
        // 23:30 UTC on 1 November is already 2 November in Sarajevo.
        report("2026-11-01T23:30:00Z", "3", "2"),
        report("2026-11-02T08:00:00Z", "100", "0", { voided: true }),
        report("2026-10-20T08:00:00Z", "7", "0"),
      ],
      ["2026-11-01", "2026-11-02"],
      "Europe/Sarajevo",
    );
    expect(rows).toEqual([
      { date: "2026-11-01", good: "15.5", scrap: "1" },
      { date: "2026-11-02", good: "3", scrap: "2" },
    ]);
  });

  it("groups scrap by reason, largest first", () => {
    expect(
      scrapByReason([
        report("2026-11-01T10:00:00Z", "10", "2", { scrapReason: "Mjera" }),
        report("2026-11-01T10:00:00Z", "10", "3", { scrapReason: "Materijal" }),
        report("2026-11-01T10:00:00Z", "10", "1", { scrapReason: "Mjera" }),
        report("2026-11-01T10:00:00Z", "10", "0", { scrapReason: "Ništa" }),
        report("2026-11-01T10:00:00Z", "10", "9", { scrapReason: "Mjera", voided: true }),
        report("2026-11-01T10:00:00Z", "10", "1"),
      ]),
    ).toEqual([
      // Equal totals by name.
      { reason: "Materijal", scrap: "3" },
      { reason: "Mjera", scrap: "3" },
      { reason: null, scrap: "1" },
    ]);
  });

  it("counts open orders per status and late ones", () => {
    const overview = ordersOverview([
      { status: "in_progress", dueWarning: { kind: "overdue" } },
      { status: "in_progress", dueWarning: null },
      { status: "planned", dueWarning: { kind: "behind" } },
      { status: "ready", dueWarning: { kind: "due_soon" } },
    ]);
    expect(overview.total).toBe(4);
    expect(overview.overdue).toBe(1);
    expect(overview.behind).toBe(1);
    expect(overview.byStatus.find((row) => row.status === "in_progress")?.count).toBe(2);
    expect(overview.byStatus.find((row) => row.status === "draft")?.count).toBe(0);
  });

  it("finds the largest value", () => {
    expect(seriesMax(["2", "10.5", "3"])).toBe("10.5");
    expect(seriesMax([])).toBe("0");
  });
});
