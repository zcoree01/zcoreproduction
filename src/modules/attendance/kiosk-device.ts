import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSlug } from "@/lib/tenant/server";
import { decodeDevice, KIOSK_COOKIE } from "./kiosk-rules";

// The kiosk tablet has no user session. It is identified by the device
// cookie (kiosk id + secret) issued at activation, checked in the database
// together with the tenant of the host. Only after that check does the
// server call the kiosk functions with the service role (D-029).

export type KioskEmployee = {
  id: string;
  name: string;
  number: number;
  hasPin: boolean;
  present: boolean;
};

export type KioskSession = {
  kioskName: string;
  organizationName: string;
  timeZone: string;
  employees: KioskEmployee[];
};

export type KioskDevice = { slug: string; kioskId: string; secret: string };

/** The device of this request (cookie + tenant), not yet verified. */
export async function readKioskDevice(): Promise<KioskDevice | null> {
  const [slug, store] = await Promise.all([getTenantSlug(), cookies()]);
  const device = decodeDevice(store.get(KIOSK_COOKIE)?.value);
  if (!slug || !device) return null;
  return { slug, ...device };
}

const sessionSchema = z.object({
  kiosk_name: z.string(),
  organization_name: z.string(),
  timezone: z.string(),
  employees: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      number: z.number().int(),
      has_pin: z.boolean(),
      present: z.boolean(),
    }),
  ),
});

/** The verified kiosk session, or null when the device is unknown / revoked. */
export async function getKioskSession(): Promise<KioskSession | null> {
  const device = await readKioskDevice();
  if (!device) return null;
  const { data, error } = await createAdminClient().rpc("kiosk_session", {
    p_org_slug: device.slug,
    p_kiosk_id: device.kioskId,
    p_secret: device.secret,
  });
  if (error) {
    if (error.code === "42501") return null;
    throw error;
  }
  const row = sessionSchema.parse(data);
  return {
    kioskName: row.kiosk_name,
    organizationName: row.organization_name,
    timeZone: row.timezone,
    employees: row.employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      number: employee.number,
      hasPin: employee.has_pin,
      present: employee.present,
    })),
  };
}
