import { describe, expect, it } from "vitest";
import {
  assignPackageSchema,
  billingSettingsSchema,
  modulesLost,
  orgBillingSchema,
  packageSchema,
  overviewFilter,
  setLockSchema,
  setPaymentSchema,
  toggleModule,
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

describe("package and billing settings schemas (D-049)", () => {
  it("rejects a negative price and a name over 80 characters", () => {
    const base = { name: "Osnovni", monthlyPrice: "120", modules: ["production"] };
    expect(packageSchema.safeParse(base).success).toBe(true);
    expect(packageSchema.safeParse({ ...base, monthlyPrice: "-1" }).success).toBe(false);
    expect(packageSchema.safeParse({ ...base, name: "x".repeat(81) }).success).toBe(false);
    expect(packageSchema.safeParse({ ...base, modules: ["platform"] }).success).toBe(false);
    expect(packageSchema.parse({ ...base, monthlyPrice: "99,50" }).monthlyPrice).toBe("99.5");
  });

  it("accepts grace 0 to 90 and warning 0 to 30 days", () => {
    const base = { graceDays: "15", warningDays: "5", contact: "" };
    expect(billingSettingsSchema.safeParse(base).success).toBe(true);
    expect(billingSettingsSchema.safeParse({ ...base, graceDays: "91" }).success).toBe(false);
    expect(billingSettingsSchema.safeParse({ ...base, warningDays: "31" }).success).toBe(false);
    expect(billingSettingsSchema.safeParse({ ...base, contact: "x".repeat(301) }).success).toBe(
      false,
    );
  });
});

describe("toggleModule", () => {
  const deps = [
    { module: "planning", requires: "production" },
    { module: "kiosk", requires: "attendance" },
  ];

  it("checks the module a checked one needs", () => {
    expect(toggleModule(["attendance"], "planning", true, deps).sort()).toEqual(
      ["attendance", "planning", "production"].sort(),
    );
  });

  it("unchecks the modules that need an unchecked one", () => {
    expect(
      toggleModule(["production", "planning", "attendance"], "production", false, deps),
    ).toEqual(["attendance"]);
  });
});

describe("modulesLost", () => {
  const modules = [
    { key: "production", enabled: true, activeUntil: null },
    { key: "planning", enabled: true, activeUntil: null },
    { key: "tools", enabled: true, activeUntil: "2030-01-01T00:00:00Z" },
    { key: "inventory", enabled: false, activeUntil: null },
  ];

  it("lists paid modules the new package does not have (trials stay)", () => {
    expect(modulesLost(modules, ["production"])).toEqual(["planning"]);
  });

  it("lists every paid module when the package is removed", () => {
    expect(modulesLost(modules, null)).toEqual(["production", "planning"]);
  });
});
