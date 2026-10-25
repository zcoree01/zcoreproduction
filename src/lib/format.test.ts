import { describe, expect, it } from "vitest";
import { formatDay, formatLocalDateTime, initials } from "./format";

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

describe("formatDay / formatLocalDateTime", () => {
  it("formats without locale data", () => {
    expect(formatDay("2026-10-29")).toBe("29.10.2026.");
    expect(formatDay("2027-01-05")).toBe("5.1.2027.");
    expect(formatLocalDateTime("2026-10-29T08:05")).toBe("29.10. 08:05");
  });
});
