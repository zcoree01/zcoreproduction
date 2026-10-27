import { describe, expect, it } from "vitest";
import { usernameSchema } from "@/lib/auth/username";
import { moduleState } from "@/modules/platform/schemas";
import {
  decideSupportSchema,
  effectiveSupportStatus,
  SUPPORT_USERNAME,
  supportEntryUrl,
} from "./schemas";

const NOW = new Date("2026-10-27T12:00:00Z");

describe("support access", () => {
  it("uses a valid username for the support account", () => {
    expect(usernameSchema.parse(SUPPORT_USERNAME)).toBe(SUPPORT_USERNAME);
  });

  it("treats approved or active access past its end as ended", () => {
    expect(effectiveSupportStatus("active", "2026-10-27T11:59:00Z", NOW)).toBe("ended");
    expect(effectiveSupportStatus("approved", "2026-10-27T13:00:00Z", NOW)).toBe("approved");
    expect(effectiveSupportStatus("pending", null, NOW)).toBe("pending");
  });

  it("needs a duration to approve, not to reject", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      decideSupportSchema.safeParse({ requestId: id, approve: true, minutes: null, note: "" })
        .success,
    ).toBe(false);
    expect(
      decideSupportSchema.safeParse({ requestId: id, approve: true, minutes: 45, note: "" })
        .success,
    ).toBe(false);
    expect(
      decideSupportSchema.safeParse({ requestId: id, approve: true, minutes: 60, note: "" })
        .success,
    ).toBe(true);
    expect(
      decideSupportSchema.safeParse({ requestId: id, approve: false, minutes: null, note: "" })
        .success,
    ).toBe(true);
  });

  it("signs in on the organization's subdomain in production and with ?org on dev hosts", () => {
    const base = { protocol: "https:", slug: "metal", tokenHash: "abc", rootDomain: "zcore.ba" };
    expect(supportEntryUrl({ ...base, host: "zcore.zcore.ba" })).toBe(
      "https://metal.zcore.ba/support/enter?token_hash=abc",
    );
    expect(supportEntryUrl({ ...base, protocol: "http:", host: "localhost:3000" })).toBe(
      "http://localhost:3000/support/enter?token_hash=abc&org=metal",
    );
  });
});

describe("moduleState", () => {
  it("distinguishes off, on, trial with days left and expired", () => {
    expect(moduleState({ enabled: false, activeUntil: null }, NOW)).toEqual({
      state: "off",
      daysLeft: null,
    });
    expect(moduleState({ enabled: true, activeUntil: null }, NOW)).toEqual({
      state: "on",
      daysLeft: null,
    });
    expect(moduleState({ enabled: true, activeUntil: "2026-11-03T12:00:00Z" }, NOW)).toEqual({
      state: "trial",
      daysLeft: 7,
    });
    expect(moduleState({ enabled: true, activeUntil: "2026-10-27T11:00:00Z" }, NOW).state).toBe(
      "expired",
    );
  });
});
