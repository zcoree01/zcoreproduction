import { beforeAll, describe, expect, it } from "vitest";
import { ensureOrganization } from "@/modules/organizations/provision";
import { setupFixture, type Fixture } from "./fixtures";

// Zcore organization roles (platform_admin = Administrator, platform_technician
// = Tehničar) and the granular platform permissions.

const PLATFORM_PERMISSIONS = [
  "platform.read",
  "platform.revenue.read",
  "platform.modules.manage",
  "platform.packages.assign",
  "platform.packages.manage",
  "platform.support",
  "platform.directory.approve",
  "platform.payments.record",
  "platform.payments.cancel",
  "platform.lock",
  "platform.settings.manage",
  "platform.organizations.archive",
  "platform.organizations.delete",
];

const TECHNICIAN_PERMISSIONS = [
  "platform.read",
  "platform.modules.manage",
  "platform.packages.assign",
  "platform.support",
  "platform.directory.approve",
  "platform.payments.record",
  "platform.lock",
];

let fx: Fixture;
let zcoreId = "";

async function permissionsOf(roleKey: string) {
  const role = await fx.service
    .from("roles")
    .select("id")
    .eq("organization_id", zcoreId)
    .eq("key", roleKey)
    .single();
  expect(role.error).toBeNull();
  const rows = await fx.service
    .from("role_permissions")
    .select("permission_key")
    .eq("role_id", role.data!.id);
  expect(rows.error).toBeNull();
  return (rows.data ?? []).map((r) => r.permission_key).sort();
}

beforeAll(async () => {
  fx = await setupFixture();
  zcoreId = (await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" })).id;
});

describe("Zcore platform roles", () => {
  it("gives the Zcore organization only Administrator and Tehničar as active system roles", async () => {
    const { data, error } = await fx.service
      .from("roles")
      .select("key, archived_at")
      .eq("organization_id", zcoreId)
      .eq("is_system", true);
    expect(error).toBeNull();
    const active = (data ?? []).filter((r) => r.archived_at === null).map((r) => r.key);
    expect(active.sort()).toEqual(["platform_admin", "platform_technician"]);
    const standard = (data ?? []).filter((r) => !r.key.startsWith("platform_"));
    expect(standard).toHaveLength(7);
    expect(standard.every((r) => r.archived_at !== null)).toBe(true);
  });

  it("grants the Tehničar the agreed platform permissions only", async () => {
    expect(await permissionsOf("platform_technician")).toEqual([...TECHNICIAN_PERMISSIONS].sort());
  });

  it("grants the Administrator every platform permission and Zcore user management", async () => {
    const keys = await permissionsOf("platform_admin");
    for (const key of [
      ...PLATFORM_PERMISSIONS,
      "users.read",
      "users.manage",
      "roles.manage",
      "audit.read",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("keeps platform.manage only on the Administrator during the transition", async () => {
    const admin = await permissionsOf("platform_admin");
    const technician = await permissionsOf("platform_technician");
    expect(admin).toContain("platform.manage");
    expect(technician).not.toContain("platform.manage");
  });

  it("moves existing Zcore members to Administrator", async () => {
    const { data, error } = await fx.service
      .from("memberships")
      .select("roles!inner(archived_at)")
      .eq("organization_id", zcoreId)
      .is("archived_at", null);
    expect(error).toBeNull();
    expect((data ?? []).every((m) => m.roles.archived_at === null)).toBe(true);
  });
});
