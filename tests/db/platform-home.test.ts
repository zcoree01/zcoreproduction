import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { numericParam } from "@/lib/supabase/numeric";
import type { Database } from "@/lib/supabase/types";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";
import { localMonthDay, localToday } from "./months";

// platform_home(): the numbers of the Zcore home page. The database is shared
// with real firms, so every assertion is a delta against a baseline read before
// the fixture firm (dbt-reg-home-<random>) exists, or a property of its rows.

type Db = SupabaseClient<Database>;

type Home = {
  today: string;
  firms: {
    using: number;
    using_last_month: number;
    trial: number;
    active: number;
    warning: number;
    overdue: number;
    locked: number;
  };
  users: number;
  todo: {
    directory_requests: number;
    support_pending: number;
    trials_ending: number;
    deletions_scheduled: number;
  };
  overdue: {
    organization_id: string;
    name: string;
    package_name: string;
    period: string;
    amount: string;
    days_late: number;
    state: string;
  }[];
  revenue: {
    paid: string;
    expected: string;
    overdue_total: string;
    by_month: { period: string; paid: string }[];
  } | null;
};

const SLUG = `dbt-reg-home-${crypto.randomUUID().slice(0, 8)}`;
const NAME = "Pocetna Test d.o.o.";
const PRICE = "100.00";

let fx: Fixture;
let admin: Db;
let tech: Db;
let zcoreId = "";
let orgId = "";
let packageId = "";
let baseline: Home;
const userIds: string[] = [];

const cents = (value: string) => Math.round(Number(value) * 100);
const month = (monthsAgo: number) => localMonthDay(monthsAgo);

async function home(db: Db): Promise<Home> {
  const { data, error } = await (
    db.rpc as unknown as (
      name: string,
    ) => Promise<{ data: unknown; error: { code: string } | null }>
  )("platform_home");
  expect(error).toBeNull();
  return data as Home;
}

async function setArchived(archived: boolean) {
  const { error } = await fx.service
    .from("organizations")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", orgId);
  expect(error).toBeNull();
}

beforeAll(async () => {
  fx = await setupFixture();
  const zcore = await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" });
  zcoreId = zcore.id;
  for (const [username, role] of [
    ["db.home.admin", "platform_admin"],
    ["db.home.tech", "platform_technician"],
  ] as const) {
    const id = await ensureUser(fx.service, zcore, {
      username,
      password: testTenantPassword(),
      fullName: username,
      role,
    });
    await fx.service.from("memberships").update({ archived_at: null }).eq("user_id", id);
    userIds.push(id);
  }
  admin = await signIn("db.home.admin", "zcore");
  tech = await signIn("db.home.tech", "zcore");

  baseline = await home(admin);

  const org = await ensureOrganization(fx.service, { slug: SLUG, name: NAME });
  orgId = org.id;
  await fx.service.from("organizations").update({ name: NAME }).eq("id", orgId);
  await ensureUser(fx.service, org, {
    username: "clan",
    password: testTenantPassword(),
    fullName: "Clan Pocetne",
    role: "admin",
  });

  // Billed from two months ago, grace 0, per-firm transition long ago: the
  // oldest months are due. Two months ago is paid, last month is not.
  const created = await fx.service
    .from("billing_packages")
    .insert({ name: `DBH ${crypto.randomUUID().slice(0, 8)}` })
    .select("id")
    .single();
  expect(created.error).toBeNull();
  packageId = created.data!.id;
  const priced = await fx.service.from("billing_package_prices").insert({
    package_id: packageId,
    valid_from: month(6),
    monthly_price: numericParam(PRICE),
  });
  expect(priced.error).toBeNull();
  const assigned = await fx.service
    .from("organization_packages")
    .insert({ organization_id: orgId, valid_from: month(2), package_id: packageId });
  expect(assigned.error).toBeNull();
  const billing = await fx.service
    .from("organization_billing")
    .upsert(
      { organization_id: orgId, grace_days: 0, auto_lock: true, prepaid_since: "2026-01-01" },
      { onConflict: "organization_id" },
    );
  expect(billing.error).toBeNull();
  const paidMonth = await fx.service
    .from("billing_payments")
    .insert({ organization_id: orgId, period: month(2), paid_on: month(2) });
  expect(paidMonth.error).toBeNull();

  // Payment records: this month (counts), this month cancelled (does not),
  // last month (counts for last month only).
  const records = await fx.service.from("platform_payment_records").insert([
    {
      firm_id: orgId,
      firm_name: NAME,
      firm_slug: SLUG,
      period: month(0),
      amount: numericParam("100"),
      paid_on: localToday(),
    },
    {
      firm_id: orgId,
      firm_name: NAME,
      firm_slug: SLUG,
      period: month(0),
      amount: numericParam("40"),
      paid_on: localToday(),
      cancelled_at: new Date().toISOString(),
    },
    {
      firm_id: orgId,
      firm_name: NAME,
      firm_slug: SLUG,
      period: month(1),
      amount: numericParam("70"),
      paid_on: localToday(),
    },
  ]);
  expect(records.error).toBeNull();
});

afterAll(async () => {
  await fx.service.from("platform_payment_records").delete().eq("firm_id", orgId);
  const purged = await fx.service.rpc("purge_test_organization", { p_org_id: orgId });
  expect(purged.error).toBeNull();
  await fx.service.from("organization_packages").delete().eq("package_id", packageId);
  await fx.service.from("billing_package_prices").delete().eq("package_id", packageId);
  await fx.service.from("billing_packages").delete().eq("id", packageId);
  for (const id of userIds) {
    await fx.service
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", id);
  }
});

describe("platform_home", () => {
  it("returns the counts for the Administrator with revenue", async () => {
    const now = await home(admin);
    expect(now.today).toBe(localToday());
    expect(now.firms.using - baseline.firms.using).toBe(1);
    expect(now.firms.using_last_month - baseline.firms.using_last_month).toBe(1);
    expect(now.firms.locked - baseline.firms.locked).toBe(1);
    expect(now.users - baseline.users).toBe(1);
    expect(now.revenue).not.toBeNull();
    expect(cents(now.revenue!.paid) - cents(baseline.revenue!.paid)).toBe(10000);
    expect(cents(now.revenue!.expected) - cents(baseline.revenue!.expected)).toBe(10000);
    expect(now.revenue!.by_month).toHaveLength(12);
    expect(now.revenue!.by_month.at(0)!.period).toBe(month(11));
    expect(now.revenue!.by_month.at(-1)!.period).toBe(month(0));
    expect(now.revenue!.paid).toMatch(/^\d+\.\d{2}$/);
  });

  it("hides revenue from the Tehničar", async () => {
    const now = await home(tech);
    expect(now.revenue).toBeNull();
    expect("revenue" in now).toBe(true);
    expect(now.firms.using).toBeGreaterThanOrEqual(1);
    expect(now.todo).toBeDefined();
  });

  it("refuses a tenant admin", async () => {
    const { error } = await (
      fx.b.admin.rpc as unknown as (name: string) => Promise<{ error: { code: string } | null }>
    )("platform_home");
    expect(error?.code).toBe("42501");
  });

  it("ignores cancelled payments and last month's payment in this month", async () => {
    const now = await home(admin);
    const byPeriod = (h: Home, period: string) =>
      cents(h.revenue!.by_month.find((m) => m.period === period)!.paid);
    // 100 this month (the cancelled 40 is out), 70 last month.
    expect(byPeriod(now, month(0)) - byPeriod(baseline, month(0))).toBe(10000);
    expect(byPeriod(now, month(1)) - byPeriod(baseline, month(1))).toBe(7000);
    expect(cents(now.revenue!.paid)).toBe(byPeriod(now, month(0)));
  });

  it("leaves out archived firms and the Zcore organization", async () => {
    // An extra Zcore member does not count.
    const extra = await ensureUser(
      fx.service,
      { id: zcoreId, slug: "zcore", name: "Zcore" } as Parameters<typeof ensureUser>[1],
      {
        username: "db.home.extra",
        password: testTenantPassword(),
        fullName: "Extra",
        role: "platform_technician",
      },
    );
    userIds.push(extra);
    await setArchived(true);
    try {
      const now = await home(admin);
      expect(now.firms.using).toBe(baseline.firms.using);
      expect(now.users).toBe(baseline.users);
      expect(cents(now.revenue!.expected)).toBe(cents(baseline.revenue!.expected));
      expect(now.overdue.some((row) => row.organization_id === orgId)).toBe(false);
    } finally {
      await setArchived(false);
    }
  });

  it("lists an unpaid due month in overdue with days late", async () => {
    const now = await home(admin);
    const row = now.overdue.find((r) => r.organization_id === orgId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      name: NAME,
      period: month(1),
      amount: PRICE,
      state: "locked",
    });
    const days = Math.round(
      (Date.parse(localToday()) - Date.parse(month(1))) / (24 * 60 * 60 * 1000),
    );
    expect(row!.days_late).toBe(days);
    expect(cents(now.revenue!.overdue_total)).toBeGreaterThanOrEqual(10000);
    const lates = now.overdue.map((r) => r.days_late);
    expect(lates).toEqual([...lates].sort((a, b) => b - a));
  });
});
