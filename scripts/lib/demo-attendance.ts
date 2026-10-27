// Demo shifts for the "demo" organization. DEMO ONLY (seeded by
// `npm run seed:demo`): three 8-hour shifts and two 12-hour turnus shifts,
// each with a 30-minute paid break. Idempotent: skipped when the
// organization already has shifts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { addDays, mondayOf, rotationDay } from "@/modules/attendance/schedule-rules";
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

// Demo crews A (employee 1) and B (employee 2) on a 14-day rotation: a week
// of I shift and a week of II shift (Monday–Friday), the crews a week apart.
// The schedule is written for this week and the next five. Idempotent:
// skipped when the organization already has crews.
export async function seedDemoSchedule(admin: Admin, org: ProvisionedOrganization) {
  const existing = await admin
    .from("shift_crews")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id);
  if (existing.error) throw existing.error;
  if ((existing.count ?? 0) > 0) return;

  const shifts = await admin
    .from("shifts")
    .select("id, code")
    .eq("organization_id", org.id)
    .in("code", ["I", "II"])
    .is("archived_at", null)
    .throwOnError();
  const first = shifts.data.find((shift) => shift.code === "I")?.id;
  const second = shifts.data.find((shift) => shift.code === "II")?.id;
  const employees = await admin
    .from("employees")
    .select("id, employee_number")
    .eq("organization_id", org.id)
    .in("employee_number", [1, 2])
    .throwOnError();
  const employee = (n: number) => employees.data.find((row) => row.employee_number === n)?.id;
  const omer = employee(1);
  const benjamin = employee(2);
  if (!first || !second || !omer || !benjamin) return;

  const crews = await admin
    .from("shift_crews")
    .insert([
      { organization_id: org.id, name: "Ekipa A", color: "#0ea5e9" },
      { organization_id: org.id, name: "Ekipa B", color: "#f59e0b" },
    ])
    .select("id, name")
    .throwOnError();
  const crewA = crews.data.find((crew) => crew.name === "Ekipa A")!.id;
  const crewB = crews.data.find((crew) => crew.name === "Ekipa B")!.id;
  await admin
    .from("shift_crew_members")
    .insert([
      { organization_id: org.id, crew_id: crewA, employee_id: omer },
      { organization_id: org.id, crew_id: crewB, employee_id: benjamin },
    ])
    .throwOnError();

  const pattern = [0, 1, 2, 3, 4]
    .map((day) => ({ day, shiftId: first }))
    .concat([7, 8, 9, 10, 11].map((day) => ({ day, shiftId: second })));
  const rotation = await admin
    .from("shift_rotations")
    .insert({ organization_id: org.id, name: "Sedmična izmjena I/II", cycle_days: 14 })
    .select("id")
    .single()
    .throwOnError();
  await admin
    .from("shift_rotation_days")
    .insert(
      pattern.map((item) => ({
        organization_id: org.id,
        rotation_id: rotation.data.id,
        day_index: item.day,
        shift_id: item.shiftId,
      })),
    )
    .throwOnError();

  const today = new Date().toISOString().slice(0, 10);
  const monday = mondayOf(today);
  const starts = [
    { crewId: crewA, employeeId: omer, start: monday },
    { crewId: crewB, employeeId: benjamin, start: addDays(monday, -7) },
  ];
  await admin
    .from("shift_rotation_assignments")
    .insert(
      starts.map((item) => ({
        organization_id: org.id,
        rotation_id: rotation.data.id,
        crew_id: item.crewId,
        start_date: item.start,
      })),
    )
    .throwOnError();

  const rows = starts.flatMap((item) =>
    Array.from({ length: 42 }, (_, offset) => addDays(monday, offset)).flatMap((date) => {
      const day = rotationDay(date, item.start, 14);
      const shiftId = pattern.find((entry) => entry.day === day)?.shiftId;
      return shiftId
        ? [
            {
              organization_id: org.id,
              employee_id: item.employeeId,
              work_date: date,
              shift_id: shiftId,
              source: "rotation",
            },
          ]
        : [];
    }),
  );
  await admin
    .from("shift_schedule")
    .upsert(rows, { onConflict: "organization_id,employee_id,work_date" })
    .throwOnError();
}
