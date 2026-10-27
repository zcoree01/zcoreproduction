import "server-only";
import { writeAudit } from "@/lib/audit";
import type { CurrentMember } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createOrgUser, type CreateOrgUserResult, type NewOrgUser } from "./create-user";
import { generateTempPassword } from "./temp-password";

/**
 * Creates a user with a temporary password in the member's organization.
 * Callers must have checked `users.manage` (the Auth Admin API bypasses RLS).
 */
export async function createUserWithTempPassword(
  member: CurrentMember,
  input: NewOrgUser,
): Promise<CreateOrgUserResult> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const organizationId = member.organization.id;

  return createOrgUser(
    {
      async findRole(roleId) {
        const { data, error } = await supabase
          .from("roles")
          .select("key")
          .eq("id", roleId)
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      async takenUsernames(usernames) {
        const { data, error } = await supabase
          .from("profiles")
          .select("username")
          .eq("organization_id", organizationId)
          .in("username", usernames);
        if (error) throw error;
        return new Set(data.map((row) => row.username));
      },
      generatePassword: generateTempPassword,
      async createAuthUser({ email, password, appMetadata, fullName }) {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: appMetadata,
          user_metadata: { full_name: fullName },
        });
        return error
          ? { ok: false, code: error.code, message: error.message }
          : { ok: true, userId: data.user.id };
      },
      audit: ({ action, entityId, after }) =>
        writeAudit(supabase, {
          organizationId,
          action,
          entityType: "profiles",
          entityId,
          after,
        }),
    },
    member.organization,
    input,
  );
}
