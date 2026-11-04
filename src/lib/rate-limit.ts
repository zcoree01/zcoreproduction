import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { getServerEnv } from "@/lib/env.server";
import { createAdminClient } from "@/lib/supabase/admin";

// Rate limit of public (no session) actions per client address: company
// registration (D-026) and kiosk activation by code (D-048). Attempts are
// counted in registration_attempts with the address keyed-hashed.

export type ClientLimitKind = "slug_check" | "register" | "kiosk_activate";

/** Client address, keyed-hashed (never stored in clear). */
async function clientHash(scope: string): Promise<string> {
  const requestHeaders = await headers();
  const address =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown";
  return createHmac("sha256", getServerEnv().SUPABASE_SERVICE_ROLE_KEY)
    .update(`${scope}:${address}`)
    .digest("hex");
}

/**
 * Records an attempt; false when the client already made `max` attempts of
 * this kind in the last hour (or the check failed: fail closed).
 */
export async function withinClientLimit(
  scope: string,
  kind: ClientLimitKind,
  max: number,
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("registration_attempt", {
    p_client_hash: await clientHash(scope),
    p_kind: kind,
    p_max: max,
  });
  if (error) {
    console.error(`${scope} rate limit failed`, error);
    return false;
  }
  return data === true;
}
