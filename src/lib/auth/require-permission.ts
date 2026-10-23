import "server-only";
import { createClient } from "@/lib/supabase/server";
import { checkPermission, PermissionDeniedError, type PermissionKey } from "./permissions";

/**
 * Server-side guard for every mutation (server actions, route handlers).
 * Throws UnauthenticatedError or PermissionDeniedError.
 */
export async function requirePermission(organizationId: string, permission: PermissionKey) {
  const supabase = await createClient();
  return checkPermission(supabase, organizationId, permission);
}

// For deciding what to render. Never a substitute for requirePermission in mutations.
export async function hasPermission(
  organizationId: string,
  permission: PermissionKey,
): Promise<boolean> {
  try {
    await requirePermission(organizationId, permission);
    return true;
  } catch (error) {
    if (error instanceof PermissionDeniedError) return false;
    throw error;
  }
}
