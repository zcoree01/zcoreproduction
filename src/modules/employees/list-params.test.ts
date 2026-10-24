import { describe, expect, it } from "vitest";
import { parseEmployeeListParams } from "./list-params";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("parseEmployeeListParams", () => {
  it("defaults to current employees without filters", () => {
    expect(parseEmployeeListParams({})).toEqual({
      page: 1,
      pageSize: 25,
      q: "",
      department: undefined,
      skill: undefined,
      status: undefined,
      view: undefined,
    });
  });

  it("accepts known filters", () => {
    expect(
      parseEmployeeListParams({
        department: UUID,
        skill: UUID,
        status: "inactive",
        view: "archived",
      }),
    ).toMatchObject({ department: UUID, skill: UUID, status: "inactive", view: "archived" });
  });

  it("drops malformed filters", () => {
    expect(
      parseEmployeeListParams({ department: "x", skill: "1,2", status: "fired", view: "x" }),
    ).toMatchObject({
      department: undefined,
      skill: undefined,
      status: undefined,
      view: undefined,
    });
  });
});
