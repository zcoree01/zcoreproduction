import { describe, expect, it } from "vitest";
import { orgSlugSchema, toAuthEmail, usernameSchema } from "./username";

describe("toAuthEmail", () => {
  it("builds the synthetic e-mail from username and org slug", () => {
    expect(toAuthEmail("sef.proizvodnje", "demo")).toBe("sef.proizvodnje@demo.users.zcore.ba");
  });

  it("normalises case and surrounding whitespace", () => {
    expect(toAuthEmail("  Operater ", "Demo")).toBe("operater@demo.users.zcore.ba");
  });

  it("rejects usernames that could break the e-mail or the DB constraint", () => {
    for (const bad of ["ab", "a@b", "ana marija", "-ana", "ana.", "x".repeat(33)]) {
      expect(() => toAuthEmail(bad, "demo"), bad).toThrow();
    }
  });
});

describe("usernameSchema", () => {
  it("accepts 3–32 chars of a-z, 0-9, dot, dash, underscore", () => {
    for (const ok of ["ana", "operater1", "sef.proizvodnje", "m_kovac", "x".repeat(32)]) {
      expect(usernameSchema.safeParse(ok).success, ok).toBe(true);
    }
  });
});

describe("orgSlugSchema", () => {
  it("accepts subdomain-safe slugs only", () => {
    expect(orgSlugSchema.safeParse("demo").success).toBe(true);
    expect(orgSlugSchema.safeParse("metal-pro-2").success).toBe(true);
    expect(orgSlugSchema.safeParse("-demo").success).toBe(false);
    expect(orgSlugSchema.safeParse("demo_firma").success).toBe(false);
    expect(orgSlugSchema.safeParse("demo.firma").success).toBe(false);
  });
});
