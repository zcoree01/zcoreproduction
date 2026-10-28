import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database } from "@/lib/supabase/types";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { createAdminClient, readAdminEnv } from "../../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../shared/test-tenants";

// Temporary passwords and profile settings (D-022): the flag is set at
// provisioning from app_metadata, only the service role clears it, users edit
// only their own preferences, and the proxy reads both flags in one call.
// Dedicated users so shared fixture sessions are never revoked.
const TEMP_USER = "db.temppw";
const PLAIN_USER = "db.profile";

let orgId = "";
let tempUserId = "";
let plainUserId = "";

function client(): SupabaseClient<Database> {
  const env = readAdminEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedIn(username: string) {
  const device = client();
  const { error } = await device.auth.signInWithPassword({
    email: toAuthEmail(username, TEST_TENANTS.a.slug),
    password: testTenantPassword(),
  });
  if (error) throw error;
  return device;
}

beforeAll(async () => {
  const admin = createAdminClient();
  const org = await ensureOrganization(admin, TEST_TENANTS.a);
  orgId = org.id;
  plainUserId = await ensureUser(admin, org, {
    username: PLAIN_USER,
    password: testTenantPassword(),
    fullName: "DB Profile",
    role: "operator",
  });

  const existing = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", org.id)
    .eq("username", TEMP_USER)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    tempUserId = existing.data.id;
    const reset = await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", tempUserId);
    if (reset.error) throw reset.error;
    const pw = await admin.auth.admin.updateUserById(tempUserId, {
      password: testTenantPassword(),
    });
    if (pw.error) throw pw.error;
  } else {
    // What createOrgUser does: the flag travels in app_metadata.
    const created = await admin.auth.admin.createUser({
      email: toAuthEmail(TEMP_USER, org.slug),
      password: testTenantPassword(),
      email_confirm: true,
      app_metadata: {
        organization_id: org.id,
        username: TEMP_USER,
        role: "operator",
        must_change_password: true,
      },
      user_metadata: { full_name: "DB Temp Password" },
    });
    if (created.error) throw created.error;
    tempUserId = created.data.user.id;
  }
});

describe("must_change_password", () => {
  it("is set from app_metadata when the user is provisioned", async () => {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("must_change_password")
      .eq("id", tempUserId)
      .single();
    expect(error).toBeNull();
    expect(data?.must_change_password).toBe(true);
  });

  it("is reported by session_status for the proxy", async () => {
    const temp = await signedIn(TEMP_USER);
    const { data, error } = await temp.rpc("session_status").single();
    expect(error).toBeNull();
    expect(data).toEqual({ active: true, must_change_password: true, support_ended: false });

    const plain = await signedIn(PLAIN_USER);
    expect((await plain.rpc("session_status").single()).data).toEqual({
      active: true,
      must_change_password: false,
      support_ended: false,
    });
  });

  it("cannot be cleared by the user themselves", async () => {
    const temp = await signedIn(TEMP_USER);
    const { error } = await temp
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", tempUserId);
    expect(error?.code).toBe("42501");
  });

  it("is visible to administrators in member_directory", async () => {
    const { data, error } = await createAdminClient()
      .from("member_directory")
      .select("must_change_password")
      .eq("organization_id", orgId)
      .eq("user_id", tempUserId)
      .single();
    expect(error).toBeNull();
    expect(data?.must_change_password).toBe(true);
  });
});

describe("session_status", () => {
  it("is not callable anonymously", async () => {
    const { data, error } = await client().rpc("session_status").maybeSingle();
    expect(error !== null || data?.active !== true).toBe(true);
  });
});

describe("preferences", () => {
  it("can be changed by the user for their own profile", async () => {
    const plain = await signedIn(PLAIN_USER);
    const { data, error } = await plain
      .from("profiles")
      .update({ preferences: { text_size: "large" } })
      .eq("id", plainUserId)
      .select("preferences");
    expect(error).toBeNull();
    expect(data).toEqual([{ preferences: { text_size: "large" } }]);
    await plain.from("profiles").update({ preferences: {} }).eq("id", plainUserId);
  });

  it("cannot be changed for another user without users.manage", async () => {
    const plain = await signedIn(PLAIN_USER);
    const { data, error } = await plain
      .from("profiles")
      .update({ preferences: { text_size: "large" } })
      .eq("id", tempUserId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("must be a JSON object", async () => {
    const plain = await signedIn(PLAIN_USER);
    const { error } = await plain
      .from("profiles")
      .update({ preferences: ["large"] })
      .eq("id", plainUserId);
    expect(error?.code).toBe("23514");
  });
});

describe("revoke_user_sessions", () => {
  it("is not executable by signed-in users", async () => {
    const plain = await signedIn(PLAIN_USER);
    const { error } = await plain.rpc("revoke_user_sessions", { p_user_id: tempUserId });
    expect(error?.code).toBe("42501");
  });

  it("signs the user out on every device (service role)", async () => {
    const first = await signedIn(TEMP_USER);
    const second = await signedIn(TEMP_USER);
    const { error } = await createAdminClient().rpc("revoke_user_sessions", {
      p_user_id: tempUserId,
    });
    expect(error).toBeNull();
    for (const device of [first, second]) {
      expect((await device.rpc("session_status").single()).data?.active).toBe(false);
    }
  });
});
