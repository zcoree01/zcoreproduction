import { describe, expect, it } from "vitest";
import { filterMaterialOptions, materialGroupSchema, materialSchema } from "./schemas";

const OPTIONS = [
  { designation: "C45", groupName: "Čelik" },
  { designation: "1.4301 (AISI 304)", groupName: "Nehrđajući čelik (inox)" },
  { designation: "1.4404 (AISI 316L)", groupName: "Nehrđajući čelik (inox)" },
  { designation: "EN AW-6082 (AlSi1MgMn)", groupName: "Aluminij" },
];

describe("filterMaterialOptions", () => {
  it("matches every typed word in designation or group", () => {
    expect(filterMaterialOptions(OPTIONS, "inox 304").map((o) => o.designation)).toEqual([
      "1.4301 (AISI 304)",
    ]);
    expect(filterMaterialOptions(OPTIONS, "6082")).toHaveLength(1);
    expect(filterMaterialOptions(OPTIONS, "  ")).toHaveLength(4);
    expect(filterMaterialOptions(OPTIONS, "titan")).toEqual([]);
  });

  it("ignores case and diacritics and ranks designation matches first", () => {
    // "celik" matches "Čelik" and "Nehrđajući čelik"; C45 has it only in the group.
    expect(filterMaterialOptions(OPTIONS, "CELIK")).toHaveLength(3);
    expect(filterMaterialOptions(OPTIONS, "nehrdajuci")).toHaveLength(2);
    expect(filterMaterialOptions(OPTIONS, "c4").map((o) => o.designation)[0]).toBe("C45");
  });
});

describe("material schemas", () => {
  const GROUP = "11111111-1111-4111-8111-111111111111";

  it("accepts densities in kg/dm³ with a decimal comma", () => {
    expect(materialGroupSchema.parse({ name: " Čelik ", density: "7,85" })).toEqual({
      name: "Čelik",
      density: "7.85",
    });
    expect(materialSchema.parse({ groupId: GROUP, designation: "C45", density: "" })).toEqual({
      groupId: GROUP,
      designation: "C45",
      density: null,
    });
  });

  it("rejects zero, negative or implausible densities", () => {
    expect(materialGroupSchema.safeParse({ name: "X", density: "0" }).success).toBe(false);
    expect(materialGroupSchema.safeParse({ name: "X", density: "-1" }).success).toBe(false);
    expect(materialGroupSchema.safeParse({ name: "X", density: "785" }).success).toBe(false);
  });
});
