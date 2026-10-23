import "server-only";
import { createClient } from "@/lib/supabase/server";

// Display name of the organization a login screen belongs to (null = unknown slug).
export async function getLoginOrganizationName(slug: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_login_organization", { p_slug: slug });
  if (error) throw error;
  return data?.[0]?.name ?? null;
}
