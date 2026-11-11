import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { z } from "zod";
import { CHANGE_PASSWORD_PATH, SUPPORT_EXIT_PATH } from "@/lib/auth/route-guard";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getTenantSlug } from "@/lib/tenant/server";
import { parsePreferences, type ProfilePreferences } from "@/modules/profile/schemas";

export type CurrentMember = {
  userId: string;
  username: string;
  fullName: string | null;
  organization: { id: string; slug: string; name: string; timezone: string };
  role: { id: string; key: string; name: string; archived: boolean };
  /** Temporary password set by an administrator: must be replaced first. */
  mustChangePassword: boolean;
  /** The organization's Zcore support account (only during an approved session). */
  isSupport: boolean;
  preferences: ProfilePreferences;
};

/** What the member's organization and role grant, as read with the membership. */
export type MemberGrants = {
  modules: { module_key: string; enabled: boolean; active_until: string | null }[];
  permissions: { permission_key: string; module_key: string | null }[];
};

export type SessionContext = {
  member: CurrentMember;
  grants: MemberGrants;
  /** Raw my_billing_notice answer; undefined when it was not read with the membership. */
  billing: unknown;
  /**
   * The token's session still exists (one session per user, D-013) and, for a
   * support account, the approved time has not ended (D-028).
   */
  session: { active: boolean; supportEnded: boolean };
};

const organizationIdClaim = z.uuid();

/**
 * Active membership of the signed-in user in the organization `tenantSlug`,
 * with the organization's modules, the role's permissions and the billing
 * notice: everything a page needs to decide what to show, in one round trip
 * (D-054), together with the state of the session (D-057). Null when not
 * signed in, deactivated, or signed in to a different tenant. Reads go through
 * RLS, so this can never return another tenant's data.
 */
export async function loadSessionContext(
  supabase: SupabaseClient<Database>,
  tenantSlug: string,
): Promise<SessionContext | null> {
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  if (!userId) return null;
  // The organization id in the token (app_metadata, written by the server
  // only) just lets the billing notice start early; the membership row decides.
  const claimedOrg = organizationIdClaim.safeParse(auth.claims.app_metadata?.organization_id);

  const [membership, billing, status] = await Promise.all([
    supabase
      .from("memberships")
      .select(
        `user_id,
         organization:organizations!memberships_organization_id_fkey (id, slug, name, timezone,
           modules:org_modules!org_modules_organization_id_fkey (module_key, enabled, active_until)),
         role:roles!memberships_organization_id_role_id_fkey (id, key, name, archived_at,
           grants:role_permissions!role_permissions_organization_id_role_id_fkey (permission_key,
             permission:permissions!role_permissions_permission_key_fkey (module_key))),
         profile:profiles!memberships_organization_id_user_id_fkey (username, full_name, must_change_password, preferences, is_support)`,
      )
      .eq("user_id", userId)
      .is("archived_at", null)
      .maybeSingle(),
    claimedOrg.success
      ? supabase.rpc("my_billing_notice", { p_org_id: claimedOrg.data })
      : Promise.resolve(null),
    supabase.rpc("session_status").maybeSingle(),
  ]);
  const { data, error } = membership;
  if (error) throw error;
  if (!data?.organization || !data.role || !data.profile) return null;
  if (data.organization.slug !== tenantSlug) return null;

  return {
    member: {
      userId: data.user_id,
      username: data.profile.username,
      fullName: data.profile.full_name,
      organization: {
        id: data.organization.id,
        slug: data.organization.slug,
        name: data.organization.name,
        timezone: data.organization.timezone,
      },
      role: {
        id: data.role.id,
        key: data.role.key,
        name: data.role.name,
        archived: data.role.archived_at !== null,
      },
      mustChangePassword: data.profile.must_change_password,
      isSupport: data.profile.is_support,
      preferences: parsePreferences(data.profile.preferences),
    },
    grants: {
      modules: data.organization.modules,
      permissions: data.role.grants.map((grant) => ({
        permission_key: grant.permission_key,
        module_key: grant.permission?.module_key ?? null,
      })),
    },
    billing:
      billing && !billing.error && claimedOrg.data === data.organization.id
        ? billing.data
        : undefined,
    session: sessionState(status),
  };
}

/**
 * Fails open on infrastructure errors: this enforces the single-session and
 * support-time policies, not authentication (the token, the membership and RLS
 * are checked independently).
 */
function sessionState(status: {
  data: { active: boolean; support_ended: boolean } | null;
  error: unknown;
}): SessionContext["session"] {
  if (status.error || !status.data) {
    console.error("session_status failed", status.error);
    return { active: true, supportEnded: false };
  }
  return { active: status.data.active, supportEnded: status.data.support_ended };
}

export async function loadMember(
  supabase: SupabaseClient<Database>,
  tenantSlug: string,
): Promise<CurrentMember | null> {
  return (await loadSessionContext(supabase, tenantSlug))?.member ?? null;
}

// Deduplicated per request.
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  // Session validation compares token expiry with the current time, so it must
  // run at request time, never inside a (runtime) prerender.
  await connection();
  const tenantSlug = await getTenantSlug();
  if (!tenantSlug) return null;
  return loadSessionContext(await createClient(), tenantSlug);
});

/**
 * The signed-in member, or null: not signed in, or the session was replaced by
 * a sign-in on another device, or the approved support time has ended.
 */
export async function getCurrentMember(): Promise<CurrentMember | null> {
  const context = await getSessionContext();
  if (!context || !context.session.active || context.session.supportEnded) return null;
  return context.member;
}

/**
 * The signed-in member; everyone else is redirected (pages, server actions).
 * This is where the session policies are enforced for every request that
 * reads or writes data (D-057): the proxy runs far from the database, so it
 * only verifies the token.
 * - support time ended: to /support/exit (back to the Zcore session);
 * - session replaced on another device: to /login, where the proxy signs this
 *   device out and shows why;
 * - temporary password (D-022): to /change-password, unless the caller is that
 *   screen itself (`temporaryPassword: true`).
 */
export async function requireMember({ temporaryPassword = false } = {}): Promise<CurrentMember> {
  const context = await getSessionContext();
  if (!context) redirect("/login");
  if (context.session.supportEnded) redirect(SUPPORT_EXIT_PATH);
  if (!context.session.active) redirect("/login");
  if (context.member.mustChangePassword && !temporaryPassword) redirect(CHANGE_PASSWORD_PATH);
  return context.member;
}
