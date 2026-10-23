import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getTenantSlug } from "@/lib/tenant/server";

export type CurrentMember = {
  userId: string;
  username: string;
  fullName: string | null;
  organization: { id: string; slug: string; name: string; timezone: string };
  role: { id: string; key: string; name: string; archived: boolean };
};

/**
 * Active membership of the signed-in user in the organization `tenantSlug`.
 * Null when not signed in, deactivated, or signed in to a different tenant.
 * Reads go through RLS, so this can never return another tenant's data.
 */
export async function loadMember(
  supabase: SupabaseClient<Database>,
  tenantSlug: string,
): Promise<CurrentMember | null> {
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("memberships")
    .select(
      `user_id,
       organization:organizations!memberships_organization_id_fkey (id, slug, name, timezone),
       role:roles!memberships_organization_id_role_id_fkey (id, key, name, archived_at),
       profile:profiles!memberships_organization_id_user_id_fkey (username, full_name)`,
    )
    .eq("user_id", userId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data?.organization || !data.role || !data.profile) return null;
  if (data.organization.slug !== tenantSlug) return null;

  return {
    userId: data.user_id,
    username: data.profile.username,
    fullName: data.profile.full_name,
    organization: data.organization,
    role: {
      id: data.role.id,
      key: data.role.key,
      name: data.role.name,
      archived: data.role.archived_at !== null,
    },
  };
}

// Deduplicated per request.
export const getCurrentMember = cache(async (): Promise<CurrentMember | null> => {
  // Session validation compares token expiry with the current time, so it must
  // run at request time, never inside a (runtime) prerender.
  await connection();
  const tenantSlug = await getTenantSlug();
  if (!tenantSlug) return null;
  return loadMember(await createClient(), tenantSlug);
});

export async function requireMember(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  return member;
}
