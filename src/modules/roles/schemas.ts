import { z } from "zod";
import { permissionKeySchema } from "@/lib/auth/permissions";

// Custom roles (D-046): name and permissions; platform.manage is never offered.

export const roleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  permissions: z
    .array(permissionKeySchema)
    .max(100)
    .refine((keys) => !keys.includes("platform.manage")),
});

export type RoleInput = z.infer<typeof roleSchema>;

export type RoleError =
  "invalid" | "denied" | "not_found" | "name_taken" | "system_role" | "role_in_use" | "unexpected";

export type RoleResult = { ok: true; id: string } | { ok: false; error: RoleError };

export function roleError(error: { code?: string; message?: string }): RoleError {
  if (error.message === "name_taken") return "name_taken";
  if (error.message === "system_role") return "system_role";
  if (error.message === "role_in_use") return "role_in_use";
  if (error.message === "invalid_name" || error.message === "invalid_permission") return "invalid";
  if (error.code === "42501") return "denied";
  if (error.code === "P0002") return "not_found";
  return "unexpected";
}
