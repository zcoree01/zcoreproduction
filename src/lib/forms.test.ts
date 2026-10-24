import { describe, expect, it } from "vitest";
import { isUnique, optionalText, optionalUuid, requiredText } from "./forms";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("form helpers", () => {
  it("optionalUuid maps empty to null and rejects non-uuids", () => {
    expect(optionalUuid.parse("")).toBeNull();
    expect(optionalUuid.parse(UUID)).toBe(UUID);
    expect(optionalUuid.safeParse("abc").success).toBe(false);
  });

  it("optionalText trims and maps blank to null", () => {
    expect(optionalText(10).parse("  ")).toBeNull();
    expect(optionalText(10).parse(" Haas ")).toBe("Haas");
    expect(optionalText(3).safeParse("abcd").success).toBe(false);
  });

  it("requiredText rejects blank values", () => {
    expect(requiredText(10).safeParse("   ").success).toBe(false);
    expect(requiredText(10).parse(" CNC ")).toBe("CNC");
  });

  it("isUnique detects duplicates", () => {
    expect(isUnique([1, 2, 3])).toBe(true);
    expect(isUnique(["a", "a"])).toBe(false);
  });
});
