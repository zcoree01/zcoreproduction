import { describe, expect, it } from "vitest";
import {
  addDecimals,
  compareDecimals,
  decimalFromDb,
  divideDecimal,
  formatDecimal,
  fromScaled,
  multiplyDecimal,
  parseDecimal,
  toScaled,
} from "./decimal";

describe("parseDecimal", () => {
  it("accepts comma and dot and returns a canonical string", () => {
    expect(parseDecimal("12,50", 3)).toBe("12.5");
    expect(parseDecimal(" 12.500 ", 3)).toBe("12.5");
    expect(parseDecimal("007", 3)).toBe("7");
    expect(parseDecimal("0,0", 3)).toBe("0");
    expect(parseDecimal("-1,25", 2)).toBe("-1.25");
  });

  it("rejects too many decimals and non-numbers", () => {
    expect(parseDecimal("1.2345", 3)).toBeNull();
    expect(parseDecimal("1e3", 3)).toBeNull();
    expect(parseDecimal("1.2.3", 3)).toBeNull();
    expect(parseDecimal("", 3)).toBeNull();
    expect(parseDecimal("12 mm", 3)).toBeNull();
  });
});

describe("scaled conversions", () => {
  it("round-trips", () => {
    expect(toScaled("12.5", 3)).toBe(12500n);
    expect(fromScaled(12500n, 3)).toBe("12.5");
    expect(fromScaled(5n, 3)).toBe("0.005");
    expect(fromScaled(-5n, 3)).toBe("-0.005");
    expect(fromScaled(0n, 0)).toBe("0");
  });
});

describe("arithmetic", () => {
  it("multiplies exactly", () => {
    expect(multiplyDecimal("1.5", "60")).toBe("90");
    expect(multiplyDecimal("0.333", "60")).toBe("19.98");
    expect(multiplyDecimal("0.1", "0.2")).toBe("0.02");
  });

  it("divides with half-up rounding", () => {
    expect(divideDecimal("7", "60", 3)).toBe("0.117");
    expect(divideDecimal("90", "60", 3)).toBe("1.5");
    expect(divideDecimal("1", "3", 2)).toBe("0.33");
    expect(divideDecimal("2", "3", 2)).toBe("0.67");
  });

  it("adds and compares", () => {
    expect(addDecimals(["0.1", "0.2", "0.3"])).toBe("0.6");
    expect(addDecimals([])).toBe("0");
    expect(compareDecimals("1.10", "1.1")).toBe(0);
    expect(compareDecimals("2", "10")).toBe(-1);
    expect(compareDecimals("0.001", "0")).toBe(1);
  });
});

describe("display and database values", () => {
  it("formats with a decimal comma", () => {
    expect(formatDecimal("12.5")).toBe("12,5");
    expect(formatDecimal(null)).toBe("");
  });

  it("reads numeric values returned as JSON numbers", () => {
    expect(decimalFromDb(12.5)).toBe("12.5");
    expect(decimalFromDb("0.0040")).toBe("0.004");
    expect(decimalFromDb(null)).toBeNull();
  });
});
