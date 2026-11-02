import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupFixture, type Fixture } from "./fixtures";

// Dashboard layouts (D-037): the admin saves an ordered widget list per role
// (dashboard.manage), the database checks its shape, members read their
// organization's layouts only, and the layout goes back to the default by
// deleting the row. Uses the quality_inspector role of test tenant A.

let fx: Fixture;
let roleA = "";
let roleB = "";

async function roleId(orgId: string, key: string): Promise<string> {
  const { data } = await fx.service
    .from("roles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("key", key)
    .single()
    .throwOnError();
  return data.id;
}

async function clear() {
  await fx.service.from("dashboard_layouts").delete().in("role_id", [roleA, roleB]);
}

beforeAll(async () => {
  fx = await setupFixture();
  roleA = await roleId(fx.a.org.id, "quality_inspector");
  roleB = await roleId(fx.b.org.id, "quality_inspector");
  await clear();
}, 60_000);

afterAll(async () => {
  await clear();
});

describe("dashboard layouts", () => {
  it("lets the admin save, replace and reset a role's layout", async () => {
    const widgets = [
      { key: "orders_due", size: "wide" },
      { key: "output_today", size: "normal" },
    ];
    const saved = await fx.a.admin.rpc("save_dashboard_layout", {
      p_org_id: fx.a.org.id,
      p_role_id: roleA,
      p_widgets: widgets,
    });
    expect(saved.error).toBeNull();
    const replaced = await fx.a.admin.rpc("save_dashboard_layout", {
      p_org_id: fx.a.org.id,
      p_role_id: roleA,
      p_widgets: [{ key: "scrap_reasons", size: "normal" }],
    });
    expect(replaced.error).toBeNull();

    // Every member of the organization reads it (the operator too).
    const read = await fx.a.operator
      .from("dashboard_layouts")
      .select("widgets")
      .eq("role_id", roleA)
      .single();
    expect(read.data?.widgets).toEqual([{ key: "scrap_reasons", size: "normal" }]);

    const audit = await fx.service
      .from("audit_log")
      .select("action")
      .eq("organization_id", fx.a.org.id)
      .eq("entity_type", "dashboard_layouts")
      .order("created_at", { ascending: false })
      .limit(2);
    expect(audit.data?.map((row) => row.action)).toEqual([
      "dashboard_layouts.update",
      "dashboard_layouts.insert",
    ]);

    const reset = await fx.a.admin.rpc("reset_dashboard_layout", {
      p_org_id: fx.a.org.id,
      p_role_id: roleA,
    });
    expect(reset.error).toBeNull();
    const gone = await fx.service.from("dashboard_layouts").select("id").eq("role_id", roleA);
    expect(gone.data).toEqual([]);
  });

  it("refuses badly shaped layouts", async () => {
    for (const widgets of [
      { key: "orders_due", size: "wide" },
      [{ key: "orders_due", size: "huge" }],
      [{ key: "Orders Due", size: "wide" }],
      [{ key: "orders_due", size: "wide", extra: 1 }],
      [
        { key: "orders_due", size: "wide" },
        { key: "orders_due", size: "normal" },
      ],
      ["orders_due"],
    ]) {
      const { error } = await fx.a.admin.rpc("save_dashboard_layout", {
        p_org_id: fx.a.org.id,
        p_role_id: roleA,
        p_widgets: widgets,
      });
      expect(error?.message).toBe("invalid_widgets");
    }
  });

  it("refuses members without dashboard.manage, other tenants and their roles", async () => {
    const widgets = [{ key: "orders_due", size: "wide" }];
    const operator = await fx.a.operator.rpc("save_dashboard_layout", {
      p_org_id: fx.a.org.id,
      p_role_id: roleA,
      p_widgets: widgets,
    });
    expect(operator.error?.code).toBe("42501");
    const operatorReset = await fx.a.operator.rpc("reset_dashboard_layout", {
      p_org_id: fx.a.org.id,
      p_role_id: roleA,
    });
    expect(operatorReset.error?.code).toBe("42501");

    // Another organization, and another organization's role in our own.
    const foreign = await fx.a.admin.rpc("save_dashboard_layout", {
      p_org_id: fx.b.org.id,
      p_role_id: roleB,
      p_widgets: widgets,
    });
    expect(foreign.error?.code).toBe("42501");
    const foreignRole = await fx.a.admin.rpc("save_dashboard_layout", {
      p_org_id: fx.a.org.id,
      p_role_id: roleB,
      p_widgets: widgets,
    });
    expect(foreignRole.error?.message).toBe("role_not_found");

    // No direct writes; tenant B's layouts are invisible to tenant A.
    const insert = await fx.a.admin
      .from("dashboard_layouts")
      .insert({ organization_id: fx.a.org.id, role_id: roleA, widgets });
    expect(insert.error).not.toBeNull();
    await fx.b.admin
      .rpc("save_dashboard_layout", { p_org_id: fx.b.org.id, p_role_id: roleB, p_widgets: widgets })
      .throwOnError();
    const crossRead = await fx.a.admin.from("dashboard_layouts").select("id").eq("role_id", roleB);
    expect(crossRead.data).toEqual([]);
  });
});
