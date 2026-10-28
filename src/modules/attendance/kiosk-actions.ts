"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSlug } from "@/lib/tenant/server";
import { readKioskDevice } from "./kiosk-device";
import {
  activationSchema,
  encodeDevice,
  KIOSK_COOKIE,
  KIOSK_ERRORS,
  kioskClockSchema,
  parseBadge,
  type KioskError,
} from "./kiosk-rules";

// Actions of the kiosk tablet (no user session). Every call is bound to the
// tenant of the host and, except activation, to the verified device cookie;
// the database functions are executable by the service role only.

const ONE_YEAR = 60 * 60 * 24 * 365;

function kioskError(message: string | undefined): KioskError {
  return KIOSK_ERRORS.find((key) => key === message) ?? "unexpected";
}

/** Redeems a one-time activation code and stores the device cookie. */
export async function activateKioskAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: KioskError }> {
  const parsed = activationSchema.safeParse(input);
  const slug = await getTenantSlug();
  if (!parsed.success || !slug) return { ok: false, error: "invalid_code" };
  const { data, error } = await createAdminClient()
    .rpc("kiosk_activate", { p_org_slug: slug, p_code: parsed.data.code })
    .maybeSingle();
  if (error || !data) {
    if (error?.code !== "P0002") console.error("kiosk activation failed", error);
    return { ok: false, error: "invalid_code" };
  }
  (await cookies()).set(KIOSK_COOKIE, encodeDevice(data.kiosk_id, data.secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/kiosk",
    maxAge: ONE_YEAR,
  });
  return { ok: true };
}

export type KioskClockResult =
  | {
      ok: true;
      employeeName: string;
      direction: "in" | "out";
      at: string;
      shiftCode: string | null;
      /** Same worker again within seconds: the last result, nothing changed. */
      repeat: boolean;
    }
  | { ok: false; error: KioskError };

const resultSchema = z.union([
  z.object({ error: z.enum(["pin_wrong", "pin_locked"]) }),
  z.object({
    employee_name: z.string(),
    direction: z.enum(["in", "out"]),
    at: z.string(),
    shift_code: z.string().nullable(),
    repeat: z.boolean().optional(),
  }),
]);

/** Badge scan or name + PIN: clocks the worker in or out (toggle). */
export async function kioskClockAction(input: unknown): Promise<KioskClockResult> {
  const device = await readKioskDevice();
  if (!device) return { ok: false, error: "kiosk_unknown" };
  const parsed = kioskClockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const badge = parsed.data.method === "badge" ? parseBadge(parsed.data.badge) : null;
  if (parsed.data.method === "badge" && !badge) return { ok: false, error: "badge_unknown" };

  const { data, error } = await createAdminClient().rpc("kiosk_clock", {
    p_org_slug: device.slug,
    p_kiosk_id: device.kioskId,
    p_secret: device.secret,
    p_badge: (badge ?? null) as string,
    p_employee_id: (parsed.data.method === "pin" ? parsed.data.employeeId : null) as string,
    p_pin: (parsed.data.method === "pin" ? parsed.data.pin : null) as string,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    const known = kioskError(error.message);
    if (known === "unexpected") console.error("kiosk clock failed", error);
    return { ok: false, error: known };
  }
  const row = resultSchema.parse(data);
  if ("error" in row) return { ok: false, error: row.error };
  return {
    ok: true,
    employeeName: row.employee_name,
    direction: row.direction,
    at: row.at,
    shiftCode: row.shift_code,
    repeat: row.repeat ?? false,
  };
}

/** Removes the device cookie (the tablet must be activated again). */
export async function forgetKioskAction(): Promise<void> {
  (await cookies()).delete({ name: KIOSK_COOKIE, path: "/kiosk" });
}
