import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  problemCategorySchema,
  problemStatusSchema,
  PROBLEM_REPORT_BUCKET,
} from "@/modules/support/problem-reports/schemas";
import { supportStatusSchema } from "@/modules/support/schemas";
import type { ReportsFilter } from "./reports-schemas";

// Zcore side of problem reports. Every RPC checks its platform permission
// itself (platform.read for reading); nothing here widens RLS.

export type PlatformReportRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  category: z.infer<typeof problemCategorySchema>;
  status: z.infer<typeof problemStatusSchema>;
  description: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  authorName: string | null;
  messageCount: number;
};

export async function listPlatformReports(filter: ReportsFilter): Promise<PlatformReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_problem_reports", {
    p_status: filter.status,
    p_category: filter.category,
    p_org: filter.org,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    category: problemCategorySchema.parse(row.category),
    status: problemStatusSchema.parse(row.status),
    description: row.description ?? null,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at ?? null,
    authorName: row.author_name ?? null,
    messageCount: Number(row.message_count),
  }));
}

const detailSchema = z.object({
  report: z.object({
    id: z.string(),
    organization_id: z.string(),
    category: problemCategorySchema,
    status: problemStatusSchema,
    description: z.string().nullable(),
    page_path: z.string().nullable(),
    user_agent: z.string().nullable(),
    created_at: z.string(),
  }),
  organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  author: z.object({
    id: z.string().nullable(),
    username: z.string().nullable(),
    full_name: z.string().nullable(),
  }),
  messages: z.array(
    z.object({
      id: z.string(),
      from_zcore: z.boolean(),
      body: z.string(),
      created_at: z.string(),
      author_name: z.string().nullable(),
    }),
  ),
  files: z.array(
    z.object({
      id: z.string(),
      storage_path: z.string(),
      mime_type: z.string(),
      created_at: z.string(),
    }),
  ),
  access_requests: z.array(
    z.object({
      id: z.string(),
      status: supportStatusSchema,
      scheduled_start: z.string().nullable(),
      duration_minutes: z.number().nullable(),
      approved_until: z.string().nullable(),
      reason: z.string(),
      created_at: z.string(),
      decided_at: z.string().nullable(),
    }),
  ),
});

export type PlatformReportDetail = {
  id: string;
  status: z.infer<typeof problemStatusSchema>;
  category: z.infer<typeof problemCategorySchema>;
  description: string | null;
  pagePath: string | null;
  userAgent: string | null;
  createdAt: string;
  organization: { id: string; name: string; slug: string };
  authorName: string;
  messages: {
    id: string;
    fromZcore: boolean;
    body: string;
    createdAt: string;
    authorName: string;
  }[];
  files: { id: string; mimeType: string; url: string | null }[];
  sessions: {
    id: string;
    status: z.infer<typeof supportStatusSchema>;
    scheduledStart: string | null;
    durationMinutes: number | null;
    reason: string;
  }[];
};

const SIGNED_URL_SECONDS = 600;

/**
 * One report with its conversation. `platform_problem_report` succeeding means
 * the caller has platform.read; only then are short-lived signed URLs for the
 * screenshots created with the service-role client (server only).
 */
export async function getPlatformReport(id: string): Promise<PlatformReportDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_problem_report", { p_id: id });
  if (error) {
    if (error.code === "P0002") return null;
    throw error;
  }
  const detail = detailSchema.parse(data);
  const signed = new Map<string, string>();
  if (detail.files.length > 0) {
    const result = await createAdminClient()
      .storage.from(PROBLEM_REPORT_BUCKET)
      .createSignedUrls(
        detail.files.map((file) => file.storage_path),
        SIGNED_URL_SECONDS,
      );
    if (result.error) {
      console.error("report screenshots signed urls failed", result.error);
    } else {
      for (const item of result.data) {
        if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
      }
    }
  }
  return {
    id: detail.report.id,
    status: detail.report.status,
    category: detail.report.category,
    description: detail.report.description,
    pagePath: detail.report.page_path,
    userAgent: detail.report.user_agent,
    createdAt: detail.report.created_at,
    organization: detail.organization,
    authorName: detail.author.full_name ?? detail.author.username ?? "—",
    messages: detail.messages.map((m) => ({
      id: m.id,
      fromZcore: m.from_zcore,
      body: m.body,
      createdAt: m.created_at,
      authorName: m.author_name ?? "—",
    })),
    files: detail.files.map((file) => ({
      id: file.id,
      mimeType: file.mime_type,
      url: signed.get(file.storage_path) ?? null,
    })),
    sessions: detail.access_requests.map((a) => ({
      id: a.id,
      status: a.status,
      scheduledStart: a.scheduled_start,
      durationMinutes: a.duration_minutes,
      reason: a.reason,
    })),
  };
}

export type PlatformSupportRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  status: z.infer<typeof supportStatusSchema>;
  reason: string;
  requesterName: string;
  durationMinutes: number | null;
  approvedUntil: string | null;
  createdAt: string;
  scheduledStart: string | null;
  problemReportId: string | null;
};

/** Latest support access request of every firm, newest first. */
export async function listPlatformSupportRows(): Promise<{
  rows: PlatformSupportRow[];
  /** Epoch ms of the read, for the remaining time. */
  now: number;
}> {
  const supabase = await createClient();
  const [requests, orgs] = await Promise.all([
    supabase.rpc("platform_support_requests"),
    supabase.rpc("platform_organizations"),
  ]);
  if (requests.error) throw requests.error;
  if (orgs.error) throw orgs.error;
  const names = new Map(orgs.data.map((o) => [o.id, o.name]));
  const rows = requests.data
    .map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      organizationName: names.get(row.organization_id) ?? "—",
      status: supportStatusSchema.parse(row.status),
      reason: row.reason,
      requesterName: row.requester_name,
      durationMinutes: row.duration_minutes,
      approvedUntil: row.approved_until,
      createdAt: row.created_at,
      scheduledStart: row.scheduled_start,
      problemReportId: row.problem_report_id,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { rows, now: Date.now() };
}

/** Organizations for the filter select. */
export async function listReportOrganizations(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_organizations");
  if (error) throw error;
  return data
    .filter((o) => !o.archived)
    .map((o) => ({ id: o.id, name: o.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type ZcoreReportNotice = {
  kind: "new" | "reply";
  /** `report:<report id>` for a new report, `report:<message id>` for a user reply. */
  key: string;
  reportId: string;
  detail: string;
  at: string;
};

const noticeKindSchema = z.enum(["new", "reply"]);

/**
 * Bell candidates for Zcore (D-061): reports still marked new and replies of
 * firm members from the last 14 days, at most 50, each detail cut to 200
 * characters. public.platform_report_notices() checks platform.reports.manage
 * and skips archived firms.
 */
export async function listZcoreReportNotices(): Promise<ZcoreReportNotice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_report_notices");
  if (error) throw error;
  return data.map((row) => ({
    kind: noticeKindSchema.parse(row.kind),
    key: row.notice_key,
    reportId: row.report_id,
    detail: row.detail,
    at: row.at,
  }));
}
