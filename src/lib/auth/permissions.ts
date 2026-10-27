import { z } from "zod";

// Must match public.permissions (verified by tests/db/tenant-isolation.test.ts).
export const PERMISSION_KEYS = [
  "org.settings.manage",
  "users.read",
  "users.manage",
  "roles.manage",
  "audit.read",
  "machines.read",
  "machines.manage",
  "machines.status.update",
  "employees.read",
  "employees.manage",
  "products.read",
  "products.manage",
  "customers.read",
  "customers.manage",
  "orders.read",
  "orders.manage",
  "orders.material.update",
  "orders.close.approve",
  "quality.inspect",
  "attendance.read",
  "attendance.manage",
  "shifts.manage",
  "absences.read",
  "absences.manage",
  "absences.sensitive.read",
  "attendance.approve.managers",
  "platform.manage",
  "support.approve",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const permissionKeySchema = z.enum(PERMISSION_KEYS);

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(
    readonly organizationId: string,
    readonly permission: PermissionKey,
  ) {
    super(`Missing permission ${permission} in organization ${organizationId}`);
    this.name = "PermissionDeniedError";
  }
}

// The subset of the Supabase client that permission checks need.
export interface PermissionClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  rpc(
    fn: "has_permission",
    args: { p_org_id: string; p_permission: string },
  ): PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
}

/**
 * Verifies the caller is signed in and holds `permission` in `organizationId`.
 * The decision is made by the database (private.has_permission), the same
 * function RLS policies use, so server checks and RLS cannot drift apart.
 */
export async function checkPermission(
  client: PermissionClient,
  organizationId: string,
  permission: PermissionKey,
): Promise<{ userId: string }> {
  const orgId = z.uuid().parse(organizationId);
  const key = permissionKeySchema.parse(permission);

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new UnauthenticatedError();

  const { data, error } = await client.rpc("has_permission", {
    p_org_id: orgId,
    p_permission: key,
  });
  if (error) throw new Error(`Permission check failed: ${error.message}`);
  if (data !== true) throw new PermissionDeniedError(orgId, key);

  return { userId: user.id };
}
