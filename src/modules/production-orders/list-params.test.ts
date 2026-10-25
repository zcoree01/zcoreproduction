import { describe, expect, it } from "vitest";
import { parseOrderListParams, parseOrderTab } from "./list-params";

const ID = "5b7a1f6e-2c3d-4e5f-8a9b-0c1d2e3f4a5b";

describe("order list params", () => {
  it("reads valid filters", () => {
    expect(
      parseOrderListParams({
        status: "in_progress",
        priority: "1",
        customer: ID,
        machine: ID,
        due: "overdue",
        q: "RN13",
      }),
    ).toMatchObject({
      status: "in_progress",
      priority: "1",
      customer: ID,
      machine: ID,
      due: "overdue",
      q: "RN13",
      page: 1,
    });
  });

  it("drops invalid values instead of failing", () => {
    expect(
      parseOrderListParams({ status: "done", priority: "9", customer: "x", due: "soon" }),
    ).toMatchObject({
      status: undefined,
      priority: undefined,
      customer: undefined,
      due: undefined,
    });
  });

  it("falls back to the overview tab", () => {
    expect(parseOrderTab({ tab: "operations" })).toBe("operations");
    expect(parseOrderTab({ tab: "x" })).toBe("overview");
    expect(parseOrderTab({})).toBe("overview");
  });
});
