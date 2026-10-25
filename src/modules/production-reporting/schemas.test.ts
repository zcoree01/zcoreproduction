import { describe, expect, it } from "vitest";
import { closeDecisionSchema, cutSchema, pauseSchema, reportSchema } from "./schemas";

const KEY = "5f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const REASON = "0b8f6a1e-2c3d-4e5f-9a0b-1c2d3e4f5a6b";

describe("reportSchema", () => {
  it("normalises decimal commas and empty fields to 0", () => {
    const parsed = reportSchema.parse({
      good: "12,5",
      scrap: "",
      scrapReasonId: "",
      notes: "  ",
      idempotencyKey: KEY,
      finish: false,
    });
    expect(parsed).toEqual({
      good: "12.5",
      scrap: "0",
      scrapReasonId: null,
      notes: null,
      idempotencyKey: KEY,
      finish: false,
    });
  });

  it("rejects negative quantities, too many decimals and a missing key", () => {
    const valid = { good: "1", scrap: "0", scrapReasonId: "", notes: "", finish: false };
    expect(reportSchema.safeParse({ ...valid, good: "-1", idempotencyKey: KEY }).success).toBe(
      false,
    );
    expect(reportSchema.safeParse({ ...valid, good: "1.2345", idempotencyKey: KEY }).success).toBe(
      false,
    );
    expect(reportSchema.safeParse({ ...valid, idempotencyKey: "x" }).success).toBe(false);
  });
});

describe("pauseSchema", () => {
  it("requires a reason", () => {
    expect(pauseSchema.safeParse({ reasonId: "", notes: "" }).success).toBe(false);
    expect(pauseSchema.parse({ reasonId: REASON, notes: "" })).toEqual({
      reasonId: REASON,
      notes: null,
    });
  });
});

describe("cutSchema", () => {
  it("needs a positive quantity", () => {
    expect(cutSchema.safeParse({ quantity: "0", idempotencyKey: KEY }).success).toBe(false);
    expect(cutSchema.safeParse({ quantity: "", idempotencyKey: KEY }).success).toBe(false);
    expect(cutSchema.parse({ quantity: "118", idempotencyKey: KEY }).quantity).toBe("118");
  });
});

describe("closeDecisionSchema", () => {
  it("needs a note only for rejecting", () => {
    expect(closeDecisionSchema.safeParse({ approve: true, note: "" }).success).toBe(true);
    expect(closeDecisionSchema.safeParse({ approve: false, note: "" }).success).toBe(false);
    expect(closeDecisionSchema.safeParse({ approve: false, note: "Dorada" }).success).toBe(true);
  });
});
