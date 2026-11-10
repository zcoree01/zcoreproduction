import { describe, expect, it } from "vitest";
import {
  isReportFileStoragePath,
  PROBLEM_CATEGORIES,
  problemReportSchema,
  replyProblemReportSchema,
  reportFileMetaSchema,
  reportFileStoragePath,
} from "./schemas";

const KEY = "11111111-1111-4111-8111-111111111111";
const base = {
  category: "broken",
  description: "",
  pagePath: "/orders",
  userAgent: "UA",
  idempotencyKey: KEY,
};

describe("problem report", () => {
  it("knows the six categories", () => {
    expect([...PROBLEM_CATEGORIES]).toEqual([
      "broken",
      "slow",
      "howto",
      "idea",
      "billing",
      "other",
    ]);
  });

  it("accepts an empty description for every category except other", () => {
    for (const category of PROBLEM_CATEGORIES.filter((value) => value !== "other")) {
      expect(problemReportSchema.safeParse({ ...base, category }).success).toBe(true);
    }
    expect(problemReportSchema.safeParse({ ...base, category: "other" }).success).toBe(false);
    expect(
      problemReportSchema.safeParse({ ...base, category: "other", description: "   " }).success,
    ).toBe(false);
    expect(
      problemReportSchema.safeParse({ ...base, category: "other", description: "Nešto drugo" })
        .success,
    ).toBe(true);
  });

  it("rejects an unknown category and a missing or malformed key", () => {
    expect(problemReportSchema.safeParse({ ...base, category: "bug" }).success).toBe(false);
    expect(problemReportSchema.safeParse({ ...base, idempotencyKey: "abc" }).success).toBe(false);
  });

  it("limits the lengths: description 4000, page 300, device 500", () => {
    expect(problemReportSchema.safeParse({ ...base, description: "a".repeat(4000) }).success).toBe(
      true,
    );
    expect(problemReportSchema.safeParse({ ...base, description: "a".repeat(4001) }).success).toBe(
      false,
    );
    expect(
      problemReportSchema.safeParse({ ...base, pagePath: "/" + "a".repeat(300) }).success,
    ).toBe(false);
    expect(problemReportSchema.safeParse({ ...base, userAgent: "a".repeat(501) }).success).toBe(
      false,
    );
  });

  it("drops the query string from the page", () => {
    const parsed = problemReportSchema.parse({ ...base, pagePath: "/orders?tab=1#x" });
    expect(parsed.pagePath).toBe("/orders");
  });

  it("validates a reply (1..4000 after trimming)", () => {
    const reportId = "22222222-2222-4222-8222-222222222222";
    expect(replyProblemReportSchema.safeParse({ reportId, body: "  " }).success).toBe(false);
    expect(replyProblemReportSchema.safeParse({ reportId, body: "Hvala" }).success).toBe(true);
    expect(replyProblemReportSchema.safeParse({ reportId, body: "a".repeat(4001) }).success).toBe(
      false,
    );
  });
});

describe("screenshot", () => {
  const reportId = "22222222-2222-4222-8222-222222222222";

  it("accepts PNG, JPEG and WEBP up to 10 MB", () => {
    for (const contentType of ["image/png", "image/jpeg", "image/webp"]) {
      expect(reportFileMetaSchema.safeParse({ reportId, contentType, size: 1000 }).success).toBe(
        true,
      );
    }
    expect(
      reportFileMetaSchema.safeParse({ reportId, contentType: "image/gif", size: 1000 }).success,
    ).toBe(false);
    expect(
      reportFileMetaSchema.safeParse({
        reportId,
        contentType: "image/png",
        size: 10 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
    expect(
      reportFileMetaSchema.safeParse({ reportId, contentType: "image/png", size: 0 }).success,
    ).toBe(false);
  });

  it("builds and checks <organization>/<report>/<file>", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const file = "44444444-4444-4444-8444-444444444444";
    const path = reportFileStoragePath(org, reportId, file);
    expect(path).toBe(`${org}/${reportId}/${file}`);
    expect(isReportFileStoragePath(path, org, reportId)).toBe(true);
    expect(isReportFileStoragePath(path, org, KEY)).toBe(false);
    expect(isReportFileStoragePath(`${org}/${reportId}/../x`, org, reportId)).toBe(false);
  });
});
