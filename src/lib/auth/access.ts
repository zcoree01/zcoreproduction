import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { CurrentMember } from "./session";

export type MemberAccess = {
  modules: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
};

/**
 * Enabled modules (a trial counts until its active_until) and the member's permissions, read through RLS. Used only
 * to decide what to show; access itself is enforced by requirePermission/RLS.
 */
export const getMemberAccess = cache(async (member: CurrentMember): Promise<MemberAccess> => {
  const supabase = await createClient();
  const [modules, permissions] = await Promise.all([
    supabase
      .from("org_modules")
      .select("module_key")
      .eq("organization_id", member.organization.id)
      .eq("enabled", true)
      .or(`active_until.is.null,active_until.gt.${new Date().toISOString()}`),
    member.role.archived
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("role_permissions")
          .select("permission_key")
          .eq("organization_id", member.organization.id)
          .eq("role_id", member.role.id),
  ]);
  if (modules.error) throw modules.error;
  if (permissions.error) throw permissions.error;

  return {
    modules: new Set(modules.data.map((row) => row.module_key)),
    permissions: new Set(permissions.data.map((row) => row.permission_key)),
  };
});
