import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupFixture, type Fixture } from "./fixtures";

// Role editor (D-046): custom roles with their permissions (create, change,
// archive when unused), system roles fixed, platform.manage never granted,
// roles.manage and tenant checks. Roles named "DBR …".

let fx: Fixture;

async function cleanup() {
  const { data } = await fx.service
    .from("roles")
    .select("id")
    .in("organization_id", [fx.a.org.id, fx.b.org.id])
    .like("name", "DBR %");
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) return;
  await fx.service.from("role_permissions").delete().in("role_id", ids);
  await fx.service.from("dashboard_layouts").delete().in("role_id", ids);
  await fx.service.from("roles").delete().in("id", ids);
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup();
}, 60_000);

afterAll(async () => {
  await cleanup();
});

const permissionsOf = async (roleId: string) =>
  (
    await fx.service
      .from("role_permissions")
      .select("permission_key")
      .eq("role_id", roleId)
      .order("permission_key")
      .throwOnError()
  ).data.map((row) => row.permission_key);

describe("custom roles", () => {
  it("creates, changes and archives a custom role", async () => {
    const created = await fx.a.admin.rpc("save_custom_role", {
      p_org_id: fx.a.org.id,
      p_role_id: null as unknown as string,
      p_name: " DBR Planer ",
      p_permissions: ["orders.read", "orders.manage", "orders.read"],
    });
    expect(created.error).toBeNull();
    const roleId = created.data!;
    expect(await permissionsOf(roleId)).toEqual(["orders.manage", "orders.read"]);
    const role = await fx.service
      .from("roles")
      .select("name, key, is_system")
      .eq("id", roleId)
      .single();
    expect(role.data).toMatchObject({ name: "DBR Planer", is_system: false });
    expect(role.data?.key).toMatch(/^custom_[0-9a-f]{16}$/);

    const changed = await fx.a.admin.rpc("save_custom_role", {
      p_org_id: fx.a.org.id,
      p_role_id: roleId,
      p_name: "DBR Planer 2",
      p_permissions: ["orders.read", "reports.read"],
    });
    expect(changed.error).toBeNull();
    expect(await permissionsOf(roleId)).toEqual(["orders.read", "reports.read"]);
    // Besides the row audit of roles, one entry names the permissions.
    const audit = await fx.service
      .from("audit_log")
      .select("before, after")
      .eq("entity_id", roleId)
      .eq("action", "roles.update")
      .not("after->permissions", "is", null)
      .single();
    expect(audit.data).toEqual({
      before: { name: "DBR Planer", permissions: ["orders.manage", "orders.read"] },
      after: { name: "DBR Planer 2", permissions: ["orders.read", "reports.read"] },
    });

    // In use: not archived; unused: archived.
    const member = await fx.service
      .from("memberships")
      .select("id, role_id")
      .eq("user_id", fx.a.operatorId)
      .single()
      .throwOnError();
    await fx.service
      .from("memberships")
      .update({ role_id: roleId })
      .eq("id", member.data.id)
      .throwOnError();
    try {
      const inUse = await fx.a.admin.rpc("archive_custom_role", {
        p_org_id: fx.a.org.id,
        p_role_id: roleId,
      });
      expect(inUse.error?.message).toBe("role_in_use");
    } finally {
      await fx.service
        .from("memberships")
        .update({ role_id: member.data.role_id })
        .eq("id", member.data.id)
        .throwOnError();
    }
    const archived = await fx.a.admin.rpc("archive_custom_role", {
      p_org_id: fx.a.org.id,
      p_role_id: roleId,
    });
    expect(archived.error).toBeNull();
  });

  it("keeps system roles fixed and never grants platform.manage", async () => {
    const admin = await fx.service
      .from("roles")
      .select("id")
      .eq("organization_id", fx.a.org.id)
      .eq("key", "admin")
      .single()
      .throwOnError();
    const system = await fx.a.admin.rpc("save_custom_role", {
      p_org_id: fx.a.org.id,
      p_role_id: admin.data.id,
      p_name: "Administrator",
      p_permissions: [],
    });
    expect(system.error?.message).toBe("system_role");
    const platform = await fx.a.admin.rpc("save_custom_role", {
      p_org_id: fx.a.org.id,
      p_role_id: null as unknown as string,
      p_name: "DBR Platforma",
      p_permissions: ["platform.manage"],
    });
    expect(platform.error?.message).toBe("invalid_permission");
    const taken = await fx.a.admin.rpc("save_custom_role", {
      p_org_id: fx.a.org.id,
      p_role_id: null as unknown as string,
      p_name: "administrator",
      p_permissions: [],
    });
    expect(taken.error?.message).toBe("name_taken");
  });

  it("needs roles.manage in the own organization", async () => {
    const operator = await fx.a.operator.rpc("save_custom_role", {
      p_org_id: fx.a.org.id,
      p_role_id: null as unknown as string,
      p_name: "DBR Operater",
      p_permissions: [],
    });
    expect(operator.error?.code).toBe("42501");
    const foreign = await fx.b.admin.rpc("save_custom_role", {
      p_org_id: fx.a.org.id,
      p_role_id: null as unknown as string,
      p_name: "DBR Strani",
      p_permissions: [],
    });
    expect(foreign.error?.code).toBe("42501");
  });
});
