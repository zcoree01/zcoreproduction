import { describe, expect, it } from "vitest";
import { parseBillingNotice } from "./billing-notice";

describe("parseBillingNotice", () => {
  it("reads the database answer", () => {
    expect(
      parseBillingNotice({
        state: "warning",
        unpaid_period: "2026-10-01",
        lock_on: "2026-11-16",
        reason: null,
        contact: "Zcore, 061 000 000",
      }),
    ).toEqual({
      state: "warning",
      unpaidPeriod: "2026-10-01",
      lockOn: "2026-11-16",
      reason: null,
      contact: "Zcore, 061 000 000",
    });
  });

  it("shows nothing for an unexpected answer (the database still enforces the lock)", () => {
    expect(parseBillingNotice({ state: "nope" })).toEqual({
      state: "active",
      unpaidPeriod: null,
      lockOn: null,
      reason: null,
      contact: "",
    });
  });
});
