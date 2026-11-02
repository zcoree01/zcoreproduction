import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { NotificationState } from "./rules";

/** The caller's read and removed bell items (RLS: own rows only). */
export async function getNotificationState(organizationId: string): Promise<NotificationState> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_reads")
    .select("item_key, dismissed_at")
    .eq("organization_id", organizationId);
  if (error) throw error;
  return {
    read: data.map((row) => row.item_key),
    dismissed: data.filter((row) => row.dismissed_at !== null).map((row) => row.item_key),
  };
}
