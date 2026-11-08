import { describe, expect, it } from "vitest";
import {
  assignPackageSchema,
  orgBillingSchema,
  overviewFilter,
  setLockSchema,
  setPaymentSchema,
  unlockUntilSchema,
} from "./schemas";

const org = "6f1c6f3e-6f0a-4b8e-9d55-0c2f9c1d1a11";

describe("billing schemas (D-049)", () => {
  it("accepts a payment for the first day of a month", () => {
    expect(
      setPaymentSchema.safeParse({
        organizationId: org,
        period: "2026-10-01",
        paid: true,
        paidOn: "2026-11-03",
        note: "Faktura 12/2026",
      }).success,
    ).toBe(true);
  });

  it("rejects a period not on day 1 and a note over 200 characters", () => {
    const base = { organizationId: org, paid: true, paidOn: "2026-11-03" };
    expect(setPaymentSchema.safeParse({ ...base, period: "2026-10-15", note: "" }).success).toBe(
      false,
    );
    expect(
      setPaymentSchema.safeParse({ ...base, period: "2026-10-01", note: "x".repeat(201) }).success,
    ).toBe(false);
  });

  it("needs the payment day only when marking paid", () => {
    expect(
      setPaymentSchema.safeParse({
        organizationId: org,
        period: "2026-10-01",
        paid: true,
        paidOn: "",
        note: "",
      }).success,
    ).toBe(false);
    expect(
      setPaymentSchema.safeParse({
        organizationId: org,
        period: "2026-10-01",
        paid: false,
        paidOn: "",
        note: "",
      }).success,
    ).toBe(true);
  });

  it("requires a reason of 1 to 300 characters when locking", () => {
    expect(
      setLockSchema.safeParse({ organizationId: org, locked: true, reason: " " }).success,
    ).toBe(false);
    expect(
      setLockSchema.safeParse({ organizationId: org, locked: true, reason: "x".repeat(301) })
        .success,
    ).toBe(false);
    expect(
      setLockSchema.safeParse({ organizationId: org, locked: true, reason: "Ne plaća" }).success,
    ).toBe(true);
    expect(
      setLockSchema.safeParse({ organizationId: org, locked: false, reason: "" }).success,
    ).toBe(true);
  });

  it("takes an empty package as no package and grace days from the settings", () => {
    expect(assignPackageSchema.parse({ organizationId: org, packageId: "" }).packageId).toBeNull();
    expect(
      orgBillingSchema.parse({ organizationId: org, graceDays: "", autoLock: true }).graceDays,
    ).toBeNull();
    expect(
      orgBillingSchema.safeParse({ organizationId: org, graceDays: "91", autoLock: true }).success,
    ).toBe(false);
    expect(unlockUntilSchema.parse({ organizationId: org, until: "" }).until).toBeNull();
  });

  it("reads the list filter from the address", () => {
    expect(overviewFilter("late")).toBe("late");
    expect(overviewFilter("whatever")).toBe("all");
    expect(overviewFilter(undefined)).toBe("all");
  });
});
