import "server-only";
import { createClient } from "@/lib/supabase/server";
import { checkPermission, type PermissionKey } from "./permissions";

/**
 * Server-side guard for every mutation (server actions, route handlers).
 * Throws UnauthenticatedError or PermissionDeniedError.
 */
export async function requirePermission(organizationId: string, permission: PermissionKey) {
  const supabase = await createClient();
  return checkPermission(supabase, organizationId, permission);
}
