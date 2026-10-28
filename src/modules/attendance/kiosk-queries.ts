import "server-only";
import { createClient } from "@/lib/supabase/server";

// Reads for the kiosk settings (kiosk.manage) and the worker's PIN status.

export type KioskRow = {
  id: string;
  name: string;
  status: "active" | "pending" | "expired" | "revoked";
  activatedAt: string | null;
  lastSeenAt: string | null;
};

export async function listKiosks(organizationId: string): Promise<KioskRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_kiosks", { p_org_id: organizationId });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    status:
      row.status === "active" || row.status === "pending" || row.status === "revoked"
        ? row.status
        : "expired",
    activatedAt: row.activated_at,
    lastSeenAt: row.last_seen_at,
  }));
}

export type CredentialRow = {
  employeeId: string;
  number: number;
  name: string;
  hasPin: boolean;
  badgeToken: string | null;
  lockedUntil: string | null;
};

export async function listKioskCredentials(organizationId: string): Promise<CredentialRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kiosk_credentials", { p_org_id: organizationId });
  if (error) throw error;
  return data.map((row) => ({
    employeeId: row.employee_id,
    number: row.employee_number,
    name: row.name,
    hasPin: row.has_pin,
    badgeToken: row.badge_token,
    lockedUntil: row.locked_until,
  }));
}

export async function myPinIsSet(organizationId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_kiosk_pin_set", { p_org_id: organizationId });
  if (error) throw error;
  return data === true;
}
