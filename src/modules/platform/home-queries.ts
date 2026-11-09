import "server-only";
import { createClient } from "@/lib/supabase/server";
import { platformHomeSchema, type PlatformHome } from "./home";

/** Numbers for the Zcore home page; permissions are checked in the database. */
export async function getPlatformHome(): Promise<PlatformHome> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_home");
  if (error) throw error;
  return platformHomeSchema.parse(data);
}
