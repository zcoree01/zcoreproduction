import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseBillingNotice, type BillingNotice } from "@/modules/platform/billing-notice";
import { lockedPermissions } from "@/modules/platform/lock-rules";
import { effectivePermissions } from "./permission-modules";
import type { CurrentMember } from "./session";

export type MemberAccess = {
  modules: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  /** The organization is locked (D-049): viewing and work in progress only. */
  locked: boolean;
  notice: BillingNotice;
};

/**
 * Enabled modules (a trial counts until its active_until) and the member's permissions, read through RLS. Used only
 * to decide what to show; access itself is enforced by requirePermission/RLS. A permission counts only while its
 * module is enabled; while the organization is locked only reading and finishing work in progress remain (D-049).
 */
export const getMemberAccess = cache(async (member: CurrentMember): Promise<MemberAccess> => {
  const supabase = await createClient();
  const [modules, permissions, billing] = await Promise.all([
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
    supabase.rpc("my_billing_notice", { p_org_id: member.organization.id }),
  ]);
  if (modules.error) throw modules.error;
  if (permissions.error) throw permissions.error;
  if (billing.error) throw billing.error;

  const enabled = new Set(modules.data.map((row) => row.module_key));
  const granted = effectivePermissions(
    permissions.data.map((row) => ({
      permission_key: row.permission_key,
      module_key: row.permission?.module_key ?? null,
    })),
    enabled,
  );
  const notice = parseBillingNotice(billing.data);
  const locked = notice.state === "locked";
  return {
    modules: enabled,
    permissions: locked ? lockedPermissions(granted) : granted,
    locked,
    notice,
  };
});
