import { describe, expect, it } from "vitest";
import { parseMachineListParams } from "./list-params";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("parseMachineListParams", () => {
  it("defaults to current machines without filters", () => {
    expect(parseMachineListParams({})).toEqual({
      page: 1,
      pageSize: 25,
      q: "",
      status: undefined,
      type: undefined,
      location: undefined,
      view: undefined,
    });
  });

  it("accepts known filters", () => {
    expect(
      parseMachineListParams({
        status: "maintenance",
        type: UUID,
        location: UUID,
        view: "archived",
      }),
    ).toMatchObject({ status: "maintenance", type: UUID, location: UUID, view: "archived" });
  });

  it("drops malformed filters", () => {
    expect(
      parseMachineListParams({ status: "broken", type: "1 or 1=1", view: "all" }),
    ).toMatchObject({ status: undefined, type: undefined, view: undefined });
  });
});
