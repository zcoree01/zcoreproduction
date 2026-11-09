import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nullableParam, numericParam } from "@/lib/supabase/numeric";
import type { Database } from "@/lib/supabase/types";
import {
  ensureModuleEnabled,
  ensureOrganization,
  ensureUser,
} from "@/modules/organizations/provision";
import { SELLABLE_MODULES } from "@/modules/platform/modules";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

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

type Db = SupabaseClient<Database>;

let fx: Fixture;
let zcoreId = "";
let admin: Db;
let tech: Db;
const memberIds: string[] = [];

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
  const zcore = await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" });
  zcoreId = zcore.id;
  for (const [username, role] of [
    ["db.platform.admin", "platform_admin"],
    ["db.platform.tech", "platform_technician"],
  ] as const) {
    const id = await ensureUser(fx.service, zcore, {
      username,
      password: testTenantPassword(),
      fullName: username,
      role,
    });
    await fx.service.from("memberships").update({ archived_at: null }).eq("user_id", id);
    memberIds.push(id);
  }
  admin = await signIn("db.platform.admin", "zcore");
  tech = await signIn("db.platform.tech", "zcore");
});

async function cleanupB() {
  const b = fx.b.org.id;
  await fx.service.from("organization_packages").delete().eq("organization_id", b);
  const packages = await fx.service.from("billing_packages").select("id").like("name", "DBR%");
  const ids = (packages.data ?? []).map((row) => row.id);
  if (ids.length > 0) {
    await fx.service.from("organization_packages").delete().in("package_id", ids);
    await fx.service.from("billing_package_modules").delete().in("package_id", ids);
    await fx.service.from("billing_package_prices").delete().in("package_id", ids);
    await fx.service.from("billing_packages").delete().in("id", ids);
  }
  await fx.service.from("organization_billing").delete().eq("organization_id", b);
  for (const key of ["core", ...SELLABLE_MODULES]) {
    await ensureModuleEnabled(fx.service, fx.b.org, key);
  }
  await fx.service
    .from("org_modules")
    .update({ enabled: true, active_until: null })
    .eq("organization_id", b)
    .in("module_key", ["core", ...SELLABLE_MODULES]);
}

afterAll(async () => {
  await cleanupB();
  for (const id of memberIds) {
    await fx.service
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", id);
  }
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

describe("platform RPC permissions", () => {
  it("lets the Tehničar change modules, assign a package, lock and unlock", async () => {
    const created = await admin.rpc("platform_save_package", {
      p_id: nullableParam<string>(null),
      p_name: `DBR ${crypto.randomUUID().slice(0, 8)}`,
      p_monthly_price: numericParam("100"),
      p_modules: ["production"],
    });
    expect(created.error).toBeNull();
    try {
      const b = fx.b.org.id;
      const moduleSet = await tech.rpc("platform_set_module", {
        p_org_id: b,
        p_module: SELLABLE_MODULES[0]!,
        p_enabled: true,
        p_active_until: nullableParam<string>(null),
      });
      expect(moduleSet.error).toBeNull();
      const assigned = await tech.rpc("platform_assign_package", {
        p_org_id: b,
        p_package_id: created.data!,
      });
      expect(assigned.error).toBeNull();
      const locked = await tech.rpc("platform_set_lock", {
        p_org_id: b,
        p_locked: true,
        p_reason: "DBR provjera",
      });
      expect(locked.error).toBeNull();
      const unlocked = await tech.rpc("platform_set_lock", {
        p_org_id: b,
        p_locked: false,
        p_reason: nullableParam<string>(null),
      });
      expect(unlocked.error).toBeNull();
    } finally {
      await cleanupB();
    }
  });

  it("refuses the Tehničar packages, platform settings and trial days", async () => {
    const pkg = await tech.rpc("platform_save_package", {
      p_id: nullableParam<string>(null),
      p_name: `DBR ${crypto.randomUUID().slice(0, 8)}`,
      p_monthly_price: numericParam("100"),
      p_modules: ["production"],
    });
    expect(pkg.error?.code).toBe("42501");
    const settings = await tech.rpc("platform_save_billing_settings", {
      p_grace_days: 5,
      p_warning_days: 3,
      p_contact: "DBR",
    });
    expect(settings.error?.code).toBe("42501");
    const trial = await tech.rpc("platform_set_trial_days", { p_days: 14 });
    expect(trial.error?.code).toBe("42501");
  });
});
