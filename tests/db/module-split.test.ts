import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupFixture, type Fixture } from "./fixtures";

// D-049: the four modules are split into ten. Firms keep everything they had
// (production → planning, reports; inventory → finished_goods, tools;
// attendance → kiosk, payroll) and the database checks the narrower key.

let fx: Fixture;

beforeAll(async () => {
  fx = await setupFixture();
});

async function moduleRow(organizationId: string, key: string) {
  const { data, error } = await fx.service
    .from("org_modules")
    .select("enabled, active_until")
    .eq("organization_id", organizationId)
    .eq("module_key", key)
    .maybeSingle();
  if (error) throw error;
  return data;
}

describe("module split", () => {
  afterEach(async () => {
    await fx.service
      .from("org_modules")
      .update({ enabled: true })
      .eq("organization_id", fx.a.org.id)
      .in("module_key", ["finished_goods", "tools"]);
    await fx.service.from("tools").delete().eq("organization_id", fx.a.org.id).eq("code", "DMS-1");
  });

  it("lets a permission work only while its module is enabled", async () => {
    const seeded = await fx.service
      .from("tools")
      .insert({ organization_id: fx.a.org.id, code: "DMS-1", name: "DMS glodalo", kind: "tool" });
    expect(seeded.error).toBeNull();
    const read = () =>
      fx.a.admin
        .from("tools")
        .select("code")
        .eq("organization_id", fx.a.org.id)
        .eq("code", "DMS-1");

    expect((await read()).data).toHaveLength(1);
    await fx.service
      .from("org_modules")
      .update({ enabled: false })
      .eq("organization_id", fx.a.org.id)
      .eq("module_key", "tools");
    expect((await read()).data).toHaveLength(0);
  });

  it("gives every firm with production also planning and reports", async () => {
    const production = await moduleRow(fx.a.org.id, "production");
    expect(production?.enabled).toBe(true);
    for (const key of ["planning", "reports"]) {
      const row = await moduleRow(fx.a.org.id, key);
      expect(row, key).toMatchObject({
        enabled: true,
        active_until: production?.active_until ?? null,
      });
    }
  });

  it("moves reports.read to the reports module", async () => {
    const { data, error } = await fx.service
      .from("permissions")
      .select("module_key")
      .eq("key", "reports.read")
      .single();
    expect(error).toBeNull();
    expect(data?.module_key).toBe("reports");
  });

  it("refuses finished goods without finished_goods enabled", async () => {
    const off = await fx.service
      .from("org_modules")
      .update({ enabled: false })
      .eq("organization_id", fx.a.org.id)
      .eq("module_key", "finished_goods")
      .select("module_key");
    expect(off.data).toHaveLength(1);

    const { error } = await fx.a.admin.rpc("receive_finished_goods", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: randomUUID(),
      p_order_id: randomUUID(),
      p_quantity: 1,
    });
    // The permission itself lapses without its module (20261110101000).
    expect(error?.code).toBe("42501");
  });
});
