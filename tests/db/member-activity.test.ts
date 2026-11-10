import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";
import { localToday } from "./months";

// record_member_activity: one row per (firm, user, day); nothing for support
// accounts or the Zcore organization; no direct table access.

type Db = SupabaseClient<Database>;

let fx: Fixture;
let zcoreId = "";
let zcoreUserId = "";
let zcoreUser: Db;

async function rows(org: string, user: string) {
  const { data, error } = await fx.service
    .from("member_activity_days")
    .select("day")
    .eq("organization_id", org)
    .eq("user_id", user);
  expect(error).toBeNull();
  return data ?? [];
}

beforeAll(async () => {
  fx = await setupFixture();
  const zcore = await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" });
  zcoreId = zcore.id;
  zcoreUserId = await ensureUser(fx.service, zcore, {
    username: "db.activity.tech",
    password: testTenantPassword(),
    fullName: "db.activity.tech",
    role: "platform_technician",
  });
  await fx.service.from("memberships").update({ archived_at: null }).eq("user_id", zcoreUserId);
  zcoreUser = await signIn("db.activity.tech", "zcore");
});

afterAll(async () => {
  await fx.service.from("member_activity_days").delete().eq("user_id", fx.a.operatorId);
  await fx.service.from("member_activity_days").delete().eq("user_id", zcoreUserId);
  await fx.service.from("profiles").update({ is_support: false }).eq("id", fx.a.operatorId);
  await fx.service
    .from("memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", zcoreUserId);
});

describe("record_member_activity", () => {
  it("records one row per user and day", async () => {
    await fx.service.from("member_activity_days").delete().eq("user_id", fx.a.operatorId);
    for (let i = 0; i < 2; i += 1) {
      const { error } = await fx.a.operator.rpc("record_member_activity", { p_org: fx.a.org.id });
      expect(error).toBeNull();
    }
    const found = await rows(fx.a.org.id, fx.a.operatorId);
    expect(found).toHaveLength(1);
    expect(found[0]!.day).toBe(localToday());

    // Not a member of the other firm.
    const foreign = await fx.a.operator.rpc("record_member_activity", { p_org: fx.b.org.id });
    expect(foreign.error?.code).toBe("42501");

    // No direct access.
    const direct = await fx.a.operator.from("member_activity_days").select("day");
    expect(direct.data ?? []).toEqual([]);
    const insert = await fx.a.operator
      .from("member_activity_days")
      .insert({ organization_id: fx.a.org.id, user_id: fx.a.operatorId, day: "2020-01-01" });
    expect(insert.error).not.toBeNull();
  });

  it("ignores support accounts and the Zcore organization", async () => {
    await fx.service.from("member_activity_days").delete().eq("user_id", fx.a.operatorId);
    await fx.service.from("profiles").update({ is_support: true }).eq("id", fx.a.operatorId);
    const support = await fx.a.operator.rpc("record_member_activity", { p_org: fx.a.org.id });
    expect(support.error).toBeNull();
    expect(await rows(fx.a.org.id, fx.a.operatorId)).toHaveLength(0);
    await fx.service.from("profiles").update({ is_support: false }).eq("id", fx.a.operatorId);

    const zcore = await zcoreUser.rpc("record_member_activity", { p_org: zcoreId });
    expect(zcore.error).toBeNull();
    expect(await rows(zcoreId, zcoreUserId)).toHaveLength(0);
  });
});
