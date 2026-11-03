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
  type MemberError,
  type MemberResult,
  type ResetPasswordResult,
  updateMemberSchema,
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
    .select("id, username, is_support")
    .eq("organization_id", organizationId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (lookupError) {
    console.error("resetUserPasswordAction lookup failed", lookupError);
    return { ok: false, error: "unexpected" };
  }
  // The Zcore support account has no password anyone may know (D-026).
  if (!target || target.is_support) return { ok: false, error: "not_found" };

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

function memberError(error: { code?: string; message?: string }): MemberError {
  if (error.message === "self") return "self";
  if (error.message === "last_manager") return "last_manager";
  if (error.message === "role_not_found") return "role_not_found";
  if (error.code === "42501") return "denied";
  if (error.code === "P0002") return "not_found";
  if (error.code === "22023") return "invalid";
  console.error("member update failed", error);
  return "unexpected";
}

/** Full name and role of another member (D-044); update_member checks the rules. */
export async function updateMemberAction(userId: unknown, input: unknown): Promise<MemberResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "users.manage"))) return { ok: false, error: "denied" };
  const parsedId = z.uuid().safeParse(userId);
  const parsed = updateMemberSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return { ok: false, error: "invalid" };
  if (parsedId.data === member.userId) return { ok: false, error: "self" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_member", {
    p_org_id: organizationId,
    p_user_id: parsedId.data,
    p_full_name: parsed.data.fullName,
    p_role_id: parsed.data.roleId,
  });
  if (error) return { ok: false, error: memberError(error) };
  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Deactivate (no sign-in, every device signed out) or reactivate another
 * member (D-044). History, reports and the linked employee stay.
 */
export async function setMemberActiveAction(
  userId: unknown,
  active: unknown,
): Promise<MemberResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "users.manage"))) return { ok: false, error: "denied" };
  const parsedId = z.uuid().safeParse(userId);
  const parsedActive = z.boolean().safeParse(active);
  if (!parsedId.success || !parsedActive.success) return { ok: false, error: "invalid" };
  if (parsedId.data === member.userId) return { ok: false, error: "self" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_active", {
    p_org_id: organizationId,
    p_user_id: parsedId.data,
    p_active: parsedActive.data,
  });
  if (error) return { ok: false, error: memberError(error) };
  if (!parsedActive.data) {
    // Membership checked above (RPC): sign the user out on every device.
    const revoked = await createAdminClient().rpc("revoke_user_sessions", {
      p_user_id: parsedId.data,
    });
    if (revoked.error) console.error("revoking sessions after deactivation failed", revoked.error);
  }
  revalidatePath("/admin/users");
  return { ok: true };
}
