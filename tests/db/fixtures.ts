import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database } from "@/lib/supabase/types";
import {
  ensureModuleEnabled,
  ensureOrganization,
  ensureUser,
  type ProvisionedOrganization,
} from "@/modules/organizations/provision";
import { createAdminClient, readAdminEnv } from "../../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../shared/test-tenants";

export type Tenant = {
  org: ProvisionedOrganization;
  adminId: string;
  operatorId: string;
  admin: SupabaseClient<Database>;
  operator: SupabaseClient<Database>;
};

export type Fixture = {
  service: SupabaseClient<Database>;
  anon: SupabaseClient<Database>;
  a: Tenant;
  b: Tenant;
};

function anonClient() {
  const env = readAdminEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function signIn(username: string, slug: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: toAuthEmail(username, slug),
    password: testTenantPassword(),
  });
  if (error) throw error;
  return client;
}

async function setupTenant(
  service: SupabaseClient<Database>,
  slug: string,
  name: string,
): Promise<Tenant> {
  const org = await ensureOrganization(service, { slug, name });
  await ensureModuleEnabled(service, org, "production");
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
  return {
    org,
    adminId,
    operatorId,
    admin: await signIn("admin", slug),
    operator: await signIn("operater", slug),
  };
}

export async function setupFixture(): Promise<Fixture> {
  const service = createAdminClient();
  return {
    service,
    anon: anonClient(),
    a: await setupTenant(service, TEST_TENANTS.a.slug, TEST_TENANTS.a.name),
    b: await setupTenant(service, TEST_TENANTS.b.slug, TEST_TENANTS.b.name),
  };
}
