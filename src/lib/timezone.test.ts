import { describe, expect, it } from "vitest";
import { utcToZonedLocal, zonedDate, zonedLocalToUtc } from "./timezone";

describe("time zone conversions (Europe/Sarajevo)", () => {
  const tz = "Europe/Sarajevo";

  it("converts summer and winter wall-clock times to UTC", () => {
    expect(zonedLocalToUtc("2026-07-01T08:00", tz)).toBe("2026-07-01T06:00:00.000Z");
    expect(zonedLocalToUtc("2026-12-01T08:00", tz)).toBe("2026-12-01T07:00:00.000Z");
  });

  it("round-trips through the zone", () => {
    expect(utcToZonedLocal("2026-07-01T06:00:00.000Z", tz)).toBe("2026-07-01T08:00");
    expect(utcToZonedLocal(zonedLocalToUtc("2026-10-25T14:30", tz), tz)).toBe("2026-10-25T14:30");
  });

  it("gives the calendar date in the zone", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Sarajevo.
    expect(zonedDate(new Date("2026-12-31T23:30:00Z"), tz)).toBe("2027-01-01");
    expect(zonedDate(new Date("2026-12-31T22:30:00Z"), "UTC")).toBe("2026-12-31");
  });
});
