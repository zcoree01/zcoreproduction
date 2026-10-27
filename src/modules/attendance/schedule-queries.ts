import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Reads for the schedule screens (attendance.read via RLS / the functions).

export type ScheduleCell = { shiftId: string; source: "manual" | "rotation" };

export type ScheduleRow = {
  id: string;
  number: number;
  name: string;
  departmentId: string | null;
  department: string | null;
  crewId: string | null;
  crew: string | null;
  crewColor: string | null;
  /** By work date. */
  entries: Record<string, ScheduleCell>;
};

const rangeSchema = z.object({
  employees: z.array(
    z.object({
      id: z.uuid(),
      number: z.number().int(),
      name: z.string(),
      department_id: z.uuid().nullable(),
      department: z.string().nullable(),
      crew_id: z.uuid().nullable(),
      crew: z.string().nullable(),
      crew_color: z.string().nullable(),
      entries: z.array(
        z.object({
          date: z.string(),
          shift_id: z.uuid(),
          source: z.enum(["manual", "rotation"]),
        }),
      ),
    }),
  ),
});

/** The grid for [from, to] (at most 62 days); null without attendance.read. */
export async function getScheduleRange(
  organizationId: string,
  from: string,
  to: string,
): Promise<ScheduleRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("schedule_range", {
    p_org_id: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  if (data === null) return null;
  return rangeSchema.parse(data).employees.map((row) => ({
    id: row.id,
    number: row.number,
    name: row.name,
    departmentId: row.department_id,
    department: row.department,
    crewId: row.crew_id,
    crew: row.crew,
    crewColor: row.crew_color,
    entries: Object.fromEntries(
      row.entries.map((entry) => [entry.date, { shiftId: entry.shift_id, source: entry.source }]),
    ),
  }));
}

export type Crew = {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  employeeIds: string[];
};

export async function listCrews(organizationId: string): Promise<Crew[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_crews")
    .select("id, name, color, archived_at, shift_crew_members (employee_id)")
    .eq("organization_id", organizationId)
    .order("archived_at", { nullsFirst: true })
    .order("name");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    archived: row.archived_at !== null,
    employeeIds: row.shift_crew_members.map((member) => member.employee_id),
  }));
}

export type Rotation = {
  id: string;
  name: string;
  cycleDays: number;
  archived: boolean;
  /** Shift id per day of the cycle (null = day off). */
  days: (string | null)[];
};

export async function listRotations(organizationId: string): Promise<Rotation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_rotations")
    .select("id, name, cycle_days, archived_at, shift_rotation_days (day_index, shift_id)")
    .eq("organization_id", organizationId)
    .order("archived_at", { nullsFirst: true })
    .order("name");
  if (error) throw error;
  return data.map((row) => {
    const days: (string | null)[] = Array.from({ length: row.cycle_days }, () => null);
    for (const day of row.shift_rotation_days) {
      if (day.day_index < days.length) days[day.day_index] = day.shift_id;
    }
    return {
      id: row.id,
      name: row.name,
      cycleDays: row.cycle_days,
      archived: row.archived_at !== null,
      days,
    };
  });
}

export type RotationAssignment = {
  id: string;
  rotationId: string;
  crewId: string | null;
  employeeId: string | null;
  startDate: string;
  endDate: string | null;
};

export async function listRotationAssignments(
  organizationId: string,
): Promise<RotationAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_rotation_assignments")
    .select("id, rotation_id, crew_id, employee_id, start_date, end_date")
    .eq("organization_id", organizationId)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    rotationId: row.rotation_id,
    crewId: row.crew_id,
    employeeId: row.employee_id,
    startDate: row.start_date,
    endDate: row.end_date,
  }));
}

export type ScheduleEmployee = { id: string; number: number; name: string };

/** Active employees for crew membership and assignments. */
export async function listScheduleEmployees(organizationId: string): Promise<ScheduleEmployee[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, employee_number, first_name, last_name")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .is("archived_at", null)
    .order("last_name")
    .order("first_name");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    number: row.employee_number,
    name: `${row.first_name} ${row.last_name}`,
  }));
}

export type MyScheduleDay = {
  date: string;
  code: string;
  name: string;
  startsAt: string;
  endsAt: string;
};

/** The caller's own planned shifts for [from, to]. */
export async function getMySchedule(
  organizationId: string,
  from: string,
  to: string,
): Promise<MyScheduleDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_schedule", {
    p_org_id: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return data.map((row) => ({
    date: row.work_date,
    code: row.code,
    name: row.name,
    startsAt: row.starts_at.slice(0, 5),
    endsAt: row.ends_at.slice(0, 5),
  }));
}
