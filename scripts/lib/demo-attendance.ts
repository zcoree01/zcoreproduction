// Demo shifts for the "demo" organization. DEMO ONLY (seeded by
// `npm run seed:demo`): three 8-hour shifts and two 12-hour turnus shifts,
// each with a 30-minute paid break. Idempotent: skipped when the
// organization already has shifts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { ProvisionedOrganization } from "@/modules/organizations/provision";

type Admin = SupabaseClient<Database>;

const SHIFTS = [
  { code: "I", name: "I smjena", starts_at: "06:00", ends_at: "14:00", color: "#0ea5e9" },
  { code: "II", name: "II smjena", starts_at: "14:00", ends_at: "22:00", color: "#f59e0b" },
  { code: "III", name: "III smjena", starts_at: "22:00", ends_at: "06:00", color: "#6366f1" },
  { code: "T12D", name: "Turnus dnevni", starts_at: "06:00", ends_at: "18:00", color: "#10b981" },
  { code: "T12N", name: "Turnus noćni", starts_at: "18:00", ends_at: "06:00", color: "#8b5cf6" },
];

export async function seedDemoAttendance(admin: Admin, org: ProvisionedOrganization) {
  const existing = await admin
    .from("shifts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id);
  if (existing.error) throw existing.error;
  if ((existing.count ?? 0) > 0) return;

  const shifts = await admin
    .from("shifts")
    .insert(SHIFTS.map((shift) => ({ ...shift, organization_id: org.id })))
    .select("id")
    .throwOnError();
  await admin
    .from("shift_breaks")
    .insert(
      shifts.data.map((shift) => ({
        organization_id: org.id,
        shift_id: shift.id,
        position: 1,
        name: "Pauza",
        duration_min: 30,
        paid: true,
      })),
    )
    .throwOnError();
}
