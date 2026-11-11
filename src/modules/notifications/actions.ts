"use server";

import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { notificationKeysSchema } from "./rules";

// Read / removed state of the bell (D-038). Only the caller's own rows.

/** Marks items read, or removes them from the bell; false when refused. */
export async function markNotificationsAction(keys: unknown, dismiss: unknown): Promise<boolean> {
  const member = await requireMember();
  const parsed = notificationKeysSchema.safeParse(keys);
  if (!parsed.success || typeof dismiss !== "boolean") return false;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications", {
    p_org_id: member.organization.id,
    p_keys: parsed.data,
    p_dismiss: dismiss,
  });
  return error === null;
}
