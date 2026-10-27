"use server";

import { revalidatePath } from "next/cache";
import { dbErrorKind } from "@/lib/actions/result";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { zonedLocalToUtc } from "@/lib/timezone";
import { setModuleSchema, trialDaysSchema } from "./schemas";

type PlatformResult = { ok: true } | { ok: false; error: "invalid" | "denied" | "unexpected" };

const PLATFORM_TIMEZONE = "Europe/Sarajevo";

function fail(error: { code?: string; message?: string }, label: string): PlatformResult {
  if (dbErrorKind(error) === "denied") return { ok: false, error: "denied" };
  console.error(`${label} failed`, error);
  return { ok: false, error: "unexpected" };
}

/** Module on / off and trial end for an organization (platform.manage, checked in the RPC). */
export async function setOrganizationModuleAction(input: unknown): Promise<PlatformResult> {
  await requireMember();
  const parsed = setModuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_module", {
    p_org_id: parsed.data.organizationId,
    p_module: parsed.data.module,
    p_enabled: parsed.data.enabled,
    p_active_until: parsed.data.activeUntil
      ? zonedLocalToUtc(`${parsed.data.activeUntil}T23:59`, PLATFORM_TIMEZONE)
      : undefined,
  });
  if (error) return fail(error, "setOrganizationModuleAction");
  revalidatePath("/platform");
  return { ok: true };
}

export async function setTrialDaysAction(days: unknown): Promise<PlatformResult> {
  await requireMember();
  const parsed = trialDaysSchema.safeParse(days);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_trial_days", { p_days: parsed.data });
  if (error) return fail(error, "setTrialDaysAction");
  revalidatePath("/platform/settings");
  return { ok: true };
}
