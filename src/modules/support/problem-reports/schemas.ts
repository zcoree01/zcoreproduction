import { z } from "zod";

// Problem reports (Zcore organization, part 3): every member of a firm other
// than Zcore reports a problem from the top bar; Zcore answers.

export const PROBLEM_CATEGORIES = ["broken", "slow", "howto", "idea", "billing", "other"] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

export const PROBLEM_STATUSES = ["new", "in_progress", "waiting_user", "resolved"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export const MAX_DESCRIPTION = 4000;
export const MAX_PAGE_PATH = 300;
export const MAX_USER_AGENT = 500;
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const PROBLEM_REPORT_BUCKET = "problem-report-files";

/** Page path without query string and fragment. */
export function pathWithoutQuery(value: string): string {
  return (value.split("?")[0] ?? "").split("#")[0] ?? "";
}

export const problemReportSchema = z
  .object({
    category: z.enum(PROBLEM_CATEGORIES),
    description: z.string().trim().max(MAX_DESCRIPTION),
    pagePath: z
      .string()
      .max(MAX_PAGE_PATH * 2)
      .transform(pathWithoutQuery)
      .pipe(z.string().max(MAX_PAGE_PATH)),
    userAgent: z.string().max(MAX_USER_AGENT),
    idempotencyKey: z.uuid(),
  })
  .refine((value) => value.category !== "other" || value.description.length > 0, {
    path: ["description"],
  });
export type ProblemReportInput = z.infer<typeof problemReportSchema>;

export const replyProblemReportSchema = z.object({
  reportId: z.uuid(),
  body: z.string().trim().min(1).max(MAX_DESCRIPTION),
});

export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const reportFileMetaSchema = z.object({
  reportId: z.uuid(),
  contentType: z.enum(SCREENSHOT_TYPES),
  size: z.number().int().min(1).max(MAX_SCREENSHOT_BYTES),
});

const UUID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Storage path of a screenshot: <organization>/<report>/<file>. */
export function reportFileStoragePath(
  organizationId: string,
  reportId: string,
  fileId: string,
): string {
  return `${organizationId}/${reportId}/${fileId}`;
}

export function isReportFileStoragePath(
  path: string,
  organizationId: string,
  reportId: string,
): boolean {
  const parts = path.split("/");
  return (
    parts.length === 3 &&
    parts[0] === organizationId &&
    parts[1] === reportId &&
    UUID_PATH.test(parts[2] ?? "")
  );
}

export type ProblemReportError =
  "invalid" | "denied" | "not_found" | "upload_failed" | "unexpected";

export const problemCategorySchema = z.enum(PROBLEM_CATEGORIES);
export const problemStatusSchema = z.enum(PROBLEM_STATUSES);
