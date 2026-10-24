"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, dbErrorKind, invalidFields, violates } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  EMPLOYEE_FIELDS,
  employeeSchema,
  toSaveEmployeeArgs,
  type EmployeeActionResult,
  type EmployeeError,
  type EmployeeField,
} from "./schemas";

const fail = actionFail<EmployeeField, EmployeeError>;

function revalidateEmployeeScreens() {
  revalidatePath("/employees");
  revalidatePath("/floor/machines");
}

function mapWriteError(error: { code?: string; message?: string }): EmployeeActionResult {
  if (violates(error, "employees_organization_id_employee_number_key")) {
    return fail("number_taken", ["employeeNumber"]);
  }
  if (violates(error, "employees_user_key")) return fail("user_taken", ["userId"]);
  switch (dbErrorKind(error)) {
    case "foreign_key":
      // A catalog item, account or machine of another organization / wrong kind.
      return fail("invalid_reference");
    case "denied":
      return fail("denied");
    case "not_found":
      return fail("not_found");
    default:
      console.error("employee write failed", error);
      return fail("unexpected");
  }
}

/**
 * Creates (id null) or updates an employee together with skills and machines
 * in one transaction (public.save_employee). `input` is re-validated here.
 */
export async function saveEmployeeAction(
  id: unknown,
  input: unknown,
): Promise<EmployeeActionResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "employees.manage"))) return fail("denied");

  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = employeeSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, EMPLOYEE_FIELDS));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "save_employee",
    toSaveEmployeeArgs(organizationId, parsedId.data, parsed.data),
  );
  if (error) return mapWriteError(error);

  revalidateEmployeeScreens();
  return { ok: true, id: data };
}

/**
 * Archive (hide from lists) or restore an employee. Restoring fails with
 * user_taken when their account is meanwhile linked to another employee.
 */
export async function setEmployeeArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<EmployeeActionResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "employees.manage"))) return fail("denied");

  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return fail("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return mapWriteError(error);
  if (data.length === 0) return fail("not_found");

  revalidateEmployeeScreens();
  return { ok: true, id: parsed.data.id };
}
