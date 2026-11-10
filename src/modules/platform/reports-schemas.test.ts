import { describe, expect, it } from "vitest";
import {
  platformReplySchema,
  reportsFilterSchema,
  scheduleSessionSchema,
  setReportStatusSchema,
} from "./reports-schemas";

const ID = "6f1c1c1e-1b1e-4c1e-8c1e-1c1e1c1e1c1e";
const future = new Date(Date.now() + 3_600_000).toISOString();
const past = new Date(Date.now() - 3_600_000).toISOString();

describe("platformReplySchema", () => {
  it("takes a reply of 1 to 4000 characters and an optional state from the list", () => {
    const parse = (body: string, status: string | null) =>
      platformReplySchema.safeParse({ reportId: ID, body, status }).success;
    expect(parse("Ok", null)).toBe(true);
    expect(parse("   ", null)).toBe(false);
    expect(parse("a".repeat(4001), null)).toBe(false);
    expect(parse("a".repeat(4000), "resolved")).toBe(true);
    expect(parse("a", "done")).toBe(false);
  });
});

describe("setReportStatusSchema", () => {
  it("accepts only known states", () => {
    expect(setReportStatusSchema.safeParse({ reportId: ID, status: "in_progress" }).success).toBe(
      true,
    );
    expect(setReportStatusSchema.safeParse({ reportId: ID, status: "x" }).success).toBe(false);
  });
});

describe("scheduleSessionSchema", () => {
  const base = { reportId: ID, start: future, minutes: 60, reason: "Provjera" };
  it("accepts 15 to 480 minutes", () => {
    for (const minutes of [15, 60, 480]) {
      expect(scheduleSessionSchema.safeParse({ ...base, minutes }).success).toBe(true);
    }
    for (const minutes of [14, 481, 0, 30.5]) {
      expect(scheduleSessionSchema.safeParse({ ...base, minutes }).success).toBe(false);
    }
  });
  it("refuses a start in the past and an empty reason", () => {
    expect(scheduleSessionSchema.safeParse({ ...base, start: past }).success).toBe(false);
    expect(scheduleSessionSchema.safeParse({ ...base, start: "nope" }).success).toBe(false);
    expect(scheduleSessionSchema.safeParse({ ...base, reason: " " }).success).toBe(false);
  });
});

describe("reportsFilterSchema", () => {
  it("ignores unknown values", () => {
    expect(reportsFilterSchema.parse({ status: "new", category: "slow", org: ID })).toEqual({
      status: "new",
      category: "slow",
      org: ID,
    });
    expect(reportsFilterSchema.parse({ status: "bogus", category: "x", org: "y" })).toEqual({});
  });
});
