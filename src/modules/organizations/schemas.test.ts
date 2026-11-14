import { describe, expect, it } from "vitest";
import {
  createOrganizationSchema,
  ORG_TIMEZONES,
  organizationTimezoneSchema,
  orgSettingsSchema,
  timezoneLabel,
  timezoneOptions,
  timezoneSchema,
} from "./schemas";

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

describe("organizationTimezoneSchema (D-063)", () => {
  it("accepts a valid zone and nothing else", () => {
    expect(organizationTimezoneSchema.parse({ timezone: "Europe/Zagreb" })).toEqual({
      timezone: "Europe/Zagreb",
    });
    expect(organizationTimezoneSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(organizationTimezoneSchema.safeParse({}).success).toBe(false);
    expect(
      organizationTimezoneSchema.safeParse({ timezone: "Europe/Zagreb", name: "x" }).success,
    ).toBe(false);
  });
});

describe("timezoneOptions", () => {
  it("offers the region's zones with Sarajevo first", () => {
    const options = timezoneOptions("Europe/Sarajevo");
    expect(options).toEqual([...ORG_TIMEZONES]);
    expect(options[0]).toBe("Europe/Sarajevo");
  });

  it("keeps a current zone that is not offered, on top", () => {
    const options = timezoneOptions("America/New_York");
    expect(options[0]).toBe("America/New_York");
    expect(options).toHaveLength(ORG_TIMEZONES.length + 1);
  });
});

describe("timezoneLabel", () => {
  it("shows the city and the offset of that day (summer and winter time)", () => {
    expect(timezoneLabel("Europe/Sarajevo", new Date("2026-01-15T12:00:00Z"))).toBe(
      "Sarajevo (GMT+1)",
    );
    expect(timezoneLabel("Europe/Sarajevo", new Date("2026-07-15T12:00:00Z"))).toBe(
      "Sarajevo (GMT+2)",
    );
    expect(timezoneLabel("Europe/London", new Date("2026-01-15T12:00:00Z"))).toBe("London (GMT)");
    expect(timezoneLabel("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(
      "New York (GMT-5)",
    );
  });
});
