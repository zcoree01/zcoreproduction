"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dbErrorKind } from "@/lib/actions/result";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getMyReportThread, listMyProblemReports } from "./queries";
import {
  isReportFileStoragePath,
  PROBLEM_REPORT_BUCKET,
  problemReportSchema,
  replyProblemReportSchema,
  reportFileMetaSchema,
  reportFileStoragePath,
  type ProblemReportError,
} from "./schemas";
import type { MyProblemReport, ReportThread } from "./types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: ProblemReportError };

// Every member of a firm may report (no permission key); the RPCs check the
// membership, refuse the Zcore organization and support accounts, and write the
// audit row. Storage access is limited by policy to the caller's own report.

function fail(error: { code?: string; message?: string }, label: string) {
  const kind = dbErrorKind(error);
  if (kind === "denied") return { ok: false, error: "denied" } as const;
  if (kind === "not_found") return { ok: false, error: "not_found" } as const;
  if (error.code === "22023") return { ok: false, error: "invalid" } as const;
  console.error(`${label} failed`, error);
  return { ok: false, error: "unexpected" } as const;
}

/** Sends a report; the same idempotency key returns the same report. */
export async function submitProblemReportAction(input: unknown): Promise<Result<{ id: string }>> {
  const member = await requireMember();
  const parsed = problemReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_problem_report", {
    p_org: member.organization.id,
    p_category: parsed.data.category,
    p_description: parsed.data.description,
    p_page_path: parsed.data.pagePath,
    p_user_agent: parsed.data.userAgent,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return fail(error, "submitProblemReportAction");
  return { ok: true, id: data };
}

/** The reporter's own message on a report (returns it to "U obradi" when it was waiting / resolved). */
export async function replyProblemReportAction(input: unknown): Promise<Result> {
  const member = await requireMember();
  const parsed = replyProblemReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_problem_report", {
    p_org: member.organization.id,
    p_report_id: parsed.data.reportId,
    p_body: parsed.data.body,
  });
  if (error) return fail(error, "replyProblemReportAction");
  return { ok: true };
}

/** Validates the screenshot and returns a one-time upload URL for <org>/<report>/<uuid>. */
export async function prepareProblemReportUploadAction(
  input: unknown,
): Promise<Result<{ path: string; token: string }>> {
  const member = await requireMember();
  const parsed = reportFileMetaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const report = await supabase
    .from("problem_reports")
    .select("id")
    .eq("organization_id", member.organization.id)
    .eq("id", parsed.data.reportId)
    .maybeSingle();
  if (report.error) return fail(report.error, "prepareProblemReportUploadAction");
  if (!report.data) return { ok: false, error: "not_found" };

  const path = reportFileStoragePath(member.organization.id, parsed.data.reportId, randomUUID());
  const { data, error } = await supabase.storage
    .from(PROBLEM_REPORT_BUCKET)
    .createSignedUploadUrl(path);
  if (error) {
    console.error("problem report signed upload url failed", error);
    return { ok: false, error: "upload_failed" };
  }
  return { ok: true, path: data.path, token: data.token };
}

/** Records an uploaded screenshot; size and type are read back from Storage. */
export async function registerProblemReportFileAction(
  reportId: unknown,
  path: unknown,
): Promise<Result> {
  const member = await requireMember();
  const parsedId = z.uuid().safeParse(reportId);
  const parsedPath = z.string().max(500).safeParse(path);
  if (!parsedId.success || !parsedPath.success) return { ok: false, error: "invalid" };
  if (!isReportFileStoragePath(parsedPath.data, member.organization.id, parsedId.data)) {
    return { ok: false, error: "invalid" };
  }
  const supabase = await createClient();
  const info = await supabase.storage.from(PROBLEM_REPORT_BUCKET).info(parsedPath.data);
  if (info.error || !info.data.size) return { ok: false, error: "upload_failed" };
  const { error } = await supabase.rpc("register_problem_report_file", {
    p_org: member.organization.id,
    p_report_id: parsedId.data,
    p_path: parsedPath.data,
    p_mime: info.data.contentType ?? "",
    p_size: info.data.size,
  });
  if (error) return fail(error, "registerProblemReportFileAction");
  return { ok: true };
}

/** "Moje prijave". */
export async function listMyProblemReportsAction(): Promise<MyProblemReport[]> {
  const member = await requireMember();
  return listMyProblemReports(member.organization.id);
}

/** One conversation; null when it is not the caller's report. */
export async function getProblemReportThreadAction(
  reportId: unknown,
): Promise<ReportThread | null> {
  const member = await requireMember();
  const parsed = z.uuid().safeParse(reportId);
  if (!parsed.success) return null;
  return getMyReportThread(member.organization.id, parsed.data);
}
