"use server";

import { revalidatePath } from "next/cache";
import { dbErrorKind, type DbError } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { nullableParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import {
  assignPackageSchema,
  orgBillingSchema,
  setLockSchema,
  setPaymentSchema,
  unlockUntilSchema,
} from "./schemas";

// Platform billing actions (D-049): platform.manage here and in every RPC.

export type BillingActionError =
  "invalid" | "denied" | "not_found" | "unexpected" | "reason_required" | "module_requirement";
export type BillingActionResult = { ok: true } | { ok: false; error: BillingActionError };

async function platformAllowed(): Promise<boolean> {
  const member = await requireMember();
  return permitAction(member.organization.id, "platform.manage");
}

function billingFail(error: DbError, label: string): BillingActionResult {
  const message = error?.message ?? "";
  if (message === "reason_required") return { ok: false, error: "reason_required" };
  if (message === "module_requirement") return { ok: false, error: "module_requirement" };
  const kind = dbErrorKind(error);
  if (kind === "denied") return { ok: false, error: "denied" };
  if (kind === "not_found") return { ok: false, error: "not_found" };
  if (error?.code === "22023") return { ok: false, error: "invalid" };
  console.error(`${label} failed`, error);
  return { ok: false, error: "unexpected" };
}

function revalidateBilling() {
  revalidatePath("/platform", "layout");
}

export async function assignPackageAction(input: unknown): Promise<BillingActionResult> {
  if (!(await platformAllowed())) return { ok: false, error: "denied" };
  const parsed = assignPackageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_assign_package", {
    p_org_id: parsed.data.organizationId,
    p_package_id: nullableParam(parsed.data.packageId),
  });
  if (error) return billingFail(error, "assignPackageAction");
  revalidateBilling();
  return { ok: true };
}

export async function setOrgBillingAction(input: unknown): Promise<BillingActionResult> {
  if (!(await platformAllowed())) return { ok: false, error: "denied" };
  const parsed = orgBillingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_org_billing", {
    p_org_id: parsed.data.organizationId,
    p_grace_days: nullableParam(parsed.data.graceDays),
    p_auto_lock: parsed.data.autoLock,
  });
  if (error) return billingFail(error, "setOrgBillingAction");
  revalidateBilling();
  return { ok: true };
}

export async function setPaymentAction(input: unknown): Promise<BillingActionResult> {
  if (!(await platformAllowed())) return { ok: false, error: "denied" };
  const parsed = setPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_payment", {
    p_org_id: parsed.data.organizationId,
    p_period: parsed.data.period,
    p_paid: parsed.data.paid,
    p_paid_on: nullableParam(parsed.data.paidOn || null),
    p_note: parsed.data.note.trim(),
  });
  if (error) return billingFail(error, "setPaymentAction");
  revalidateBilling();
  return { ok: true };
}

export async function setLockAction(input: unknown): Promise<BillingActionResult> {
  if (!(await platformAllowed())) return { ok: false, error: "denied" };
  const parsed = setLockSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.some((i) => i.path[0] === "reason")
        ? "reason_required"
        : "invalid",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_lock", {
    p_org_id: parsed.data.organizationId,
    p_locked: parsed.data.locked,
    p_reason: parsed.data.reason.trim(),
  });
  if (error) return billingFail(error, "setLockAction");
  revalidateBilling();
  return { ok: true };
}

export async function unlockUntilAction(input: unknown): Promise<BillingActionResult> {
  if (!(await platformAllowed())) return { ok: false, error: "denied" };
  const parsed = unlockUntilSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_unlock_until", {
    p_org_id: parsed.data.organizationId,
    p_until: nullableParam(parsed.data.until),
  });
  if (error) return billingFail(error, "unlockUntilAction");
  revalidateBilling();
  return { ok: true };
}
