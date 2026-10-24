import { describe, expect, it } from "vitest";
import { parseProductDetailParams, parseProductListParams } from "./list-params";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("parseProductListParams", () => {
  it("parses filters and drops invalid values", () => {
    expect(
      parseProductListParams({ type: UUID, customer: "x", view: "archived", q: " osovina " }),
    ).toEqual({
      page: 1,
      pageSize: 25,
      q: "osovina",
      type: UUID,
      customer: undefined,
      view: "archived",
    });
    expect(parseProductListParams({ view: "all" }).view).toBeUndefined();
  });
});

describe("parseProductDetailParams", () => {
  it("defaults to the basic tab and the current revision", () => {
    expect(parseProductDetailParams({})).toEqual({ tab: "basic", revisionId: null });
    expect(parseProductDetailParams({ tab: "nope", rev: "x" })).toEqual({
      tab: "basic",
      revisionId: null,
    });
    expect(parseProductDetailParams({ tab: "history", rev: UUID })).toEqual({
      tab: "history",
      revisionId: UUID,
    });
  });
});
