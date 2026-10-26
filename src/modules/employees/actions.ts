"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, dbErrorKind, invalidFields, violates } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createUserWithTempPassword } from "@/modules/users/server";
import {
  EMPLOYEE_FIELDS,
  employeeSchema,
  toSaveEmployeeArgs,
  type EmployeeActionResult,
  type EmployeeError,
  type EmployeeField,
  type EmployeeSaveResult,
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
 * With `newAccountRoleId` (needs users.manage as well) a user account with a
 * generated username (ime.p, ime.pr, …) and a temporary password is created
 * after the employee is saved and linked to it.
 */
export async function saveEmployeeAction(id: unknown, input: unknown): Promise<EmployeeSaveResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "employees.manage"))) return fail("denied");

  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = employeeSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, EMPLOYEE_FIELDS));
  const { newAccountRoleId } = parsed.data;
  if (newAccountRoleId && !(await permitAction(organizationId, "users.manage"))) {
    return fail("denied");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "save_employee",
    toSaveEmployeeArgs(organizationId, parsedId.data, parsed.data),
  );
  if (error) return mapWriteError(error);
  revalidateEmployeeScreens();
  if (!newAccountRoleId) return { ok: true, id: data };

  // Two systems (Auth + database): the employee stays saved if this fails and
  // the account can be created again from the edit form.
  try {
    const { firstName, lastName } = parsed.data;
    const account = await createUserWithTempPassword(member, {
      username: null,
      fullName: `${firstName} ${lastName}`,
      firstName,
      lastName,
      roleId: newAccountRoleId,
    });
    if (!account.ok) return { ok: true, id: data, accountFailed: true };

    const linked = await supabase
      .from("employees")
      .update({ user_id: account.userId })
      .eq("organization_id", organizationId)
      .eq("id", data);
    if (linked.error) throw linked.error;

    revalidatePath("/admin/users");
    return {
      ok: true,
      id: data,
      account: { username: account.username, password: account.password },
    };
  } catch (accountError) {
    console.error("creating the employee's account failed", accountError);
    return { ok: true, id: data, accountFailed: true };
  }
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
