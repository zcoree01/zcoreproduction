import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TIMEZONE } from "./months";
import { setupFixture, type Fixture } from "./fixtures";

// Postavke → Organizacija (D-063): the time zone is one UPDATE through RLS
// (org.settings.manage), the column check rejects unknown zones and the row
// audit trigger records before / after. Test tenant A goes back to
// Europe/Sarajevo after the run (other DB tests count days in that zone).

let fx: Fixture;

async function restore() {
  await fx.service
    .from("organizations")
    .update({ timezone: TEST_TIMEZONE })
    .eq("id", fx.a.org.id)
    .throwOnError();
}

async function zoneOf(organizationId: string) {
  const { data } = await fx.service
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .single()
    .throwOnError();
  return data.timezone;
}

beforeAll(async () => {
  fx = await setupFixture();
  await restore();
}, 60_000);

afterAll(async () => {
  await restore();
});

describe("organization time zone", () => {
  it("lets the admin change it and records before / after in the audit log", async () => {
    const startedAt = new Date().toISOString();
    const { data, error } = await fx.a.admin
      .from("organizations")
      .update({ timezone: "Europe/London" })
      .eq("id", fx.a.org.id)
      .select("id, timezone");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: fx.a.org.id, timezone: "Europe/London" }]);

    const { data: audit } = await fx.service
      .from("audit_log")
      .select("actor_id, action, before, after")
      .eq("organization_id", fx.a.org.id)
      .eq("entity_type", "organizations")
      .gte("created_at", startedAt)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
      .throwOnError();
    expect(audit.actor_id).toBe(fx.a.adminId);
    expect(audit.action).toBe("organizations.update");
    expect((audit.before as { timezone: string }).timezone).toBe(TEST_TIMEZONE);
    expect((audit.after as { timezone: string }).timezone).toBe("Europe/London");
    await restore();
  });

  it("rejects a zone the database does not know", async () => {
    const { error } = await fx.a.admin
      .from("organizations")
      .update({ timezone: "Mars/Olympus" })
      .eq("id", fx.a.org.id);
    expect(error?.code).toBe("23514");
    expect(await zoneOf(fx.a.org.id)).toBe(TEST_TIMEZONE);
  });

  it("does not let a member without org.settings.manage change it", async () => {
    const { data, error } = await fx.a.operator
      .from("organizations")
      .update({ timezone: "Europe/Berlin" })
      .eq("id", fx.a.org.id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await zoneOf(fx.a.org.id)).toBe(TEST_TIMEZONE);
  });

  it("does not let another firm's admin change it", async () => {
    const { data } = await fx.b.admin
      .from("organizations")
      .update({ timezone: "Europe/Berlin" })
      .eq("id", fx.a.org.id)
      .select("id");
    expect(data ?? []).toEqual([]);
    expect(await zoneOf(fx.a.org.id)).toBe(TEST_TIMEZONE);
  });

  it("does not let the admin change other columns than name, timezone and settings", async () => {
    const { error } = await fx.a.admin
      .from("organizations")
      .update({ slug: "hijack-test" })
      .eq("id", fx.a.org.id);
    expect(error?.code).toBe("42501");
  });
});
