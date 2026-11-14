"use server";

import { revalidatePath } from "next/cache";
import { dbErrorKind } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { organizationTimezoneSchema } from "./schemas";

export type SaveTimezoneResult =
  { ok: true } | { ok: false; error: "invalid" | "denied" | "unexpected" };

/**
 * Postavke → Organizacija: the organization's time zone (D-063).
 * One UPDATE through RLS (`organizations_update`, org.settings.manage); the
 * column check rejects unknown zones, `lock_guard` a locked firm, and the row
 * audit trigger records before / after.
 */
export async function saveOrganizationTimezoneAction(input: unknown): Promise<SaveTimezoneResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "org.settings.manage"))) {
    return { ok: false, error: "denied" };
  }
  const parsed = organizationTimezoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ timezone: parsed.data.timezone })
    .eq("id", organizationId)
    .select("id");
  if (error) {
    if (error.code === "23514") return { ok: false, error: "invalid" };
    if (dbErrorKind(error) === "denied") return { ok: false, error: "denied" };
    console.error("organization timezone update failed", error);
    return { ok: false, error: "unexpected" };
  }
  // RLS hides the row from an update it does not allow.
  if (!data?.length) return { ok: false, error: "denied" };

  // Every screen shows times in this zone.
  revalidatePath("/", "layout");
  return { ok: true };
}
