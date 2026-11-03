import { describe, expect, it } from "vitest";
import { defaultPeriod, parseReportParams, reportQuery } from "./params";

const MACHINE = "11111111-1111-4111-8111-111111111111";

describe("report params", () => {
  it("offers this month, last month and the last 30 days", () => {
    expect(defaultPeriod("2030-03-15", "thisMonth")).toEqual({
      from: "2030-03-01",
      to: "2030-03-15",
    });
    expect(defaultPeriod("2030-03-15", "lastMonth")).toEqual({
      from: "2030-02-01",
      to: "2030-02-28",
    });
    expect(defaultPeriod("2030-03-15", "last30")).toEqual({ from: "2030-02-14", to: "2030-03-15" });
  });

  it("parses filters and falls back to this month for an unusable period", () => {
    expect(
      parseReportParams(
        { tab: "machines", from: "2030-01-01", to: "2030-01-31", machine: MACHINE },
        "2030-03-15",
      ),
    ).toEqual({
      filters: {
        tab: "machines",
        from: "2030-01-01",
        to: "2030-01-31",
        group: "day",
        machine: MACHINE,
        employee: undefined,
        customer: undefined,
        order: undefined,
      },
      invalid: false,
    });
    const reversed = parseReportParams(
      { from: "2030-02-01", to: "2030-01-01", machine: "x" },
      "2030-03-15",
    );
    expect(reversed.invalid).toBe(true);
    expect(reversed.filters).toMatchObject({
      tab: "production",
      from: "2030-03-01",
      to: "2030-03-15",
    });
    expect(reversed.filters.machine).toBeUndefined();
    expect(parseReportParams({ from: "2029-01-01", to: "2030-03-01" }, "2030-03-15").invalid).toBe(
      true,
    );
    expect(parseReportParams({}, "2030-03-15").invalid).toBe(false);
  });

  it("writes only the filters in use", () => {
    const { filters } = parseReportParams({ tab: "orders", group: "machine" }, "2030-03-15");
    expect(reportQuery(filters)).toBe("tab=orders&from=2030-03-01&to=2030-03-15");
    expect(reportQuery({ ...filters, tab: "production", machine: MACHINE })).toBe(
      `tab=production&from=2030-03-01&to=2030-03-15&group=machine&machine=${MACHINE}`,
    );
  });
});
