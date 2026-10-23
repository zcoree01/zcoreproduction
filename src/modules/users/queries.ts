import "server-only";
import { pageRange, toSearchPattern } from "@/lib/data-table/params";
import { createClient } from "@/lib/supabase/server";
import type { MemberListParams } from "./list-params";

export type MemberRow = {
  userId: string;
  username: string;
  fullName: string | null;
  role: { key: string; name: string };
  active: boolean;
  createdAt: string;
};

export type MemberPage = { rows: MemberRow[]; total: number };

// One page of members via the RLS-respecting member_directory view.
export async function listMembersPage(
  organizationId: string,
  params: MemberListParams,
): Promise<MemberPage> {
  const supabase = await createClient();

  const pattern = toSearchPattern(params.q);
  const filtered = () => {
    let query = supabase
      .from("member_directory")
      .select("user_id, username, full_name, role_key, role_name, is_active, created_at", {
        count: "exact",
      })
      .eq("organization_id", organizationId);
    if (params.status) query = query.eq("is_active", params.status === "active");
    if (params.role) query = query.eq("role_key", params.role);
    if (pattern) query = query.or(`username.ilike.${pattern},full_name.ilike.${pattern}`);
    return query;
  };

  const { from, to } = pageRange(params);
  const { data, count, error } = await filtered().order("username").range(from, to);

  if (error) {
    // Page beyond the last one (e.g. stale URL after filtering): no rows, real total.
    if (error.code === "PGRST103") {
      const counted = await filtered().limit(0);
      if (counted.error) throw counted.error;
      return { rows: [], total: counted.count ?? 0 };
    }
    throw error;
  }

  return {
    total: count ?? 0,
    rows: data.flatMap((row) =>
      row.user_id && row.username && row.role_key && row.role_name && row.created_at
        ? [
            {
              userId: row.user_id,
              username: row.username,
              fullName: row.full_name,
              role: { key: row.role_key, name: row.role_name },
              active: row.is_active === true,
              createdAt: row.created_at,
            },
          ]
        : [],
    ),
  };
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
