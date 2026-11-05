import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { effectivePermissions } from "./permission-modules";
import type { CurrentMember } from "./session";

export type MemberAccess = {
  modules: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
};

/**
 * Enabled modules (a trial counts until its active_until) and the member's permissions, read through RLS. Used only
 * to decide what to show; access itself is enforced by requirePermission/RLS. A permission counts only while its
 * module is enabled (D-049).
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
          .select("permission_key, permission:permissions (module_key)")
          .eq("organization_id", member.organization.id)
          .eq("role_id", member.role.id),
  ]);
  if (modules.error) throw modules.error;
  if (permissions.error) throw permissions.error;

  const enabled = new Set(modules.data.map((row) => row.module_key));
  return {
    modules: enabled,
    permissions: effectivePermissions(
      permissions.data.map((row) => ({
        permission_key: row.permission_key,
        module_key: row.permission?.module_key ?? null,
      })),
      enabled,
    ),
  };
});
