"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { nullableParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import { pinSchema, weakPin } from "./kiosk-rules";

// Managing kiosks and credentials (kiosk.manage) and the worker's own PIN.
// Secrets never leave the database; the activation code is shown once.

export type KioskAdminResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; error: "invalid" | "denied" | "not_found" | "weak_pin" | "unexpected" };

function fail(error: "invalid" | "denied" | "not_found" | "weak_pin" | "unexpected") {
  return { ok: false as const, error };
}

function dbFail(error: { code?: string; message?: string }, context: string) {
  if (error.code === "42501") return fail("denied");
  if (error.code === "P0002") return fail("not_found");
  if (error.code === "22023") return fail("invalid");
  console.error(`${context} failed`, error);
  return fail("unexpected");
}

async function managerOrg(): Promise<string | null> {
  const member = await requireMember();
  return (await permitAction(member.organization.id, "kiosk.manage"))
    ? member.organization.id
    : null;
}

export type Activation = { kioskId: string; code: string; expiresAt: string };

/** New kiosk (name) or a new code for an existing one (signs the old tablet out). */
export async function createKioskActivationAction(
  kioskId: string | null,
  name: unknown,
): Promise<KioskAdminResult<Activation>> {
  const org = await managerOrg();
  if (!org) return fail("denied");
  const parsedId = z.uuid().nullable().safeParse(kioskId);
  const parsedName = z
    .string()
    .trim()
    .max(60)
    .safeParse(name ?? "");
  if (!parsedId.success || !parsedName.success) return fail("invalid");
  if (parsedId.data === null && parsedName.data === "") return fail("invalid");
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_kiosk_activation", {
      p_org_id: org,
      p_kiosk_id: nullableParam(parsedId.data),
      p_name: parsedName.data,
    })
    .single();
  if (error) return dbFail(error, "create kiosk activation");
  revalidatePath("/settings/kiosk");
  return {
    ok: true,
    value: { kioskId: data.kiosk_id, code: data.code, expiresAt: data.expires_at },
  };
}

export async function revokeKioskAction(kioskId: unknown): Promise<KioskAdminResult> {
  const org = await managerOrg();
  if (!org) return fail("denied");
  const parsed = z.uuid().safeParse(kioskId);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_kiosk", { p_kiosk_id: parsed.data });
  if (error) return dbFail(error, "revoke kiosk");
  revalidatePath("/settings/kiosk");
  return { ok: true };
}

/** kiosk.manage sets a PIN ("" removes it). */
export async function setEmployeePinAction(
  employeeId: unknown,
  pin: unknown,
): Promise<KioskAdminResult> {
  const org = await managerOrg();
  if (!org) return fail("denied");
  const parsedId = z.uuid().safeParse(employeeId);
  const parsedPin = z.union([z.literal(""), pinSchema]).safeParse(pin);
  if (!parsedId.success || !parsedPin.success) return fail("invalid");
  if (parsedPin.data && weakPin(parsedPin.data)) return fail("weak_pin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_employee_pin", {
    p_employee_id: parsedId.data,
    p_pin: nullableParam(parsedPin.data || null),
  });
  if (error) return dbFail(error, "set employee pin");
  revalidatePath("/settings/kiosk");
  return { ok: true };
}

export async function issueBadgeAction(employeeId: unknown): Promise<KioskAdminResult> {
  const org = await managerOrg();
  if (!org) return fail("denied");
  const parsed = z.uuid().safeParse(employeeId);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_badge", { p_employee_id: parsed.data });
  if (error) return dbFail(error, "issue badge");
  revalidatePath("/settings/kiosk");
  return { ok: true };
}

/** The worker sets their own kiosk PIN. */
export async function setOwnPinAction(pin: unknown): Promise<KioskAdminResult> {
  const member = await requireMember();
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) return fail("invalid");
  if (weakPin(parsed.data)) return fail("weak_pin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_own_pin", {
    p_org_id: member.organization.id,
    p_pin: parsed.data,
  });
  if (error) return dbFail(error, "set own pin");
  revalidatePath("/floor/attendance");
  return { ok: true };
}
