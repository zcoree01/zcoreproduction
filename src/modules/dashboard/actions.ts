"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorKind } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { layoutSchema } from "./widgets";

// Dashboard layouts per role (D-037): dashboard.manage, checked here and by
// save_dashboard_layout / reset_dashboard_layout (audit by trigger).

export type DashboardActionResult =
  { ok: true } | { ok: false; error: "invalid" | "denied" | "not_found" | "unexpected" };

async function managerOrg(): Promise<string | null> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  return (await permitAction(organizationId, "dashboard.manage")) ? organizationId : null;
}

function failure(error: { code?: string; message?: string }): DashboardActionResult {
  switch (dbErrorKind(error)) {
    case "denied":
      return { ok: false, error: "denied" };
    case "not_found":
      return { ok: false, error: "not_found" };
    default:
      return error.message === "invalid_widgets"
        ? { ok: false, error: "invalid" }
        : { ok: false, error: "unexpected" };
  }
}

export async function saveDashboardLayoutAction(
  roleId: unknown,
  widgets: unknown,
): Promise<DashboardActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return { ok: false, error: "denied" };
  const parsedRole = z.uuid().safeParse(roleId);
  const parsed = layoutSchema.safeParse(widgets);
  if (!parsedRole.success || !parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_dashboard_layout", {
    p_org_id: organizationId,
    p_role_id: parsedRole.data,
    p_widgets: parsed.data,
  });
  if (error) return failure(error);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function resetDashboardLayoutAction(roleId: unknown): Promise<DashboardActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return { ok: false, error: "denied" };
  const parsedRole = z.uuid().safeParse(roleId);
  if (!parsedRole.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_dashboard_layout", {
    p_org_id: organizationId,
    p_role_id: parsedRole.data,
  });
  if (error) return failure(error);
  revalidatePath("/dashboard");
  return { ok: true };
}
