"use server";

import { revalidatePath } from "next/cache";
import { dbErrorKind } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PLATFORM_SLUG } from "@/modules/support/schemas";
import { listZcoreReportNotices, type ZcoreReportNotice } from "./reports-queries";
import {
  platformReplySchema,
  scheduleSessionSchema,
  setReportStatusSchema,
  type ReportsError,
} from "./reports-schemas";

type Result = { ok: true } | { ok: false; error: ReportsError };

function fail(error: { code?: string; message?: string }, label: string): Result {
  const kind = dbErrorKind(error);
  if (kind === "denied") return { ok: false, error: "denied" };
  if (kind === "not_found") return { ok: false, error: "not_found" };
  if (error.code === "22023") {
    return {
      ok: false,
      error: (error.message ?? "").includes("support_open") ? "support_open" : "invalid",
    };
  }
  console.error(`${label} failed`, error);
  return { ok: false, error: "unexpected" };
}

function refresh(reportId: string) {
  revalidatePath("/platform/reports");
  revalidatePath(`/platform/reports/${reportId}`);
}

/** Zcore answers a report, optionally changing its state (platform.reports.manage here and in the RPC). */
export async function replyPlatformReportAction(input: unknown): Promise<Result> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "platform.reports.manage"))) {
    return { ok: false, error: "denied" };
  }
  const parsed = platformReplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_reply_problem_report", {
    p_id: parsed.data.reportId,
    p_body: parsed.data.body,
    p_status: parsed.data.status ?? undefined,
  });
  if (error) return fail(error, "replyPlatformReportAction");
  refresh(parsed.data.reportId);
  return { ok: true };
}

export async function setReportStatusAction(input: unknown): Promise<Result> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "platform.reports.manage"))) {
    return { ok: false, error: "denied" };
  }
  const parsed = setReportStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_problem_status", {
    p_id: parsed.data.reportId,
    p_status: parsed.data.status,
  });
  if (error) return fail(error, "setReportStatusAction");
  refresh(parsed.data.reportId);
  return { ok: true };
}

/** Proposes a support session for the report's firm (platform.reports.manage and platform.support). */
export async function scheduleSupportSessionAction(input: unknown): Promise<Result> {
  const member = await requireMember();
  const [manage, support] = await Promise.all([
    permitAction(member.organization.id, "platform.reports.manage"),
    permitAction(member.organization.id, "platform.support"),
  ]);
  if (!manage || !support) return { ok: false, error: "denied" };
  const parsed = scheduleSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_schedule_support_session", {
    p_report_id: parsed.data.reportId,
    p_start: parsed.data.start,
    p_minutes: parsed.data.minutes,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, "scheduleSupportSessionAction");
  refresh(parsed.data.reportId);
  revalidatePath("/platform");
  return { ok: true };
}

/** Polled by the bell in the Zcore organization (platform.reports.manage). */
export async function zcoreReportNoticesAction(): Promise<ZcoreReportNotice[]> {
  const member = await requireMember();
  // The read below uses the service role: only ever for the Zcore organization.
  if (member.organization.slug !== PLATFORM_SLUG) return [];
  if (!(await permitAction(member.organization.id, "platform.reports.manage"))) return [];
  return listZcoreReportNotices();
}
