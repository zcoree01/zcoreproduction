import "server-only";
import { createClient } from "@/lib/supabase/server";
import { effectiveSupportStatus, supportStatusSchema, type SupportStatus } from "./schemas";

export type SupportRequest = {
  id: string;
  organizationId: string;
  status: SupportStatus;
  reason: string;
  requesterName: string;
  durationMinutes: number | null;
  approvedUntil: string | null;
  decisionNote: string | null;
  createdAt: string;
};

/** Requests to the organization (RLS: support.approve). */
export async function listSupportRequests(organizationId: string): Promise<SupportRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_access_requests")
    .select(
      "id, organization_id, status, reason, requester_name, duration_minutes, approved_until, decision_note, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    status: effectiveSupportStatus(supportStatusSchema.parse(row.status), row.approved_until),
    reason: row.reason,
    requesterName: row.requester_name,
    durationMinutes: row.duration_minutes,
    approvedUntil: row.approved_until,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
  }));
}

/** Latest request per organization, for the platform admin. */
export async function listPlatformSupportRequests(): Promise<Map<string, SupportRequest>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_support_requests");
  if (error) throw error;
  return new Map(
    data.map((row) => [
      row.organization_id,
      {
        id: row.id,
        organizationId: row.organization_id,
        status: supportStatusSchema.parse(row.status),
        reason: row.reason,
        requesterName: row.requester_name,
        durationMinutes: row.duration_minutes,
        approvedUntil: row.approved_until,
        decisionNote: row.decision_note,
        createdAt: row.created_at,
      },
    ]),
  );
}

/** Running support session of the organization (banner for the support account). */
export async function getCurrentSupportSession(
  organizationId: string,
): Promise<{ id: string; approvedUntil: string; requesterName: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("current_support_session", { p_org_id: organizationId })
    .maybeSingle();
  if (error) throw error;
  return data
    ? { id: data.id, approvedUntil: data.approved_until, requesterName: data.requester_name }
    : null;
}

export type PendingSupportRequest = {
  id: string;
  requesterName: string;
  reason: string;
  createdAt: string;
};

/** Open requests the organization's approvers must answer (support.approve in the RPC). */
export async function listPendingSupportRequests(
  organizationId: string,
): Promise<PendingSupportRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_support_requests", {
    p_org_id: organizationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    requesterName: row.requester_name,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
