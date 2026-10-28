"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { dbErrorKind } from "@/lib/actions/result";
import { requireMember } from "@/lib/auth/session";
import { toAuthEmail } from "@/lib/auth/username";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requestHost, ROOT_DOMAIN } from "@/lib/tenant/resolve";
import { listPendingSupportRequests, type PendingSupportRequest } from "./queries";
import {
  decideSupportSchema,
  requestSupportSchema,
  SUPPORT_RETURN_COOKIE,
  SUPPORT_USERNAME,
  supportEntryUrl,
} from "./schemas";

type SupportError = "invalid" | "denied" | "not_found" | "open_request" | "unexpected";
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: SupportError };

function fail(
  error: { code?: string; message?: string },
  label: string,
): { ok: false; error: SupportError } {
  const kind = dbErrorKind(error);
  if (kind === "denied") return { ok: false, error: "denied" };
  if (kind === "not_found") return { ok: false, error: "not_found" };
  if (kind === "unique") return { ok: false, error: "open_request" };
  console.error(`${label} failed`, error);
  return { ok: false, error: "unexpected" };
}

/** Platform admin asks an organization for support access (platform.manage in the RPC). */
export async function requestSupportAction(input: unknown): Promise<Result> {
  await requireMember();
  const parsed = requestSupportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_request_support", {
    p_org_id: parsed.data.organizationId,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, "requestSupportAction");
  revalidatePath("/platform");
  return { ok: true };
}

/** The organization approves (with a duration) or rejects (support.approve in the RPC). */
export async function decideSupportAction(input: unknown): Promise<Result> {
  const member = await requireMember();
  const parsed = decideSupportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_support_request", {
    p_org_id: member.organization.id,
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
    p_minutes: parsed.data.minutes ?? undefined,
    p_note: parsed.data.note || undefined,
  });
  if (error) return fail(error, "decideSupportAction");
  revalidatePath("/settings/support");
  return { ok: true };
}

/**
 * Platform admin enters an organization with an approved request: the
 * organization's support account (role admin, profiles.is_support) is
 * created or re-activated with an unknown random password, and a one-time
 * sign-in token is issued for the organization's own address. The token is
 * redeemed by /support/enter. Access ends with endSupportAction or when the
 * approved time is over (RLS and the proxy stop the account at once).
 */
export async function enterSupportAction(requestId: unknown): Promise<Result<{ url: string }>> {
  await requireMember();
  const parsedId = z.uuid().safeParse(requestId);
  if (!parsedId.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: begun, error } = await supabase
    .rpc("platform_begin_support", { p_request_id: parsedId.data })
    .single();
  if (error) return fail(error, "enterSupportAction");

  const admin = createAdminClient();
  const email = toAuthEmail(SUPPORT_USERNAME, begun.slug);
  try {
    const existing = await admin
      .from("profiles")
      .select("id, is_support")
      .eq("organization_id", begun.organization_id)
      .eq("username", SUPPORT_USERNAME)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && !existing.data.is_support) {
      // A real user already holds the support username: never sign in as them.
      throw new Error("support username is taken by a regular user");
    }

    if (existing.data) {
      const reactivated = await admin
        .from("memberships")
        .update({ archived_at: null })
        .eq("organization_id", begun.organization_id)
        .eq("user_id", existing.data.id);
      if (reactivated.error) throw reactivated.error;
    } else {
      const created = await admin.auth.admin.createUser({
        email,
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
        app_metadata: {
          organization_id: begun.organization_id,
          username: SUPPORT_USERNAME,
          role: "admin",
          is_support: true,
        },
        user_metadata: { full_name: "Zcore podrška" },
      });
      if (created.error) throw created.error;
    }

    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;

    const requestHeaders = await headers();
    const host = requestHost(requestHeaders) ?? "localhost:3000";
    const protocol = requestHeaders.get("x-forwarded-proto") === "https" ? "https:" : "http:";
    const url = supportEntryUrl({
      protocol,
      host,
      slug: begun.slug,
      tokenHash: link.data.properties.hashed_token,
      rootDomain: ROOT_DOMAIN,
    });
    // One host (local dev): keep the way back to the platform admin's session.
    if (new URL(url).host === host) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        (await cookies()).set(SUPPORT_RETURN_COOKIE, session.refresh_token, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: protocol === "https:",
          maxAge: 60 * 60 * 9,
        });
      }
    }
    return { ok: true, url };
  } catch (enterError) {
    console.error("enterSupportAction failed", enterError);
    return { ok: false, error: "unexpected" };
  }
}

/**
 * Ends support access (organization, platform admin or the support account
 * itself): the request is closed, the support account is signed out on every
 * device and its membership archived until the next approval.
 */
export async function endSupportAction(requestId: unknown): Promise<Result> {
  await requireMember();
  const parsedId = z.uuid().safeParse(requestId);
  if (!parsedId.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: organizationId, error } = await supabase.rpc("end_support", {
    p_request_id: parsedId.data,
  });
  if (error) return fail(error, "endSupportAction");

  const admin = createAdminClient();
  try {
    const support = await admin
      .from("profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_support", true)
      .maybeSingle();
    if (support.error) throw support.error;
    if (support.data) {
      const archived = await admin
        .from("memberships")
        .update({ archived_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("user_id", support.data.id)
        .is("archived_at", null);
      if (archived.error) throw archived.error;
      const revoked = await admin.rpc("revoke_user_sessions", { p_user_id: support.data.id });
      if (revoked.error) throw revoked.error;
    }
  } catch (cleanupError) {
    // The request is closed, so RLS already denies the account; log the rest.
    console.error("endSupportAction cleanup failed", cleanupError);
  }

  revalidatePath("/settings/support");
  revalidatePath("/platform");
  return { ok: true };
}

/** Polled by the approval prompt of admins / directors (D-028). */
export async function pendingSupportRequestsAction(): Promise<PendingSupportRequest[]> {
  const member = await requireMember();
  try {
    return await listPendingSupportRequests(member.organization.id);
  } catch (error) {
    console.error("pendingSupportRequestsAction failed", error);
    return [];
  }
}
