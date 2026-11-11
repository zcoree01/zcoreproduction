import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// vercel.json uses Vercel Schedules instead of the legacy Cron Jobs (D-058).
// Keeping both keys would run every job twice; path schedules default to POST,
// while the cron routes only handle GET.

const config = z
  .object({
    crons: z.unknown().optional(),
    schedules: z.record(
      z.string(),
      z.object({ schedule: z.string(), path: z.string(), requestMethod: z.string() }),
    ),
  })
  .parse(JSON.parse(readFileSync("vercel.json", "utf8")));

describe("vercel.json schedules", () => {
  it("has no legacy crons next to the schedules", () => {
    expect(config.crons).toBeUndefined();
  });

  it("runs the daily purge at 03:00 UTC with GET", () => {
    expect(config.schedules["purge-organizations"]).toEqual({
      schedule: "0 3 * * *",
      path: "/api/cron/purge-organizations",
      requestMethod: "GET",
    });
  });

  it("only targets routes that exist and export GET", () => {
    for (const { path, requestMethod } of Object.values(config.schedules)) {
      expect(requestMethod).toBe("GET");
      const route = readFileSync(`src/app${path}/route.ts`, "utf8");
      expect(route).toMatch(/export async function GET\(/);
    }
  });
});
