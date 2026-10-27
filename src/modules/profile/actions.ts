"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { invalidFields } from "@/lib/actions/result";
import { homePathFor } from "@/lib/auth/home";
import { requireMember, type CurrentMember } from "@/lib/auth/session";
import { toAuthEmail } from "@/lib/auth/username";
import { getPublicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import {
  changePasswordSchema,
  initialPasswordSchema,
  PASSWORD_FIELDS,
  preferencesSchema,
  type PasswordError,
  type PasswordField,
  type PasswordResult,
} from "./schemas";

const fail = (error: PasswordError, fields: PasswordField[] = []): PasswordResult => ({
  ok: false,
  error,
  fields,
});

type AuthErrorLike = { code?: string } | null;

function mapAuthError(error: AuthErrorLike): PasswordResult {
  switch (error?.code) {
    case "same_password":
      return fail("same_password", ["newPassword"]);
    case "weak_password":
      return fail("weak_password", ["newPassword"]);
    case "over_request_rate_limit":
      return fail("rate_limited");
    default:
      console.error("password update failed", error);
      return fail("unexpected");
  }
}

/** Sets the signed-in user's password; falls back to the Admin API when Auth asks to reauthenticate. */
async function setOwnPassword(member: CurrentMember, password: string): Promise<AuthErrorLike> {
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error?.code !== "reauthentication_needed") return error;
  // Only reached after the caller verified the current password.
  const { error: adminError } = await createAdminClient().auth.admin.updateUserById(member.userId, {
    password,
  });
  return adminError;
}

async function finishPasswordChange(member: CurrentMember, forced: boolean) {
  if (member.mustChangePassword) {
    const { error } = await createAdminClient()
      .from("profiles")
      .update({ must_change_password: false })
      .eq("organization_id", member.organization.id)
      .eq("id", member.userId);
    if (error) throw error;
  }
  await writeAudit(await createClient(), {
    organizationId: member.organization.id,
    action: "users.password_changed",
    entityType: "profiles",
    entityId: member.userId,
    after: { forced },
  });
}

/**
 * First sign-in with a temporary password: the user chooses their own and
 * continues to their home screen. Only while the temporary-password flag is
 * set; otherwise the current password is required (changeOwnPasswordAction).
 */
export async function changeInitialPasswordAction(input: unknown): Promise<PasswordResult> {
  const member = await requireMember();
  if (!member.mustChangePassword) return fail("denied");

  const parsed = initialPasswordSchema(member.username).safeParse(input);
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, PASSWORD_FIELDS));

  const error = await setOwnPassword(member, parsed.data.newPassword);
  if (error) return mapAuthError(error);

  try {
    await finishPasswordChange(member, true);
  } catch (finishError) {
    console.error("changeInitialPasswordAction failed", finishError);
    return fail("unexpected");
  }
  redirect(homePathFor(member.role.key));
}

/**
 * Profile page. The current password is checked with a separate, throw-away
 * sign-in (its session is ended at once), so the user's own session and the
 * one-session-per-user rule are untouched.
 */
export async function changeOwnPasswordAction(input: unknown): Promise<PasswordResult> {
  const member = await requireMember();
  const parsed = changePasswordSchema(member.username).safeParse(input);
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, PASSWORD_FIELDS));

  const env = getPublicEnv();
  const verifier = createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const verified = await verifier.auth.signInWithPassword({
    email: toAuthEmail(member.username, member.organization.slug),
    password: parsed.data.currentPassword,
  });
  if (verified.error) {
    return verified.error.code === "over_request_rate_limit"
      ? fail("rate_limited")
      : fail("wrong_current", ["currentPassword"]);
  }
  await verifier.auth.signOut({ scope: "local" });

  const error = await setOwnPassword(member, parsed.data.newPassword);
  if (error) return mapAuthError(error);

  try {
    await finishPasswordChange(member, false);
  } catch (finishError) {
    console.error("changeOwnPasswordAction failed", finishError);
    return fail("unexpected");
  }
  return { ok: true };
}

export type PreferencesResult = { ok: true } | { ok: false; error: "invalid" | "unexpected" };

/** Display settings of the signed-in user (RLS: own profile). */
export async function updatePreferencesAction(input: unknown): Promise<PreferencesResult> {
  const member = await requireMember();
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ preferences: { text_size: parsed.data.textSize } })
    .eq("organization_id", member.organization.id)
    .eq("id", member.userId);
  if (error) {
    console.error("updatePreferencesAction failed", error);
    return { ok: false, error: "unexpected" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
