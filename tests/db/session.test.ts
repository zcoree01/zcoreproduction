import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database } from "@/lib/supabase/types";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { createAdminClient, readAdminEnv } from "../../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../shared/test-tenants";

// One active session per user (D-013): is_session_active() turns false for a
// device once the same user signs in elsewhere and revokes other sessions.
// Uses a dedicated user so the shared fixture sessions are never revoked.
const USERNAME = "db.session";

function deviceClient(): SupabaseClient<Database> {
  const env = readAdminEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(client: SupabaseClient<Database>) {
  const { error } = await client.auth.signInWithPassword({
    email: toAuthEmail(USERNAME, TEST_TENANTS.a.slug),
    password: testTenantPassword(),
  });
  if (error) throw error;
}

beforeAll(async () => {
  const admin = createAdminClient();
  const org = await ensureOrganization(admin, TEST_TENANTS.a);
  await ensureUser(admin, org, {
    username: USERNAME,
    password: testTenantPassword(),
    fullName: "DB Session",
    role: "operator",
  });
});

describe("is_session_active", () => {
  it("is false for anonymous callers", async () => {
    const { data, error } = await deviceClient().rpc("is_session_active");
    // anon has no EXECUTE: either a privilege error or not active.
    expect(error !== null || data === false).toBe(true);
  });

  it("turns false on the old device after a sign-in that revokes other sessions", async () => {
    const oldDevice = deviceClient();
    await signIn(oldDevice);
    expect((await oldDevice.rpc("is_session_active")).data).toBe(true);

    // What signInAction does on the new device.
    const newDevice = deviceClient();
    await signIn(newDevice);
    const revoke = await newDevice.auth.signOut({ scope: "others" });
    expect(revoke.error).toBeNull();

    expect((await newDevice.rpc("is_session_active")).data).toBe(true);
    // The old access token is still a valid JWT, but its session is gone.
    expect((await oldDevice.rpc("is_session_active")).data).toBe(false);
  });

  it("local sign-out ends only that device's session", async () => {
    const device = deviceClient();
    await signIn(device);
    const { data } = await device.auth.getSession();
    const token = data.session?.access_token;
    expect(token).toBeDefined();

    await device.auth.signOut({ scope: "local" });
    // Re-use the old token: its session no longer exists.
    const reused = createClient<Database>(
      readAdminEnv().NEXT_PUBLIC_SUPABASE_URL,
      readAdminEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    expect((await reused.rpc("is_session_active")).data).toBe(false);
  });
});
