import { describe, expect, it } from "vitest";
import { publicEnvSchema } from "./env";

describe("publicEnvSchema", () => {
  it("accepts a valid Supabase URL and key", () => {
    const result = publicEnvSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing key and an invalid URL", () => {
    const result = publicEnvSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]);
  });

  it("does not expose server-only secrets", () => {
    expect(Object.keys(publicEnvSchema.shape)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
