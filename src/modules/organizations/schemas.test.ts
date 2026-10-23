import { describe, expect, it } from "vitest";
import { createOrganizationSchema, orgSettingsSchema, timezoneSchema } from "./schemas";

describe("timezoneSchema", () => {
  it("accepts IANA zones", () => {
    expect(timezoneSchema.safeParse("Europe/Sarajevo").success).toBe(true);
    expect(timezoneSchema.safeParse("UTC").success).toBe(true);
  });

  it("rejects unknown zones", () => {
    expect(timezoneSchema.safeParse("Europe/Atlantis").success).toBe(false);
    expect(timezoneSchema.safeParse("").success).toBe(false);
  });
});

describe("createOrganizationSchema", () => {
  it("defaults the timezone to Europe/Sarajevo", () => {
    expect(createOrganizationSchema.parse({ slug: "demo", name: "Demo" })).toEqual({
      slug: "demo",
      name: "Demo",
      timezone: "Europe/Sarajevo",
    });
  });

  it("rejects an empty name", () => {
    expect(createOrganizationSchema.safeParse({ slug: "demo", name: "  " }).success).toBe(false);
  });
});

describe("orgSettingsSchema", () => {
  it("rejects unknown keys until they are defined", () => {
    expect(orgSettingsSchema.safeParse({}).success).toBe(true);
    expect(orgSettingsSchema.safeParse({ anything: true }).success).toBe(false);
  });
});
