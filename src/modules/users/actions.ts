"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CREATE_USER_FIELDS,
  createUserSchema,
  type CreateUserError,
  type CreateUserField,
  type CreateUserResult,
  type ResetPasswordResult,
} from "./schemas";
import { createUserWithTempPassword } from "./server";
import { generateTempPassword } from "./temp-password";
import { splitFullName } from "./username-suggest";

const fail = (error: CreateUserError, fields: CreateUserField[] = []): CreateUserResult => ({
  ok: false,
  error,
  fields,
});

// `input` comes from the client: always re-validated here.
export async function createUserAction(input: unknown): Promise<CreateUserResult> {
  const member = await requireMember();
  if (!(await permitAction(member.organization.id, "users.manage"))) return fail("denied");

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    return fail(
      "invalid",
      CREATE_USER_FIELDS.filter((field) => fields.has(field)),
    );
  }

  try {
    const result = await createUserWithTempPassword(member, {
      ...parsed.data,
      ...splitFullName(parsed.data.fullName),
    });
    if (!result.ok) {
      return fail(result.error, result.error === "username_taken" ? ["username"] : ["roleId"]);
    }
    revalidatePath("/admin/users");
    return { ok: true, username: result.username, password: result.password };
  } catch (error) {
    console.error("createUserAction failed", error);
    return { ok: false, error: "unexpected", fields: [] };
  }
}

/**
 * Administrator reset: new temporary password, must be changed at the next
 * sign-in, every device signed out. Only `users.manage`; never for oneself
 * (use the profile page). The password is shown once and never logged.
 */
export async function resetUserPasswordAction(userId: unknown): Promise<ResetPasswordResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "users.manage"))) return { ok: false, error: "denied" };

  const parsed = z.uuid().safeParse(userId);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (parsed.data === member.userId) return { ok: false, error: "self" };

  // RLS: only users of the acting member's organization are visible.
  const supabase = await createClient();
  const { data: target, error: lookupError } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("organization_id", organizationId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (lookupError) {
    console.error("resetUserPasswordAction lookup failed", lookupError);
    return { ok: false, error: "unexpected" };
  }
  if (!target) return { ok: false, error: "not_found" };

  const admin = createAdminClient();
  const password = generateTempPassword();
  try {
    // Flag first: if the password update fails, the user only has to choose
    // a new password once more.
    const flagged = await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("organization_id", organizationId)
      .eq("id", target.id);
    if (flagged.error) throw flagged.error;

    const updated = await admin.auth.admin.updateUserById(target.id, { password });
    if (updated.error) throw updated.error;

    const revoked = await admin.rpc("revoke_user_sessions", { p_user_id: target.id });
    if (revoked.error) throw revoked.error;

    await writeAudit(supabase, {
      organizationId,
      action: "users.password_reset",
      entityType: "profiles",
      entityId: target.id,
      after: { username: target.username, must_change_password: true },
    });
  } catch (error) {
    console.error("resetUserPasswordAction failed", error);
    return { ok: false, error: "unexpected" };
  }

  revalidatePath("/admin/users");
  return { ok: true, username: target.username, password };
}
