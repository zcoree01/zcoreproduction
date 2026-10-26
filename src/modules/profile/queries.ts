import "server-only";
import { z } from "zod";
import type { CurrentMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type MyEmployee = {
  employeeNumber: number;
  department: string | null;
  jobTitle: string | null;
  machines: { code: string; name: string }[];
};

const machinesJson = z.array(z.object({ code: z.string(), name: z.string() }));

/**
 * The signed-in user's own employee record, if their account is linked to
 * one (RLS lets everyone read their own employee row).
 */
export async function getMyEmployee(member: CurrentMember): Promise<MyEmployee | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_directory")
    .select("employee_number, department_name, job_title_name, machines")
    .eq("organization_id", member.organization.id)
    .eq("user_id", member.userId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.employee_number === null) return null;

  const machines = machinesJson.safeParse(data.machines);
  return {
    employeeNumber: data.employee_number,
    department: data.department_name,
    jobTitle: data.job_title_name,
    machines: machines.success ? machines.data : [],
  };
}
