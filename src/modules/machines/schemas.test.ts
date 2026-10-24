import { describe, expect, it } from "vitest";
import { machineSchema, toMachineRow } from "./schemas";
import { allowedStatusTargets, canSetStatus } from "./status-rules";

const TYPE_ID = "11111111-1111-4111-8111-111111111111";

const VALID = {
  code: " CNC-01 ",
  name: " Haas VF-2 ",
  typeId: TYPE_ID,
  manufacturer: " Haas ",
  model: "",
  locationId: "",
  status: "available",
  notes: "  ",
};

describe("machineSchema", () => {
  it("trims text and maps empty optional values to null", () => {
    expect(machineSchema.parse(VALID)).toEqual({
      code: "CNC-01",
      name: "Haas VF-2",
      typeId: TYPE_ID,
      manufacturer: "Haas",
      model: null,
      locationId: null,
      status: "available",
      notes: null,
    });
  });

  it("requires code, name and a known status", () => {
    const result = machineSchema.safeParse({ ...VALID, code: " ", name: "", status: "broken" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual(["code", "name", "status"]);
  });

  it("rejects references that are not uuids", () => {
    expect(machineSchema.safeParse({ ...VALID, typeId: "cnc" }).success).toBe(false);
  });

  it("maps to database column names", () => {
    expect(toMachineRow(machineSchema.parse(VALID))).toEqual({
      code: "CNC-01",
      name: "Haas VF-2",
      type_id: TYPE_ID,
      manufacturer: "Haas",
      model: null,
      location_id: null,
      status: "available",
      notes: null,
    });
  });
});

describe("machine status rules", () => {
  it("operators may set every status except inactive", () => {
    expect(canSetStatus("operator", "running", "stopped")).toBe(true);
    expect(canSetStatus("operator", "stopped", "maintenance")).toBe(true);
    expect(canSetStatus("operator", "running", "inactive")).toBe(false);
  });

  it("operators cannot touch an inactive machine", () => {
    expect(allowedStatusTargets("operator", "inactive")).toEqual([]);
    expect(canSetStatus("operator", "inactive", "available")).toBe(false);
  });

  it("managers may set any status, including inactive and back", () => {
    expect(canSetStatus("manager", "running", "inactive")).toBe(true);
    expect(canSetStatus("manager", "inactive", "available")).toBe(true);
  });

  it("setting the current status again is not a change", () => {
    expect(canSetStatus("manager", "running", "running")).toBe(false);
    expect(canSetStatus("operator", "running", "running")).toBe(false);
  });
});
