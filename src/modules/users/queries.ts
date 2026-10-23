import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MemberRow = {
  userId: string;
  username: string;
  fullName: string | null;
  role: { key: string; name: string };
  active: boolean;
  createdAt: string;
};

export async function listMembers(organizationId: string): Promise<MemberRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select(
      `user_id, created_at, archived_at,
       role:roles!memberships_organization_id_role_id_fkey (key, name),
       profile:profiles!memberships_organization_id_user_id_fkey (username, full_name)`,
    )
    .eq("organization_id", organizationId);
  if (error) throw error;

  return data
    .flatMap((row) =>
      row.role && row.profile
        ? [
            {
              userId: row.user_id,
              username: row.profile.username,
              fullName: row.profile.full_name,
              role: row.role,
              active: row.archived_at === null,
              createdAt: row.created_at,
            },
          ]
        : [],
    )
    .sort((a, b) => a.username.localeCompare(b.username));
}

export type AssignableRole = { id: string; key: string; name: string };

export async function listAssignableRoles(organizationId: string): Promise<AssignableRole[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("id, key, name, is_system")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("is_system", { ascending: false })
    .order("name");
  if (error) throw error;
  return data.map(({ id, key, name }) => ({ id, key, name }));
}
