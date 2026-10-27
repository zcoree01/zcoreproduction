import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "@/lib/auth/permissions";
import type { Database } from "@/lib/supabase/types";
import { setupFixture, type Fixture } from "./fixtures";

// The typed query builder cannot express a loop over table names, so the
// generic per-table checks use an untyped view of the same authenticated client.
function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

// Every tenant-scoped table and the column that carries the tenant id.
const TENANT_TABLES = [
  { table: "organizations", orgColumn: "id" },
  { table: "roles", orgColumn: "organization_id" },
  { table: "role_permissions", orgColumn: "organization_id" },
  { table: "profiles", orgColumn: "organization_id" },
  { table: "memberships", orgColumn: "organization_id" },
  { table: "audit_log", orgColumn: "organization_id" },
  { table: "org_modules", orgColumn: "organization_id" },
  { table: "member_directory", orgColumn: "organization_id" },
] as const;

let fx: Fixture;

beforeAll(async () => {
  fx = await setupFixture();
});

describe("tenant isolation: reads", () => {
  it.each(TENANT_TABLES)(
    "admin A sees only tenant A rows in $table",
    async ({ table, orgColumn }) => {
      const { data, error } = await untyped(fx.a.admin).from(table).select(orgColumn);
      expect(error).toBeNull();
      const orgIds = new Set((data ?? []).map((row: Record<string, string>) => row[orgColumn]));
      expect(orgIds).toEqual(new Set([fx.a.org.id]));
    },
  );

  it.each(TENANT_TABLES)(
    "admin A gets nothing when filtering $table by tenant B",
    async ({ table, orgColumn }) => {
      const { data, error } = await untyped(fx.a.admin)
        .from(table)
        .select(orgColumn)
        .eq(orgColumn, fx.b.org.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    },
  );

  it("the same tables do contain tenant B rows (the filter is RLS, not missing data)", async () => {
    for (const { table, orgColumn } of TENANT_TABLES) {
      const { count, error } = await untyped(fx.service)
        .from(table)
        .select(orgColumn, { count: "exact", head: true })
        .eq(orgColumn, fx.b.org.id);
      expect(error, table).toBeNull();
      expect(count, table).toBeGreaterThan(0);
    }
  });

  it("admin A cannot read tenant B's profile by id", async () => {
    const { data } = await fx.a.admin.from("profiles").select("id").eq("id", fx.b.adminId);
    expect(data).toEqual([]);
  });

  it("anonymous users can read nothing", async () => {
    for (const { table, orgColumn } of TENANT_TABLES) {
      const { data, error } = await untyped(fx.anon).from(table).select(orgColumn);
      // Either privilege error (anon has no grants) or an empty result.
      expect(error !== null || (data ?? []).length === 0, table).toBe(true);
    }
  });
});

describe("tenant isolation: writes", () => {
  it("admin A cannot update tenant B's organization", async () => {
    const { data, error } = await fx.a.admin
      .from("organizations")
      .update({ name: "hacked" })
      .eq("id", fx.b.org.id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const check = await fx.service
      .from("organizations")
      .select("name")
      .eq("id", fx.b.org.id)
      .single();
    expect(check.data?.name).toBe("Test Tenant B");
  });

  it("admin A cannot deactivate tenant B's members", async () => {
    const { data } = await fx.a.admin
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", fx.b.operatorId)
      .select("id");
    expect(data).toEqual([]);
  });

  it("admin A cannot give own member a role that belongs to tenant B", async () => {
    const roleB = await fx.service
      .from("roles")
      .select("id")
      .eq("organization_id", fx.b.org.id)
      .eq("key", "admin")
      .single();
    expect(roleB.error).toBeNull();

    const { error } = await fx.a.admin
      .from("memberships")
      .update({ role_id: roleB.data!.id })
      .eq("user_id", fx.a.operatorId)
      .select("id");
    // Composite FK (organization_id, role_id) rejects a cross-tenant role.
    expect(error?.code).toBe("23503");
  });

  it("admin A cannot create roles in tenant B", async () => {
    const { error } = await fx.a.admin
      .from("roles")
      .insert({ organization_id: fx.b.org.id, key: "intruder", name: "Intruder" });
    expect(error?.code).toBe("42501");
  });

  it("admin A cannot attach permissions to tenant B's roles", async () => {
    const roleB = await fx.service
      .from("roles")
      .select("id")
      .eq("organization_id", fx.b.org.id)
      .eq("key", "operator")
      .single();
    const { error } = await fx.a.admin.from("role_permissions").insert({
      organization_id: fx.b.org.id,
      role_id: roleB.data!.id,
      permission_key: "users.manage",
    });
    expect(error?.code).toBe("42501");
  });

  it("admin A cannot write audit entries into tenant B", async () => {
    const { error } = await fx.a.admin.rpc("write_audit", {
      p_org_id: fx.b.org.id,
      p_action: "test.cross_tenant",
      p_entity_type: "test",
    });
    expect(error?.code).toBe("42501");
  });

  it("tenants cannot toggle their own modules (commercial activation is service-only)", async () => {
    const { error } = await fx.a.admin
      .from("org_modules")
      .update({ enabled: false })
      .eq("organization_id", fx.a.org.id)
      .select("module_key");
    expect(error?.code).toBe("42501");
  });
});

describe("permissions", () => {
  it("has_permission is scoped to the organization", async () => {
    const own = await fx.a.admin.rpc("has_permission", {
      p_org_id: fx.a.org.id,
      p_permission: "users.manage",
    });
    const other = await fx.a.admin.rpc("has_permission", {
      p_org_id: fx.b.org.id,
      p_permission: "users.manage",
    });
    expect(own.data).toBe(true);
    expect(other.data).toBe(false);
  });

  it("operator lacks audit.read and sees no audit rows; admin sees them", async () => {
    const perm = await fx.a.operator.rpc("has_permission", {
      p_org_id: fx.a.org.id,
      p_permission: "audit.read",
    });
    expect(perm.data).toBe(false);

    const asOperator = await fx.a.operator.from("audit_log").select("id");
    expect(asOperator.data).toEqual([]);

    const asAdmin = await fx.a.admin.from("audit_log").select("id").limit(1);
    expect(asAdmin.data?.length).toBe(1);
  });

  it("admin cannot change their own membership (no self-lockout)", async () => {
    const { data } = await fx.a.admin
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", fx.a.adminId)
      .select("id");
    expect(data).toEqual([]);
  });

  it("permissions of system roles cannot be removed by tenants", async () => {
    const { data } = await fx.a.admin
      .from("role_permissions")
      .delete()
      .eq("organization_id", fx.a.org.id)
      .eq("permission_key", "roles.manage")
      .select("role_id");
    expect(data).toEqual([]);
  });

  it("the TypeScript permission list matches the database catalog", async () => {
    const { data, error } = await fx.a.admin.from("permissions").select("key");
    expect(error).toBeNull();
    expect((data ?? []).map((p) => p.key).sort()).toEqual([...PERMISSION_KEYS].sort());
  });
});

describe("integrity guarantees", () => {
  it("audit_log is append-only, even for the service role", async () => {
    const { error } = await fx.service
      .from("audit_log")
      .update({ action: "tampered" })
      .eq("organization_id", fx.a.org.id);
    expect(error?.message).toContain("append-only");
  });

  it("auth users must use the synthetic e-mail of their organization", async () => {
    const { error } = await fx.service.auth.admin.createUser({
      email: "intruder@test-tenant-b.users.zcore.ba",
      password: "Whatever-12345",
      email_confirm: true,
      app_metadata: { organization_id: fx.a.org.id, username: "intruder", role: "admin" },
    });
    expect(error).not.toBeNull();

    const leaked = await fx.service.from("profiles").select("id").eq("username", "intruder");
    expect(leaked.data).toEqual([]);

    // The whole createUser transaction must roll back: no orphan auth user.
    const users = await fx.service.auth.admin.listUsers({ perPage: 1000 });
    expect(users.error).toBeNull();
    expect(users.data.users.map((u) => u.email)).not.toContain(
      "intruder@test-tenant-b.users.zcore.ba",
    );
  });

  it("every organization has the seven system roles", async () => {
    const { data } = await fx.a.admin.from("roles").select("key").eq("is_system", true);
    expect((data ?? []).map((r) => r.key).sort()).toEqual(
      [
        "admin",
        "director",
        "head_of_production",
        "hr",
        "operator",
        "quality_inspector",
        "warehouse",
      ].sort(),
    );
  });
});
