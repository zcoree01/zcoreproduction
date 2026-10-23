import { describe, expect, it } from "vitest";
import { pageRange, parseTableParams, toSearchPattern } from "./params";

describe("parseTableParams", () => {
  it("uses defaults for an empty URL", () => {
    expect(parseTableParams({})).toEqual({ page: 1, pageSize: 25, q: "" });
  });

  it("parses valid values", () => {
    expect(parseTableParams({ page: "3", pageSize: "50", q: "  ana " })).toEqual({
      page: 3,
      pageSize: 50,
      q: "ana",
    });
  });

  it("falls back instead of failing on hostile input", () => {
    expect(parseTableParams({ page: "-1", pageSize: "1000", q: "x".repeat(500) })).toEqual({
      page: 1,
      pageSize: 25,
      q: "",
    });
    expect(parseTableParams({ page: "abc", pageSize: "7" })).toMatchObject({
      page: 1,
      pageSize: 25,
    });
  });

  it("takes the first value of repeated params", () => {
    expect(parseTableParams({ page: ["2", "9"] }).page).toBe(2);
  });
});

describe("pageRange", () => {
  it("returns inclusive offsets", () => {
    expect(pageRange({ page: 1, pageSize: 25 })).toEqual({ from: 0, to: 24 });
    expect(pageRange({ page: 3, pageSize: 10 })).toEqual({ from: 20, to: 29 });
  });
});

describe("toSearchPattern", () => {
  it("wraps the query for ILIKE and keeps Bosnian letters", () => {
    expect(toSearchPattern("Šef")).toBe("%Šef%");
    expect(toSearchPattern("đorđe ćatić")).toBe("%đorđe ćatić%");
  });

  it("strips characters that would break PostgREST filters or act as wildcards", () => {
    expect(toSearchPattern("a,b)(or=1%")).toBe("%a b or 1%");
    expect(toSearchPattern("sef_1")).toBe("%sef\\_1%");
  });

  it("returns null when nothing searchable remains", () => {
    expect(toSearchPattern("   ")).toBeNull();
    expect(toSearchPattern("%%,()")).toBeNull();
  });
});
