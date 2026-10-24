import "server-only";
import { z } from "zod";
import { pageRange, toSearchPattern } from "@/lib/data-table/params";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeListParams } from "./list-params";
import {
  employeeStatusSchema,
  skillLevelSchema,
  type EmployeeStatus,
  type SkillLevel,
} from "./schemas";

export type EmployeeRow = {
  id: string;
  employeeNumber: number;
  firstName: string;
  lastName: string;
  department: { id: string; name: string } | null;
  jobTitle: { id: string; name: string } | null;
  user: { id: string; username: string } | null;
  status: EmployeeStatus;
  skills: { skillId: string; name: string; level: SkillLevel }[];
  machines: { machineId: string; code: string; name: string }[];
  archived: boolean;
};

export type EmployeePage = { rows: EmployeeRow[]; total: number };

// JSON aggregates built by the employee_directory view.
const skillsJson = z.array(
  z.object({ skill_id: z.uuid(), name: z.string(), level: skillLevelSchema }),
);
const machinesJson = z.array(
  z.object({ machine_id: z.uuid(), code: z.string(), name: z.string() }),
);

const COLUMNS =
  "id, employee_number, first_name, last_name, department_id, department_name, job_title_id, job_title_name, user_id, username, status, skills, machines, archived_at";

// One page of employees via the RLS-respecting employee_directory view.
export async function listEmployeesPage(
  organizationId: string,
  params: EmployeeListParams,
): Promise<EmployeePage> {
  const supabase = await createClient();

  const pattern = toSearchPattern(params.q);
  const filtered = () => {
    let query = supabase
      .from("employee_directory")
      .select(COLUMNS, { count: "exact" })
      .eq("organization_id", organizationId);
    query =
      params.view === "archived"
        ? query.not("archived_at", "is", null)
        : query.is("archived_at", null);
    if (params.status) query = query.eq("status", params.status);
    if (params.department) query = query.eq("department_id", params.department);
    // JSON string: supabase-js would encode a JS array as a Postgres array ({...}),
    // which is not valid jsonb for the `cs` (@>) operator.
    if (params.skill)
      query = query.contains("skills", JSON.stringify([{ skill_id: params.skill }]));
    if (pattern) {
      query = query.or(
        `full_name.ilike.${pattern},employee_number_text.ilike.${pattern},username.ilike.${pattern}`,
      );
    }
    return query;
  };

  const { from, to } = pageRange(params);
  const { data, count, error } = await filtered().order("employee_number").range(from, to);

  if (error) {
    // Page beyond the last one (e.g. stale URL after filtering): no rows, real total.
    if (error.code === "PGRST103") {
      const counted = await filtered().limit(0);
      if (counted.error) throw counted.error;
      return { rows: [], total: counted.count ?? 0 };
    }
    throw error;
  }

  return {
    total: count ?? 0,
    rows: data.flatMap((row): EmployeeRow[] => {
      const status = employeeStatusSchema.safeParse(row.status);
      const skills = skillsJson.safeParse(row.skills);
      const machines = machinesJson.safeParse(row.machines);
      if (
        !row.id ||
        row.employee_number === null ||
        !row.first_name ||
        !row.last_name ||
        !status.success ||
        !skills.success ||
        !machines.success
      ) {
        return [];
      }
      return [
        {
          id: row.id,
          employeeNumber: row.employee_number,
          firstName: row.first_name,
          lastName: row.last_name,
          department:
            row.department_id && row.department_name
              ? { id: row.department_id, name: row.department_name }
              : null,
          jobTitle:
            row.job_title_id && row.job_title_name
              ? { id: row.job_title_id, name: row.job_title_name }
              : null,
          user: row.user_id && row.username ? { id: row.user_id, username: row.username } : null,
          status: status.data,
          skills: skills.data.map((s) => ({ skillId: s.skill_id, name: s.name, level: s.level })),
          machines: machines.data.map((m) => ({
            machineId: m.machine_id,
            code: m.code,
            name: m.name,
          })),
          archived: row.archived_at !== null,
        },
      ];
    }),
  };
}

export type LinkableUser = {
  userId: string;
  username: string;
  fullName: string | null;
  /** Current (non-archived) employee using this account, if any. */
  employeeId: string | null;
};

/** Active accounts of the organization and which employee (if any) uses each. */
export async function listLinkableUsers(organizationId: string): Promise<LinkableUser[]> {
  const supabase = await createClient();
  const [members, links] = await Promise.all([
    supabase
      .from("member_directory")
      .select("user_id, username, full_name")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("username"),
    supabase
      .from("employees")
      .select("id, user_id")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .not("user_id", "is", null),
  ]);
  if (members.error) throw members.error;
  if (links.error) throw links.error;

  const employeeByUser = new Map(links.data.map((row) => [row.user_id, row.id]));
  return members.data.flatMap((row) =>
    row.user_id && row.username
      ? [
          {
            userId: row.user_id,
            username: row.username,
            fullName: row.full_name,
            employeeId: employeeByUser.get(row.user_id) ?? null,
          },
        ]
      : [],
  );
}
