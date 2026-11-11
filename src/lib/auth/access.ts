import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseBillingNotice, type BillingNotice } from "@/modules/platform/billing-notice";
import { lockedPermissions } from "@/modules/platform/lock-rules";
import { effectivePermissions } from "./permission-modules";
import { getSessionContext, type CurrentMember, type MemberGrants } from "./session";

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
 * For the signed-in member this costs no query: the grants arrive with the membership (getSessionContext, D-054).
 */
export const getMemberAccess = cache(async (member: CurrentMember): Promise<MemberAccess> => {
  const context = await getSessionContext();
  const own = context?.member === member ? context : null;
  const [grants, billing] = await Promise.all([
    own ? own.grants : loadGrants(member),
    own && own.billing !== undefined ? own.billing : loadBillingNotice(member),
  ]);

  const now = Date.now();
  const enabled = new Set(
    grants.modules
      .filter(
        (row) =>
          row.enabled && (row.active_until === null || new Date(row.active_until).getTime() > now),
      )
      .map((row) => row.module_key),
  );
  const granted = effectivePermissions(member.role.archived ? [] : grants.permissions, enabled);
  const notice = parseBillingNotice(billing);
  const locked = notice.state === "locked";
  return {
    modules: enabled,
    permissions: locked ? lockedPermissions(granted) : granted,
    locked,
    notice,
  };
});

async function loadGrants(member: CurrentMember): Promise<MemberGrants> {
  const supabase = await createClient();
  const [modules, permissions] = await Promise.all([
    supabase
      .from("org_modules")
      .select("module_key, enabled, active_until")
      .eq("organization_id", member.organization.id),
    supabase
      .from("role_permissions")
      .select("permission_key, permission:permissions (module_key)")
      .eq("organization_id", member.organization.id)
      .eq("role_id", member.role.id),
  ]);
  if (modules.error) throw modules.error;
  if (permissions.error) throw permissions.error;
  return {
    modules: modules.data,
    permissions: permissions.data.map((row) => ({
      permission_key: row.permission_key,
      module_key: row.permission?.module_key ?? null,
    })),
  };
}

async function loadBillingNotice(member: CurrentMember): Promise<unknown> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_billing_notice", {
    p_org_id: member.organization.id,
  });
  if (error) throw error;
  return data;
}
