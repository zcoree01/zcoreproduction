"use server";

import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth/home";
import { loadMember } from "@/lib/auth/session";
import { toAuthEmail } from "@/lib/auth/username";
import { createClient } from "@/lib/supabase/server";
import { getTenantSlug } from "@/lib/tenant/server";
import { signInSchema, type SignInResult } from "./schemas";

// `input` comes from the client: always re-validated here.
export async function signInAction(input: unknown): Promise<SignInResult> {
  const tenantSlug = await getTenantSlug();
  if (!tenantSlug) return { error: "no_tenant" };

  const parsed = signInSchema.safeParse(input);
  // Same message for malformed input and wrong credentials: no username enumeration.
  if (!parsed.success) return { error: "invalid_credentials" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: toAuthEmail(parsed.data.username, tenantSlug),
    password: parsed.data.password,
  });
  if (error) {
    return {
      error: error.code === "over_request_rate_limit" ? "rate_limited" : "invalid_credentials",
    };
  }

  const member = await loadMember(supabase, tenantSlug);
  if (!member) {
    // Valid credentials but no active membership (deactivated user or archived org).
    await supabase.auth.signOut();
    return { error: "inactive" };
  }

  redirect(homePathFor(member.role.key));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
