import { createClient } from "@supabase/supabase-js";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database } from "@/lib/supabase/types";
import { createAdminClient, readAdminEnv } from "../scripts/lib/admin-client";
import { DEMO_ORG } from "../scripts/lib/demo-users";
import { ensureTestTenant } from "../tests/shared/ensure-test-tenant";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";

// Runs once before the e2e suite (D-052). The test tenants are created here, so
// the suite also works on a freshly reset local database. The demo firm takes
// the full seed script, so it is only checked.
export default async function globalSetup() {
  const service = createAdminClient();
  const tenantA = await ensureTestTenant(service, TEST_TENANTS.a.slug, TEST_TENANTS.a.name);
  await ensureTestTenant(service, TEST_TENANTS.b.slug, TEST_TENANTS.b.name);
  await ensureCompanyProfile(tenantA.org.id);

  const demo = await service
    .from("organizations")
    .select("id")
    .eq("slug", DEMO_ORG.slug)
    .maybeSingle();
  if (demo.error) throw demo.error;
  if (!demo.data) {
    throw new Error("The demo firm is missing: run npm run seed:demo:local first.");
  }
}

// Tenant A edits its company data in companies.spec.ts, which needs a saved
// profile (tax number, address). Saved once, as the tenant's admin, through the
// same RPC as the settings screen; an existing profile is left alone.
async function ensureCompanyProfile(organizationId: string) {
  const service = createAdminClient();
  const org = await service
    .from("organizations")
    .select("company_id")
    .eq("id", organizationId)
    .single()
    .throwOnError();
  if (org.data.company_id) return;

  const env = readAdminEnv();
  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signIn = await admin.auth.signInWithPassword({
    email: toAuthEmail("admin", TEST_TENANTS.a.slug),
    password: testTenantPassword(),
  });
  if (signIn.error) throw signIn.error;

  const saved = await admin.rpc("save_organization_profile", {
    p_org_id: organizationId,
    p_country: "BA",
    p_tax_id: "4999000000001",
    p_fields: {
      name: `${TEST_TENANTS.a.name} d.o.o.`,
      // The short name is the organization's display name: keep the tenant's.
      short_name: TEST_TENANTS.a.name,
      address: "Glavna 1",
      city: "Sarajevo",
    },
    p_bank_accounts: [{ bank_name: "Banka", account_number: "1290079401028494", is_primary: true }],
  });
  if (saved.error) throw saved.error;
  await admin.auth.signOut({ scope: "local" });
}
