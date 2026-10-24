import {
  ensureModuleEnabled,
  ensureOrganization,
  ensureUser,
} from "@/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";

// Permanent shop-floor fixture in test tenant B: a dedicated operator account
// (no other test signs it out; Supabase sign-out revokes all sessions of a
// user), linked to an employee qualified for one machine. Idempotent.
export const FLOOR_OPERATOR = { username: "e2e.floor", fullName: "E2E Floor Operater" };
export const FLOOR_MACHINE = { code: "E2E-FLOOR", name: "E2E podna mašina" };
const FLOOR_EMPLOYEE_NUMBER = 800001;

export async function ensureFloorFixture() {
  const admin = createAdminClient();
  const org = await ensureOrganization(admin, TEST_TENANTS.b);
  await ensureModuleEnabled(admin, org, "production");
  const userId = await ensureUser(admin, org, {
    ...FLOOR_OPERATOR,
    password: testTenantPassword(),
    role: "operator",
  });

  // machines_code_key is a partial expression index (no upsert target): lookup + insert.
  const machine = await admin
    .from("machines")
    .select("id")
    .eq("organization_id", org.id)
    .eq("code", FLOOR_MACHINE.code)
    .is("archived_at", null)
    .maybeSingle()
    .throwOnError();
  const machineId =
    machine.data?.id ??
    (
      await admin
        .from("machines")
        .insert({ organization_id: org.id, ...FLOOR_MACHINE })
        .select("id")
        .single()
        .throwOnError()
    ).data.id;

  const employee = await admin
    .from("employees")
    .select("id")
    .eq("organization_id", org.id)
    .eq("employee_number", FLOOR_EMPLOYEE_NUMBER)
    .maybeSingle()
    .throwOnError();
  const employeeId =
    employee.data?.id ??
    (
      await admin
        .from("employees")
        .insert({
          organization_id: org.id,
          employee_number: FLOOR_EMPLOYEE_NUMBER,
          first_name: "E2E",
          last_name: "Floor",
          user_id: userId,
        })
        .select("id")
        .single()
        .throwOnError()
    ).data.id;
  await admin
    .from("employees")
    .update({ status: "active", archived_at: null, user_id: userId })
    .eq("id", employeeId)
    .throwOnError();

  await admin
    .from("employee_machines")
    .upsert(
      { organization_id: org.id, employee_id: employeeId, machine_id: machineId },
      { onConflict: "employee_id,machine_id", ignoreDuplicates: true },
    )
    .throwOnError();
  await admin.from("machines").update({ status: "available" }).eq("id", machineId).throwOnError();
}
