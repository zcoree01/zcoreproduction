import "server-only";
import { isPermissionKey, type PermissionKey } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { customRolePermissionKeys } from "./schemas";

// Roles of the organization with their permissions and active members
// (D-046), read through RLS.

export type RoleWithPermissions = {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: PermissionKey[];
  members: number;
};

export type PermissionInfo = { key: PermissionKey; module: string };

export async function listRolesWithPermissions(
  organizationId: string,
): Promise<RoleWithPermissions[]> {
  const supabase = await createClient();
  const [roles, links, members] = await Promise.all([
    supabase
      .from("roles")
      .select("id, key, name, is_system")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("is_system", { ascending: false })
      .order("name"),
    supabase
      .from("role_permissions")
      .select("role_id, permission_key")
      .eq("organization_id", organizationId),
    supabase
      .from("memberships")
      .select("role_id")
      .eq("organization_id", organizationId)
      .is("archived_at", null),
  ]);
  if (roles.error) throw roles.error;
  if (links.error) throw links.error;
  if (members.error) throw members.error;
  return roles.data.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    isSystem: role.is_system,
    permissions: links.data
      .filter((link) => link.role_id === role.id)
      .map((link) => link.permission_key)
      .filter(isPermissionKey),
    members: members.data.filter((m) => m.role_id === role.id).length,
  }));
}

/** Every permission a custom role of this organization may get, with its module. */
export async function listGrantablePermissions(isPlatformOrg: boolean): Promise<PermissionInfo[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("permissions").select("key, module_key").order("key");
  if (error) throw error;
  const allowed = new Set<string>(
    customRolePermissionKeys(
      isPlatformOrg,
      data.map((row) => ({ key: row.key, module: row.module_key })),
    ),
  );
  return data.flatMap((row) =>
    allowed.has(row.key) && isPermissionKey(row.key)
      ? [{ key: row.key, module: row.module_key }]
      : [],
  );
}
