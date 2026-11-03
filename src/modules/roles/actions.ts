"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { roleError, roleSchema, type RoleResult } from "./schemas";

// Custom roles (D-046): roles.manage, checked here and by the database.

async function managerOrg(): Promise<string | null> {
  const member = await requireMember();
  return (await permitAction(member.organization.id, "roles.manage"))
    ? member.organization.id
    : null;
}

function revalidateRoles() {
  revalidatePath("/settings/roles");
  revalidatePath("/admin/users");
}

/** New role (id null) or a changed custom role. */
export async function saveRoleAction(roleId: unknown, input: unknown): Promise<RoleResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return { ok: false, error: "denied" };
  const parsedId = z.uuid().nullable().safeParse(roleId);
  const parsed = roleSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_custom_role", {
    p_org_id: organizationId,
    p_role_id: parsedId.data as string,
    p_name: parsed.data.name,
    p_permissions: parsed.data.permissions,
  });
  if (error) {
    const kind = roleError(error);
    if (kind === "unexpected") console.error("saving role failed", error);
    return { ok: false, error: kind };
  }
  revalidateRoles();
  return { ok: true, id: data };
}

export async function archiveRoleAction(roleId: unknown): Promise<RoleResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return { ok: false, error: "denied" };
  const parsedId = z.uuid().safeParse(roleId);
  if (!parsedId.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_custom_role", {
    p_org_id: organizationId,
    p_role_id: parsedId.data,
  });
  if (error) {
    const kind = roleError(error);
    if (kind === "unexpected") console.error("archiving role failed", error);
    return { ok: false, error: kind };
  }
  revalidateRoles();
  return { ok: true, id: parsedId.data };
}
