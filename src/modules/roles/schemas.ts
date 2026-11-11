import { z } from "zod";
import { isPermissionKey, permissionKeySchema, type PermissionKey } from "@/lib/auth/permissions";

// Custom roles (D-046): name and permissions; platform.organizations.delete is
// never offered (only the system Administrator deletes firms, D-050).

const NEVER_CUSTOM: readonly string[] = ["platform.organizations.delete"];
const PLATFORM_ORG_EXTRA: readonly string[] = [
  "users.read",
  "users.manage",
  "roles.manage",
  "audit.read",
];

/**
 * Permissions a custom role may get (mirrors public.save_custom_role): the
 * Zcore organization only platform permissions plus user, role and audit
 * management; every other organization nothing from the platform module.
 */
export function customRolePermissionKeys(
  isPlatformOrg: boolean,
  all: readonly { key: string; module: string }[],
): PermissionKey[] {
  return all.flatMap((row) => {
    if (!isPermissionKey(row.key) || NEVER_CUSTOM.includes(row.key)) return [];
    const platform = row.module === "platform";
    const allowed = isPlatformOrg ? platform || PLATFORM_ORG_EXTRA.includes(row.key) : !platform;
    return allowed ? [row.key] : [];
  });
}

export const roleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  permissions: z
    .array(permissionKeySchema)
    .max(100)
    .refine((keys) => !keys.some((key) => NEVER_CUSTOM.includes(key))),
});

export type RoleInput = z.infer<typeof roleSchema>;

export type RoleError =
  | "invalid"
  | "denied"
  | "not_found"
  | "name_taken"
  | "system_role"
  | "role_in_use"
  | "role_above_caller"
  | "unexpected";

export type RoleResult = { ok: true; id: string } | { ok: false; error: RoleError };

export function roleError(error: { code?: string; message?: string }): RoleError {
  if (error.message === "name_taken") return "name_taken";
  if (error.message === "system_role") return "system_role";
  if (error.message === "role_in_use") return "role_in_use";
  if (error.message === "role_above_caller") return "role_above_caller";
  if (error.message === "invalid_name" || error.message === "invalid_permission") return "invalid";
  if (error.code === "42501") return "denied";
  if (error.code === "P0002") return "not_found";
  return "unexpected";
}
