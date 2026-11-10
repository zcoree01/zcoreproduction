import "server-only";
import { createClient } from "@/lib/supabase/server";
import { problemCategorySchema, problemStatusSchema } from "./schemas";
import type {
  ReportMessage,
  ReportNotice,
  ReportSession,
  ReportThread,
  MyProblemReport,
} from "./types";
import { supportStatusSchema } from "@/modules/support/schemas";

// Reads of the caller's own reports (RLS: created_by = auth.uid()).

/** The caller's reports, newest activity first. */
export async function listMyProblemReports(organizationId: string): Promise<MyProblemReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("problem_reports")
    .select("id, category, status, description, page_path, created_at, last_message_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    category: problemCategorySchema.parse(row.category),
    status: problemStatusSchema.parse(row.status),
    description: row.description,
    pagePath: row.page_path,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
  }));
}

/**
 * Support sessions Zcore proposed from the caller's reports. A failure here
 * only hides the sessions (the conversation still works), so it is logged.
 */
export async function listMyReportSessions(organizationId: string): Promise<ReportSession[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_problem_report_sessions", {
    p_org: organizationId,
  });
  if (error) {
    console.error("my_problem_report_sessions failed", error);
    return [];
  }
  return data.map((row) => ({
    id: row.id,
    reportId: row.problem_report_id,
    status: supportStatusSchema.parse(row.status),
    scheduledStart: row.scheduled_start,
    durationMinutes: row.duration_minutes,
    approvedUntil: row.approved_until,
    reason: row.reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }));
}

/** Messages, screenshots and proposed sessions of one of the caller's reports. */
export async function getMyReportThread(
  organizationId: string,
  reportId: string,
): Promise<ReportThread | null> {
  const supabase = await createClient();
  const report = await supabase
    .from("problem_reports")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", reportId)
    .maybeSingle();
  if (report.error) throw report.error;
  if (!report.data) return null;

  const [messages, files, sessions] = await Promise.all([
    supabase
      .from("problem_report_messages")
      .select("id, from_zcore, body, created_at")
      .eq("organization_id", organizationId)
      .eq("report_id", reportId)
      .order("created_at", { ascending: true }),
    supabase
      .from("problem_report_files")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("report_id", reportId),
    listMyReportSessions(organizationId),
  ]);
  if (messages.error) throw messages.error;
  if (files.error) throw files.error;
  const items: ReportMessage[] = messages.data.map((row) => ({
    id: row.id,
    fromZcore: row.from_zcore,
    body: row.body,
    createdAt: row.created_at,
  }));
  return {
    messages: items,
    fileCount: files.count ?? 0,
    sessions: sessions.filter((session) => session.reportId === reportId),
  };
}

/** Decision a firm made on a proposed session, or null while it is open. */
export function sessionDecision(
  session: Pick<ReportSession, "status" | "approvedUntil" | "decidedAt">,
): "approved" | "rejected" | null {
  if (session.status === "rejected") return "rejected";
  if (session.decidedAt !== null && session.approvedUntil !== null) return "approved";
  return null;
}

/**
 * Candidates for the bell and the dot on "?": Zcore replies (key
 * report:<message id>) and decisions on proposed sessions (key
 * session:<request id>:<decision>). Read / removed state is applied by the caller.
 */
export async function listReportNotices(organizationId: string): Promise<ReportNotice[]> {
  const supabase = await createClient();
  const [messages, sessions] = await Promise.all([
    supabase
      .from("problem_report_messages")
      .select("id, report_id, body, created_at")
      .eq("organization_id", organizationId)
      .eq("from_zcore", true)
      .order("created_at", { ascending: false })
      .limit(50),
    listMyReportSessions(organizationId),
  ]);
  if (messages.error) throw messages.error;
  const notices: ReportNotice[] = messages.data.map((row) => ({
    kind: "message",
    key: `report:${row.id}`,
    reportId: row.report_id,
    detail: row.body,
    at: row.created_at,
  }));
  for (const session of sessions) {
    const decision = sessionDecision(session);
    if (decision === null) continue;
    notices.push({
      kind: decision,
      key: `session:${session.id}:${decision}`,
      reportId: session.reportId,
      detail: session.reason,
      at: session.decidedAt ?? session.createdAt,
    });
  }
  return notices.sort((a, b) => b.at.localeCompare(a.at));
}
