"use server";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { toAuthEmail } from "@/lib/auth/username";
import { getServerEnv } from "@/lib/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestHost, ROOT_DOMAIN } from "@/lib/tenant/resolve";
import { toBankAccountsJson, toCompanyFieldsJson } from "@/modules/companies/schemas";
import { registrationSchema, registrationSlugSchema } from "./schemas";

// Public (no session): every call is rate limited per client and the
// database work runs with the service role through register_organization().

const MAX_REGISTRATIONS_PER_HOUR = 5;
const MAX_SLUG_CHECKS_PER_HOUR = 120;

/** Client address, keyed-hashed (never stored in clear). */
async function clientHash(): Promise<string> {
  const requestHeaders = await headers();
  const address =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown";
  return createHmac("sha256", getServerEnv().SUPABASE_SERVICE_ROLE_KEY)
    .update(`registration:${address}`)
    .digest("hex");
}

async function withinLimit(kind: "slug_check" | "register", max: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("registration_attempt", {
    p_client_hash: await clientHash(),
    p_kind: kind,
    p_max: max,
  });
  if (error) {
    console.error("registration rate limit failed", error);
    return false;
  }
  return data === true;
}

export type SlugCheckResult = "available" | "taken" | "invalid" | "rate_limited";

/** Whether a subdomain is free (step "Adresa u sistemu"). */
export async function checkSlugAction(slug: unknown): Promise<SlugCheckResult> {
  const parsed = registrationSlugSchema.safeParse(slug);
  if (!parsed.success) return "invalid";
  if (!(await withinLimit("slug_check", MAX_SLUG_CHECKS_PER_HOUR))) return "rate_limited";
  const { data, error } = await createAdminClient()
    .from("organizations")
    .select("id")
    .eq("slug", parsed.data)
    .maybeSingle();
  if (error) {
    console.error("checkSlugAction failed", error);
    return "invalid";
  }
  return data ? "taken" : "available";
}

export type RegistrationResult =
  | { ok: true; loginUrl: string; claim: boolean; trialDays: number; username: string }
  | {
      ok: false;
      error:
        | "invalid"
        | "slug_taken"
        | "company_owned"
        | "weak_password"
        | "rate_limited"
        | "unexpected";
      fields: string[];
    };

/** Login address of the new organization (its subdomain; ?org on dev hosts). */
function loginUrl(protocol: string, host: string, slug: string): string {
  const hostname = host.split(":")[0] ?? host;
  if (hostname === ROOT_DOMAIN || hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    return `${protocol}//${slug}.${ROOT_DOMAIN}/login`;
  }
  return `${protocol}//${host}/login?org=${encodeURIComponent(slug)}`;
}

export async function registerOrganizationAction(input: unknown): Promise<RegistrationResult> {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    };
  }
  if (!(await withinLimit("register", MAX_REGISTRATIONS_PER_HOUR))) {
    return { ok: false, error: "rate_limited", fields: [] };
  }
  const values = parsed.data;
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("register_organization", {
    p_slug: values.slug,
    p_timezone: values.timezone,
    p_country: values.country,
    p_tax_id: values.taxId,
    p_fields: toCompanyFieldsJson(values),
    p_bank_accounts: toBankAccountsJson(values.bankAccounts),
  });
  if (error) {
    if (error.message.includes("slug_taken") || error.code === "23505") {
      return { ok: false, error: "slug_taken", fields: ["slug"] };
    }
    if (error.message.includes("company_owned")) {
      return { ok: false, error: "company_owned", fields: ["taxId"] };
    }
    console.error("register_organization failed", error);
    return { ok: false, error: "unexpected", fields: [] };
  }
  const registered = data as { organization_id: string; claim: boolean; trial_days: number };

  // First administrator (chosen password, no forced change).
  const created = await admin.auth.admin.createUser({
    email: toAuthEmail(values.adminUsername, values.slug),
    password: values.adminPassword,
    email_confirm: true,
    app_metadata: {
      organization_id: registered.organization_id,
      username: values.adminUsername,
      role: "admin",
    },
    user_metadata: { full_name: values.adminFullName },
  });
  if (created.error) {
    // Nothing usable without an administrator: archive (never delete) the
    // organization, free its subdomain and give its directory entry / claim back.
    const organizationId = registered.organization_id;
    const cleanup = await Promise.all([
      admin
        .from("organizations")
        .update({
          archived_at: new Date().toISOString(),
          company_id: null,
          slug: `${values.slug.slice(0, 50)}-x${Date.now().toString(36)}`,
        })
        .eq("id", organizationId),
      admin
        .from("companies")
        .update({ owner_organization_id: null })
        .eq("owner_organization_id", organizationId),
      admin
        .from("company_change_requests")
        .update({ status: "withdrawn" })
        .eq("requested_by_organization_id", organizationId)
        .eq("status", "pending"),
    ]);
    for (const step of cleanup) {
      if (step.error) console.error("cleaning up the failed registration failed", step.error);
    }
    if (created.error.code === "weak_password") {
      return { ok: false, error: "weak_password", fields: ["adminPassword"] };
    }
    console.error("creating the first administrator failed", created.error);
    return { ok: false, error: "unexpected", fields: [] };
  }

  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") === "https" ? "https:" : "http:";
  return {
    ok: true,
    loginUrl: loginUrl(protocol, requestHost(requestHeaders) ?? "localhost:3000", values.slug),
    claim: registered.claim,
    trialDays: registered.trial_days,
    username: values.adminUsername,
  };
}
