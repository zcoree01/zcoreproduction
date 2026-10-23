"use server";

import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth/home";
import { loadMember } from "@/lib/auth/session";
import { toAuthEmail } from "@/lib/auth/username";
import { createClient } from "@/lib/supabase/server";
import { getTenantSlug } from "@/lib/tenant/server";
import { signInSchema, type SignInState } from "./schemas";

export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const tenantSlug = await getTenantSlug();
  if (!tenantSlug) return { error: "no_tenant" };

  const rawUsername = formData.get("username");
  const username = typeof rawUsername === "string" ? rawUsername : "";
  const parsed = signInSchema.safeParse({ username, password: formData.get("password") });
  // Same message for malformed input and wrong credentials: no username enumeration.
  if (!parsed.success) return { error: "invalid_credentials", username };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: toAuthEmail(parsed.data.username, tenantSlug),
    password: parsed.data.password,
  });
  if (error) {
    return {
      error: error.code === "over_request_rate_limit" ? "rate_limited" : "invalid_credentials",
      username,
    };
  }

  const member = await loadMember(supabase, tenantSlug);
  if (!member) {
    // Valid credentials but no active membership (deactivated user or archived org).
    await supabase.auth.signOut();
    return { error: "inactive", username };
  }

  redirect(homePathFor(member.role.key));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
