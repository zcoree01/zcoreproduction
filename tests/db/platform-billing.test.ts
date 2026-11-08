import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

// Packages, monthly payments and the computed lock state (D-049). Tenant B is
// the billed firm; every run starts it without billing and ends it with all
// modules enabled again. Packages use the DBB prefix.

type Db = SupabaseClient<Database>;
const PLATFORM_USER = "db.platform";

let fx: Fixture;
let platform: Db;
let platformUserId = "";
let platformOrgId = "";

const firstOfMonth = (monthsAgo: number) => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  return d.toISOString().slice(0, 10);
};

async function resetBilling() {
  const b = fx.b.org.id;
  await fx.service.from("billing_payments").delete().eq("organization_id", b);
  await fx.service.from("organization_packages").delete().eq("organization_id", b);
  await fx.service.from("organization_billing").delete().eq("organization_id", b);
  const packages = await fx.service.from("billing_packages").select("id").like("name", "DBB%");
  const ids = (packages.data ?? []).map((row) => row.id);
  if (ids.length > 0) {
    await fx.service.from("organization_packages").delete().in("package_id", ids);
    await fx.service.from("billing_package_modules").delete().in("package_id", ids);
    await fx.service.from("billing_package_prices").delete().in("package_id", ids);
    await fx.service.from("billing_packages").delete().in("id", ids);
  }
  for (const key of ["core", ...SELLABLE_MODULES]) {
    await ensureModuleEnabled(fx.service, fx.b.org, key);
  }
  await fx.service
    .from("org_modules")
    .update({ enabled: true, active_until: null })
    .eq("organization_id", b)
    .in("module_key", ["core", ...SELLABLE_MODULES]);
}

/** A package priced from the given months, assigned to tenant B from `from`. */
async function billB(prices: { from: string; price: string }[], from: string) {
  const created = await platform.rpc("platform_save_package", {
    p_id: nullableParam<string>(null),
    p_name: `DBB ${crypto.randomUUID().slice(0, 8)}`,
    p_monthly_price: numericParam(prices[0]!.price),
    p_modules: ["production"],
  });
  expect(created.error).toBeNull();
  const packageId = created.data!;
  // Price history and the start month are set directly: the RPCs date them today.
  await fx.service.from("billing_package_prices").delete().eq("package_id", packageId);
  const priced = await fx.service.from("billing_package_prices").insert(
    prices.map((p) => ({
      package_id: packageId,
      valid_from: p.from,
      monthly_price: numericParam(p.price),
    })),
  );
  expect(priced.error).toBeNull();
  const assigned = await fx.service
    .from("organization_packages")
    .insert({ organization_id: fx.b.org.id, valid_from: from, package_id: packageId });
  expect(assigned.error).toBeNull();
  return packageId;
}

type Month = { period: string; amount: string | number; due_on: string; paid_on: string | null };

async function billing() {
  const { data, error } = await platform.rpc("platform_organization_billing", {
    p_org_id: fx.b.org.id,
  });
  expect(error).toBeNull();
  return data as unknown as { state: string; reason: string | null; months: Month[] };
}

beforeAll(async () => {
  fx = await setupFixture();
  const zcore = await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" });
  platformOrgId = zcore.id;
  platformUserId = await ensureUser(fx.service, zcore, {
    username: PLATFORM_USER,
    password: testTenantPassword(),
    fullName: "DB Platform",
    role: "admin",
  });
  await fx.service.from("memberships").update({ archived_at: null }).eq("user_id", platformUserId);
  platform = await signIn(PLATFORM_USER, "zcore");
});

beforeEach(resetBilling);

afterAll(async () => {
  await resetBilling();
  await fx.service
    .from("memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", platformUserId);
});

describe("billing months", () => {
  it("computes due dates in the organization's timezone", async () => {
    await billB([{ from: "2026-09-01", price: "120" }], "2026-10-01");
    const october = (await billing()).months.find((m) => m.period === "2026-10-01");
    expect(october?.due_on).toBe("2026-11-15");
  });

  it("keeps the amount of earlier months when the price changes", async () => {
    await billB(
      [
        { from: "2026-09-01", price: "120" },
        { from: "2026-11-01", price: "150" },
      ],
      "2026-09-01",
    );
    const months = (await billing()).months;
    const amount = (period: string) => Number(months.find((m) => m.period === period)?.amount);
    expect(amount("2026-09-01")).toBe(120);
    expect(amount("2026-10-01")).toBe(120);
    expect(amount("2026-11-01")).toBe(150);
  });
});

describe("lock state", () => {
  it("locks after the due date and unlocks when paid", async () => {
    await billB([{ from: "2026-01-01", price: "100" }], firstOfMonth(2));
    const grace = await platform.rpc("platform_set_org_billing", {
      p_org_id: fx.b.org.id,
      p_grace_days: 0,
      p_auto_lock: true,
    });
    expect(grace.error).toBeNull();
    expect(await billing()).toMatchObject({ state: "locked", reason: "unpaid" });

    for (const period of [firstOfMonth(2), firstOfMonth(1)]) {
      const paid = await platform.rpc("platform_set_payment", {
        p_org_id: fx.b.org.id,
        p_period: period,
        p_paid: true,
        p_paid_on: firstOfMonth(0),
        p_note: "DBB uplata",
      });
      expect(paid.error).toBeNull();
    }
    expect(["active", "warning"]).toContain((await billing()).state);
  });

  it("does not lock with auto_lock off or unlocked_until in the future", async () => {
    await billB([{ from: "2026-01-01", price: "100" }], firstOfMonth(2));
    await platform.rpc("platform_set_org_billing", {
      p_org_id: fx.b.org.id,
      p_grace_days: 0,
      p_auto_lock: false,
    });
    expect((await billing()).state).toBe("overdue");

    await platform.rpc("platform_set_org_billing", {
      p_org_id: fx.b.org.id,
      p_grace_days: 0,
      p_auto_lock: true,
    });
    const until = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const unlocked = await platform.rpc("platform_unlock_until", {
      p_org_id: fx.b.org.id,
      p_until: until,
    });
    expect(unlocked.error).toBeNull();
    expect((await billing()).state).toBe("overdue");
  });

  it("locks manually with a reason", async () => {
    const noReason = await platform.rpc("platform_set_lock", {
      p_org_id: fx.b.org.id,
      p_locked: true,
      p_reason: "",
    });
    expect(noReason.error?.code).toBe("22023");
    const locked = await platform.rpc("platform_set_lock", {
      p_org_id: fx.b.org.id,
      p_locked: true,
      p_reason: "DBB test",
    });
    expect(locked.error).toBeNull();
    expect(await billing()).toMatchObject({ state: "locked", reason: "manual" });
    await platform.rpc("platform_set_lock", {
      p_org_id: fx.b.org.id,
      p_locked: false,
      p_reason: "",
    });
    expect((await billing()).state).toBe("trial");
  });

  it("never locks the platform organization", async () => {
    const locked = await platform.rpc("platform_set_lock", {
      p_org_id: platformOrgId,
      p_locked: true,
      p_reason: "DBB test",
    });
    expect(locked.error?.code).toBe("22023");
  });
});

describe("platform access", () => {
  it("refuses every platform RPC for a tenant admin", async () => {
    const overview = await fx.b.admin.rpc("platform_billing_overview");
    expect(overview.error?.code).toBe("42501");
    const pay = await fx.b.admin.rpc("platform_set_payment", {
      p_org_id: fx.b.org.id,
      p_period: firstOfMonth(1),
      p_paid: true,
      p_paid_on: firstOfMonth(0),
      p_note: "",
    });
    expect(pay.error?.code).toBe("42501");
  });

  it("lists firms with their state for the platform admin", async () => {
    const { data, error } = await platform.rpc("platform_billing_overview");
    expect(error).toBeNull();
    expect(data?.find((row) => row.organization_id === fx.b.org.id)?.state).toBe("trial");
  });
});

describe("package modules", () => {
  it("syncs modules from the package and keeps trial modules", async () => {
    const trialEnd = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await fx.service
      .from("org_modules")
      .update({ active_until: trialEnd })
      .eq("organization_id", fx.b.org.id)
      .eq("module_key", "kiosk");
    const created = await platform.rpc("platform_save_package", {
      p_id: nullableParam<string>(null),
      p_name: "DBB Proizvodnja",
      p_monthly_price: 200,
      p_modules: ["production", "planning"],
    });
    expect(created.error).toBeNull();
    const assigned = await platform.rpc("platform_assign_package", {
      p_org_id: fx.b.org.id,
      p_package_id: created.data!,
    });
    expect(assigned.error).toBeNull();

    const { data } = await fx.service
      .from("org_modules")
      .select("module_key, enabled")
      .eq("organization_id", fx.b.org.id);
    const enabled = new Set((data ?? []).filter((m) => m.enabled).map((m) => m.module_key));
    expect(enabled.has("production")).toBe(true);
    expect(enabled.has("planning")).toBe(true);
    expect(enabled.has("kiosk")).toBe(true);
    expect(enabled.has("inventory")).toBe(false);
    expect(enabled.has("core")).toBe(true);
  });

  it("refuses a package with planning but without production", async () => {
    const created = await platform.rpc("platform_save_package", {
      p_id: nullableParam<string>(null),
      p_name: "DBB nevaljao",
      p_monthly_price: 10,
      p_modules: ["planning"],
    });
    expect(created.error?.code).toBe("22023");
  });
});

describe("package list", () => {
  it("lists packages with price, modules and how many firms have them", async () => {
    const created = await platform.rpc("platform_save_package", {
      p_id: nullableParam<string>(null),
      p_name: "DBB Lista",
      p_monthly_price: 90,
      p_modules: ["attendance", "kiosk"],
    });
    expect(created.error).toBeNull();
    await platform.rpc("platform_assign_package", {
      p_org_id: fx.b.org.id,
      p_package_id: created.data!,
    });
    const { data, error } = await platform.rpc("platform_billing_packages");
    expect(error).toBeNull();
    const listed = (data as unknown as { id: string }[]).find((p) => p.id === created.data);
    expect(listed).toMatchObject({
      name: "DBB Lista",
      monthly_price: 90,
      modules: ["attendance", "kiosk"],
      archived: false,
      organization_count: 1,
    });
    expect((await fx.b.admin.rpc("platform_billing_packages")).error?.code).toBe("42501");
  });
});

describe("price changes (final review)", () => {
  it("apply from the next month; the current month keeps its price", async () => {
    const created = await platform.rpc("platform_save_package", {
      p_id: nullableParam<string>(null),
      p_name: "DBB Cijena",
      p_monthly_price: 100,
      p_modules: ["production"],
    });
    expect(created.error).toBeNull();
    const changed = await platform.rpc("platform_save_package", {
      p_id: created.data!,
      p_name: "DBB Cijena",
      p_monthly_price: 150,
      p_modules: ["production"],
    });
    expect(changed.error).toBeNull();
    const { data } = await platform.rpc("platform_billing_packages");
    const listed = (data as unknown as { id: string; monthly_price: number }[]).find(
      (p) => p.id === created.data,
    );
    expect(listed?.monthly_price).toBe(100);
  });
});
