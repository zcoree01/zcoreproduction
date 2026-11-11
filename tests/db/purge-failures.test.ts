import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Failed permanent deletions (D-055): the cron records them through
// record_purge_failure (service role only); the Zcore team reads them through
// platform_purge_failures (platform.read). Uses tenant B as the "failed" firm
// and removes the row again; each run leaves one organization.purge_failed
// audit row in the Zcore organization (the audit log is append-only).

const PLATFORM_USER = "db.platform";
let fx: Fixture;
let platform: SupabaseClient<Database>;
let platformUserId = "";

async function cleanup() {
  await fx.service
    .from("organization_purge_failures")
    .delete()
    .eq("organization_id", fx.b.org.id)
    .throwOnError();
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup();
  const zcore = await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" });
  platformUserId = await ensureUser(fx.service, zcore, {
    username: PLATFORM_USER,
    password: testTenantPassword(),
    fullName: "DB Platform",
    role: "platform_admin",
  });
  await fx.service.from("memberships").update({ archived_at: null }).eq("user_id", platformUserId);
  platform = await signIn(PLATFORM_USER, "zcore");
}, 60_000);

afterAll(async () => {
  await cleanup();
  await fx.service
    .from("memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", platformUserId);
});

describe("purge failures", () => {
  it("records each failure and shows the latest to the Zcore team", async () => {
    const startedAt = new Date().toISOString();
    const first = await fx.service.rpc("record_purge_failure", {
      p_org_id: fx.b.org.id,
      p_error: "rows left after purge: 3",
    });
    expect(first.error).toBeNull();
    const second = await fx.service.rpc("record_purge_failure", {
      p_org_id: fx.b.org.id,
      p_error: "x".repeat(2500),
    });
    expect(second.error).toBeNull();

    const list = await platform.rpc("platform_purge_failures");
    expect(list.error).toBeNull();
    const row = list.data?.find((r) => r.organization_id === fx.b.org.id);
    expect(row).toMatchObject({ slug: fx.b.org.slug, attempts: 2 });
    // The latest error, cut to 2000 characters.
    expect(row?.error).toHaveLength(2000);
    expect(row!.last_failed_at >= row!.first_failed_at).toBe(true);

    // Only the first failure is audited.
    const audit = await fx.service
      .from("audit_log")
      .select("after")
      .eq("action", "organization.purge_failed")
      .eq("entity_id", fx.b.org.id)
      .gte("created_at", startedAt);
    expect(audit.data).toHaveLength(1);
    expect(audit.data?.[0]?.after).toMatchObject({ error: "rows left after purge: 3" });
  });

  it("ignores an unknown firm", async () => {
    const result = await fx.service.rpc("record_purge_failure", {
      p_org_id: "00000000-0000-0000-0000-000000000000",
      p_error: "x",
    });
    expect(result.error).toBeNull();
  });

  it("is hidden from tenants and cannot be written by members", async () => {
    const list = await fx.a.admin.rpc("platform_purge_failures");
    expect(list.error?.code).toBe("42501");
    const record = await fx.a.admin.rpc("record_purge_failure", {
      p_org_id: fx.a.org.id,
      p_error: "fake",
    });
    expect(record.error?.code).toBe("42501");
    const direct = await fx.a.admin.from("organization_purge_failures").select("organization_id");
    expect(direct.error?.code).toBe("42501");
    const fromPlatform = await platform
      .from("organization_purge_failures")
      .select("organization_id");
    expect(fromPlatform.error?.code).toBe("42501");
  });
});
