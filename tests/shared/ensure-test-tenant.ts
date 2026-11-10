import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  ensureModuleEnabled,
  ensureOrganization,
  ensureUser,
  type ProvisionedOrganization,
} from "@/modules/organizations/provision";
import { SELLABLE_MODULES } from "@/modules/platform/modules";
import { testTenantPassword } from "./test-tenants";

/**
 * Creates (or repairs) a test tenant with every module and the users "admin"
 * and "operater". Idempotent; shared by the DB test fixture and the e2e global
 * setup, so either suite works on a freshly reset local database (D-052).
 */
export async function ensureTestTenant(
  service: SupabaseClient<Database>,
  slug: string,
  name: string,
): Promise<{ org: ProvisionedOrganization; adminId: string; operatorId: string }> {
  const org = await ensureOrganization(service, { slug, name });
  for (const key of SELLABLE_MODULES) await ensureModuleEnabled(service, org, key);
  const adminId = await ensureUser(service, org, {
    username: "admin",
    password: testTenantPassword(),
    fullName: `${name} Admin`,
    role: "admin",
  });
  const operatorId = await ensureUser(service, org, {
    username: "operater",
    password: testTenantPassword(),
    fullName: `${name} Operater`,
    role: "operator",
  });
  return { org, adminId, operatorId };
}
