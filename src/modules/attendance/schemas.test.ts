import { describe, expect, it } from "vitest";
import { attendanceRulesSchema, clockSchema, shiftSchema } from "./schemas";

const shift = {
  name: " I smjena ",
  code: "I",
  startsAt: "06:00",
  endsAt: "14:00",
  color: "",
  breaks: [{ name: "", startsAt: "", minutes: "30", paid: false }],
};

describe("shiftSchema", () => {
  it("normalises names, empty break times and minutes", () => {
    expect(shiftSchema.parse(shift)).toEqual({
      name: "I smjena",
      code: "I",
      startsAt: "06:00",
      endsAt: "14:00",
      color: "",
      breaks: [{ name: null, startsAt: null, minutes: 30, paid: false }],
    });
  });

  it("accepts a night shift and a 12-hour shift", () => {
    expect(shiftSchema.safeParse({ ...shift, startsAt: "22:00", endsAt: "06:00" }).success).toBe(
      true,
    );
    expect(shiftSchema.safeParse({ ...shift, startsAt: "18:00", endsAt: "06:00" }).success).toBe(
      true,
    );
  });

  it("rejects equal times, bad times and impossible breaks", () => {
    const issue = (input: unknown) =>
      shiftSchema.safeParse(input).error?.issues.map((item) => [item.path[0], item.message]);
    expect(issue({ ...shift, endsAt: "06:00" })).toEqual([["endsAt", "same_times"]]);
    expect(shiftSchema.safeParse({ ...shift, startsAt: "24:00" }).success).toBe(false);
    expect(
      issue({ ...shift, endsAt: "07:00", breaks: [{ ...shift.breaks[0], minutes: "60" }] }),
    ).toEqual([["breaks", "breaks_too_long"]]);
    expect(
      issue({
        ...shift,
        breaks: [{ ...shift.breaks[0], startsAt: "13:45", minutes: "30" }],
      }),
    ).toEqual([["breaks", "break_outside_shift"]]);
    expect(
      shiftSchema.safeParse({ ...shift, breaks: [{ ...shift.breaks[0], minutes: "0" }] }).success,
    ).toBe(false);
  });
});

describe("attendanceRulesSchema", () => {
  it("parses form strings and enforces the database limits", () => {
    expect(
      attendanceRulesSchema.parse({
        earlyWindowMin: "60",
        lateToleranceMin: "10",
        absentAfterMin: "120",
        autoCloseAfterHours: "22",
        operationWithoutClockIn: "auto_clock_in",
      }),
    ).toEqual({
      earlyWindowMin: 60,
      lateToleranceMin: 10,
      absentAfterMin: 120,
      autoCloseAfterHours: 22,
      operationWithoutClockIn: "auto_clock_in",
    });
    expect(
      attendanceRulesSchema.safeParse({
        earlyWindowMin: "60",
        lateToleranceMin: "10",
        absentAfterMin: "120",
        autoCloseAfterHours: "6",
        operationWithoutClockIn: "auto_clock_in",
      }).success,
    ).toBe(false);
  });
});

describe("clockSchema", () => {
  it("needs a direction and an idempotency key", () => {
    expect(
      clockSchema.safeParse({ direction: "in", idempotencyKey: crypto.randomUUID() }).success,
    ).toBe(true);
    expect(clockSchema.safeParse({ direction: "in" }).success).toBe(false);
    expect(
      clockSchema.safeParse({ direction: "sideways", idempotencyKey: crypto.randomUUID() }).success,
    ).toBe(false);
  });
});
