import "server-only";
import { createClient } from "@/lib/supabase/server";
import { defaultLayout, parseStoredLayout, type LayoutWidget } from "./widgets";

export type DashboardRole = { id: string; key: string; name: string; system: boolean };

export type RoleLayout = { widgets: LayoutWidget[]; custom: boolean };

/** The saved layout of a role, else the app's default for its key. */
export async function getRoleLayout(
  organizationId: string,
  role: { id: string; key: string },
): Promise<RoleLayout> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dashboard_layouts")
    .select("widgets")
    .eq("organization_id", organizationId)
    .eq("role_id", role.id)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { widgets: parseStoredLayout(data.widgets), custom: true }
    : { widgets: defaultLayout(role.key), custom: false };
}

/** Active roles of the organization (system roles first). */
export async function listDashboardRoles(organizationId: string): Promise<DashboardRole[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("id, key, name, is_system")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("is_system", { ascending: false })
    .order("name");
  if (error) throw error;
  return data.map((row) => ({ id: row.id, key: row.key, name: row.name, system: row.is_system }));
}

/** Permission keys of one role (to mark widgets the role cannot see). */
export async function listRolePermissions(
  organizationId: string,
  roleId: string,
): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("organization_id", organizationId)
    .eq("role_id", roleId);
  if (error) throw error;
  return data.map((row) => row.permission_key);
}
