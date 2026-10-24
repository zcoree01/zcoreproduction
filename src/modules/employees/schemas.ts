import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { isUnique, optionalUuid, requiredText } from "@/lib/forms";

// Must match the CHECKs on public.employees.status and employee_skills.level.
export const EMPLOYEE_STATUSES = ["active", "inactive"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);

/** 1 = basic, 2 = independent, 3 = advanced. */
export const SKILL_LEVELS = [1, 2, 3] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];
export const skillLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const MAX_EMPLOYEE_NUMBER = 999_999;

/** "" = assign automatically (new) / keep (existing); otherwise 1..999999. */
export const employeeNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{0,6}$/)
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value === null || (value >= 1 && value <= MAX_EMPLOYEE_NUMBER));

// Shared by the client form (react-hook-form) and the server action.
export const employeeSchema = z.object({
  employeeNumber: employeeNumberSchema,
  firstName: requiredText(100),
  lastName: requiredText(100),
  departmentId: optionalUuid,
  jobTitleId: optionalUuid,
  userId: optionalUuid,
  status: employeeStatusSchema,
  skills: z
    .array(z.object({ skillId: z.uuid(), level: skillLevelSchema }))
    .max(200)
    .refine((skills) => isUnique(skills.map((skill) => skill.skillId))),
  machineIds: z.array(z.uuid()).max(500).refine(isUnique),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;
export type EmployeeFormValues = z.input<typeof employeeSchema>;

export const EMPLOYEE_FIELDS = [
  "employeeNumber",
  "firstName",
  "lastName",
  "departmentId",
  "jobTitleId",
  "userId",
  "status",
  "skills",
  "machineIds",
] as const;

export type EmployeeField = (typeof EMPLOYEE_FIELDS)[number];

export type EmployeeError = "number_taken" | "user_taken" | "invalid_reference";
export type EmployeeActionResult = ActionResult<EmployeeField, EmployeeError>;

/** Arguments of public.save_employee (absent optional values = null in SQL). */
export function toSaveEmployeeArgs(
  organizationId: string,
  employeeId: string | null,
  input: EmployeeInput,
) {
  return {
    p_org_id: organizationId,
    p_employee_id: employeeId ?? undefined,
    p_employee_number: input.employeeNumber ?? undefined,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_department_id: input.departmentId ?? undefined,
    p_job_title_id: input.jobTitleId ?? undefined,
    p_user_id: input.userId ?? undefined,
    p_status: input.status,
    p_skills: input.skills.map((skill) => ({ skill_id: skill.skillId, level: skill.level })),
    p_machine_ids: input.machineIds,
  };
}
