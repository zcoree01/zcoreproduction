import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// No privilege escalation (D-053): a member with users.manage / roles.manage
// through a custom role may assign, manage and edit only roles whose every
// permission they hold. The system admin role stays unlimited. Tenant A, roles
// "DBE …" and users "dbe.manager" / "dbe.member" (kept between runs).

let fx: Fixture;
let manager: SupabaseClient<Database>;
let managerId = "";
let memberId = "";
type RoleName =
  "admin" | "quality_inspector" | "operator" | "manager" | "reader" | "reader2" | "stronger";
const roles = {} as Record<RoleName, string>;

const MANAGER_PERMISSIONS = ["users.read", "users.manage", "roles.manage", "orders.read"];

/** Custom role with exactly these permissions (created once, reset each run). */
async function ensureRole(name: string, permissions: string[]) {
  const orgId = fx.a.org.id;
  const existing = await fx.service
    .from("roles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", name)
    .is("archived_at", null)
    .maybeSingle()
    .throwOnError();
  const id =
    existing.data?.id ??
    (
      await fx.service
        .from("roles")
        .insert({
          organization_id: orgId,
          key: `custom_${randomBytes(8).toString("hex")}`,
          name,
          is_system: false,
        })
        .select("id")
        .single()
        .throwOnError()
    ).data.id;
  await fx.service.from("role_permissions").delete().eq("role_id", id).throwOnError();
  await fx.service
    .from("role_permissions")
    .insert(
      permissions.map((key) => ({ organization_id: orgId, role_id: id, permission_key: key })),
    )
    .throwOnError();
  return id;
}

async function setRole(userId: string, roleId: string) {
  await fx.service
    .from("memberships")
    .update({ role_id: roleId, archived_at: null })
    .eq("organization_id", fx.a.org.id)
    .eq("user_id", userId)
    .throwOnError();
}

beforeAll(async () => {
  fx = await setupFixture();
  const system = await fx.service
    .from("roles")
    .select("id, key")
    .eq("organization_id", fx.a.org.id)
    .in("key", ["admin", "quality_inspector", "operator"])
    .throwOnError();
  for (const role of system.data) roles[role.key as RoleName] = role.id;
  roles.manager = await ensureRole("DBE Upravitelj", MANAGER_PERMISSIONS);
  roles.reader = await ensureRole("DBE Čitač", ["orders.read"]);
  roles.reader2 = await ensureRole("DBE Čitač 2", ["orders.read", "users.read"]);
  roles.stronger = await ensureRole("DBE Jača", ["orders.read", "audit.read"]);

  const password = testTenantPassword();
  managerId = await ensureUser(fx.service, fx.a.org, {
    username: "dbe.manager",
    password,
    fullName: "DBE Upravitelj",
    role: "operator",
  });
  memberId = await ensureUser(fx.service, fx.a.org, {
    username: "dbe.member",
    password,
    fullName: "DBE Član",
    role: "operator",
  });
  await setRole(managerId, roles.manager);
  await setRole(memberId, roles.reader);
  manager = await signIn("dbe.manager", fx.a.org.slug);
}, 60_000);

afterAll(async () => {
  await setRole(memberId, roles.reader);
});

describe("custom role managers stay within their own permissions", () => {
  it("assigns only roles they could hold themselves", async () => {
    const assignable = async (roleId: string) =>
      (await manager.rpc("can_assign_role", { p_org_id: fx.a.org.id, p_role_id: roleId })).data;
    expect(await assignable(roles.reader)).toBe(true);
    expect(await assignable(roles.manager)).toBe(true);
    expect(await assignable(roles.admin)).toBe(false);
    expect(await assignable(roles.stronger)).toBe(false);

    const toAdmin = await manager.rpc("update_member", {
      p_org_id: fx.a.org.id,
      p_user_id: memberId,
      p_full_name: "DBE Član",
      p_role_id: roles.admin,
    });
    expect(toAdmin.error?.message).toBe("role_above_caller");
    const allowed = await manager.rpc("update_member", {
      p_org_id: fx.a.org.id,
      p_user_id: memberId,
      p_full_name: "DBE Član",
      p_role_id: roles.reader2,
    });
    expect(allowed.error).toBeNull();
  });

  it("cannot manage a member whose role is stronger", async () => {
    const orgId = fx.a.org.id;
    const rename = await manager.rpc("update_member", {
      p_org_id: orgId,
      p_user_id: fx.a.adminId,
      p_full_name: "Preuzet",
      p_role_id: roles.reader,
    });
    expect(rename.error?.message).toBe("role_above_caller");
    const deactivate = await manager.rpc("set_member_active", {
      p_org_id: orgId,
      p_user_id: fx.a.adminId,
      p_active: false,
    });
    expect(deactivate.error?.message).toBe("role_above_caller");
    // The password reset action asks this before touching the account.
    const reset = await manager.rpc("assert_member_manageable", {
      p_org_id: orgId,
      p_user_id: fx.a.adminId,
    });
    expect(reset.error?.message).toBe("role_above_caller");
    expect(
      (await manager.rpc("assert_member_manageable", { p_org_id: orgId, p_user_id: memberId }))
        .error,
    ).toBeNull();
    // Nothing changed on the admin.
    const admin = await fx.service
      .from("memberships")
      .select("role_id, archived_at")
      .eq("organization_id", orgId)
      .eq("user_id", fx.a.adminId)
      .single();
    expect(admin.data).toEqual({ role_id: roles.admin, archived_at: null });
  });

  it("grants and edits only permissions they hold", async () => {
    const orgId = fx.a.org.id;
    const grantMore = await manager.rpc("save_custom_role", {
      p_org_id: orgId,
      p_role_id: roles.manager,
      p_name: "DBE Upravitelj",
      p_permissions: [...MANAGER_PERMISSIONS, "audit.read"],
    });
    expect(grantMore.error?.message).toBe("role_above_caller");
    const editStronger = await manager.rpc("save_custom_role", {
      p_org_id: orgId,
      p_role_id: roles.stronger,
      p_name: "DBE Jača",
      p_permissions: ["orders.read"],
    });
    expect(editStronger.error?.message).toBe("role_above_caller");
    const archiveStronger = await manager.rpc("archive_custom_role", {
      p_org_id: orgId,
      p_role_id: roles.stronger,
    });
    expect(archiveStronger.error?.message).toBe("role_above_caller");
    const within = await manager.rpc("save_custom_role", {
      p_org_id: orgId,
      p_role_id: roles.reader2,
      p_name: "DBE Čitač 2",
      p_permissions: ["orders.read", "users.read"],
    });
    expect(within.error).toBeNull();
  });

  it("cannot write memberships, roles or role permissions directly", async () => {
    const orgId = fx.a.org.id;
    // PostgREST past the RPCs: no grant, no row changed.
    const selfAdmin = await manager
      .from("memberships")
      .update({ role_id: roles.admin })
      .eq("organization_id", orgId)
      .eq("user_id", memberId);
    expect(selfAdmin.error?.code).toBe("42501");
    const grant = await manager
      .from("role_permissions")
      .insert({ organization_id: orgId, role_id: roles.manager, permission_key: "audit.read" });
    expect(grant.error?.code).toBe("42501");
    const rename = await manager.from("roles").update({ name: "X" }).eq("id", roles.stronger);
    expect(rename.error?.code).toBe("42501");
    const member = await fx.service
      .from("memberships")
      .select("role_id")
      .eq("organization_id", orgId)
      .eq("user_id", memberId)
      .single();
    expect(member.data?.role_id).not.toBe(roles.admin);
  });

  it("leaves the system admin unlimited", async () => {
    // The admin role lacks quality.inspect by design and still assigns it.
    const assignable = await fx.a.admin.rpc("can_assign_role", {
      p_org_id: fx.a.org.id,
      p_role_id: roles.quality_inspector,
    });
    expect(assignable.data).toBe(true);
    const changed = await fx.a.admin.rpc("update_member", {
      p_org_id: fx.a.org.id,
      p_user_id: memberId,
      p_full_name: "DBE Član",
      p_role_id: roles.quality_inspector,
    });
    expect(changed.error).toBeNull();
    const stronger = await fx.a.admin.rpc("save_custom_role", {
      p_org_id: fx.a.org.id,
      p_role_id: roles.stronger,
      p_name: "DBE Jača",
      p_permissions: ["orders.read", "audit.read"],
    });
    expect(stronger.error).toBeNull();
  });

  it("refuses can_assign_role without users.manage", async () => {
    const operator = await fx.a.operator.rpc("can_assign_role", {
      p_org_id: fx.a.org.id,
      p_role_id: roles.reader,
    });
    expect(operator.data).toBe(false);
  });
});
