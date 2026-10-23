import { describe, expect, it } from "vitest";
import { initials } from "./format";

describe("initials", () => {
  it("uses first and last name", () => {
    expect(initials("Amir Admin")).toBe("AA");
    expect(initials("  Senad  Ahmed   Šef ")).toBe("SŠ");
  });

  it("uses two letters of a single word", () => {
    expect(initials("operater")).toBe("OP");
    expect(initials("đ")).toBe("Đ");
  });

  it("handles empty input", () => {
    expect(initials("   ")).toBe("");
  });
});
