import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, type Fixture } from "./fixtures";

// User management (D-044): the admin edits another member's full name and
// role, deactivates and reactivates them (audit entries), never themself;
// operators and other tenants cannot. Uses its own account "clan.test".

let fx: Fixture;
let memberId = "";
const roles: Record<string, string> = {};

async function resetMember() {
  await fx.service
    .from("memberships")
    .update({ role_id: roles.operator, archived_at: null })
    .eq("user_id", memberId)
    .throwOnError();
  await fx.service
    .from("profiles")
    .update({ full_name: "Član Test" })
    .eq("id", memberId)
    .throwOnError();
}

beforeAll(async () => {
  fx = await setupFixture();
  memberId = await ensureUser(fx.service, fx.a.org, {
    username: "clan.test",
    password: testTenantPassword(),
    fullName: "Član Test",
    role: "operator",
  });
  const { data } = await fx.service
    .from("roles")
    .select("id, key")
    .eq("organization_id", fx.a.org.id)
    .in("key", ["operator", "warehouse", "admin"])
    .throwOnError();
  for (const role of data) roles[role.key] = role.id;
  await resetMember();
}, 60_000);

afterAll(async () => {
  await resetMember();
});

describe("member management", () => {
  it("edits the full name and role of another member", async () => {
    const { error } = await fx.a.admin.rpc("update_member", {
      p_org_id: fx.a.org.id,
      p_user_id: memberId,
      p_full_name: "  Član Magacioner ",
      p_role_id: roles.warehouse!,
    });
    expect(error).toBeNull();
    const row = await fx.a.admin
      .from("member_directory")
      .select("full_name, role_key")
      .eq("user_id", memberId)
      .single();
    expect(row.data).toEqual({ full_name: "Član Magacioner", role_key: "warehouse" });
    const audit = await fx.service
      .from("audit_log")
      .select("action, before, after")
      .eq("entity_id", memberId)
      .eq("action", "users.update")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(audit.data).toMatchObject({
      before: { full_name: "Član Test", role_id: roles.operator },
      after: { full_name: "Član Magacioner", role_id: roles.warehouse },
    });
  });

  it("deactivates and reactivates; the member is out while inactive", async () => {
    const off = await fx.a.admin.rpc("set_member_active", {
      p_org_id: fx.a.org.id,
      p_user_id: memberId,
      p_active: false,
    });
    expect(off.error).toBeNull();
    const directory = await fx.a.admin
      .from("member_directory")
      .select("is_active")
      .eq("user_id", memberId)
      .single();
    expect(directory.data?.is_active).toBe(false);
    // Repeating is harmless.
    expect(
      (
        await fx.a.admin.rpc("set_member_active", {
          p_org_id: fx.a.org.id,
          p_user_id: memberId,
          p_active: false,
        })
      ).error,
    ).toBeNull();

    const on = await fx.a.admin.rpc("set_member_active", {
      p_org_id: fx.a.org.id,
      p_user_id: memberId,
      p_active: true,
    });
    expect(on.error).toBeNull();
    const actions = await fx.service
      .from("audit_log")
      .select("action")
      .eq("entity_id", memberId)
      .in("action", ["users.deactivate", "users.reactivate"])
      .order("created_at", { ascending: false })
      .limit(2);
    expect(actions.data?.map((a) => a.action)).toEqual(["users.reactivate", "users.deactivate"]);
  });

  it("refuses oneself, unknown roles, operators and other tenants", async () => {
    const self = await fx.a.admin.rpc("set_member_active", {
      p_org_id: fx.a.org.id,
      p_user_id: fx.a.adminId,
      p_active: false,
    });
    expect(self.error?.message).toBe("self");
    const role = await fx.a.admin.rpc("update_member", {
      p_org_id: fx.a.org.id,
      p_user_id: memberId,
      p_full_name: "Član",
      p_role_id: crypto.randomUUID(),
    });
    expect(role.error?.message).toBe("role_not_found");
    const operator = await fx.a.operator.rpc("update_member", {
      p_org_id: fx.a.org.id,
      p_user_id: memberId,
      p_full_name: "Član",
      p_role_id: roles.admin!,
    });
    expect(operator.error?.code).toBe("42501");
    const foreign = await fx.b.admin.rpc("set_member_active", {
      p_org_id: fx.b.org.id,
      p_user_id: memberId,
      p_active: false,
    });
    expect(foreign.error?.code).toBe("P0002");
  });
});
