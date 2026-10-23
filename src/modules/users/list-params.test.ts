import { describe, expect, it } from "vitest";
import { parseMemberListParams } from "./list-params";

describe("parseMemberListParams", () => {
  it("defaults to all roles and statuses", () => {
    expect(parseMemberListParams({})).toEqual({
      page: 1,
      pageSize: 25,
      q: "",
      role: undefined,
      status: undefined,
    });
  });

  it("accepts a role key and a status", () => {
    expect(parseMemberListParams({ role: "operator", status: "inactive" })).toMatchObject({
      role: "operator",
      status: "inactive",
    });
  });

  it("ignores malformed filters", () => {
    expect(parseMemberListParams({ role: "Admin; drop", status: "deleted" })).toMatchObject({
      role: undefined,
      status: undefined,
    });
  });
});
