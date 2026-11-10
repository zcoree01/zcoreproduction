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
    problem_reports_open: number;
    slow_open: number;
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
  usage: { active_7d: number; by_day: { day: string; users: number }[] };
  problems: {
    open: number;
    slow_open: number;
    resolved_this_month: number;
    avg_resolution_days: string | null;
  };
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
  const { data, error } = await db.rpc("platform_home");
  expect(error).toBeNull();
  return data as unknown as Home;
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
    const { error } = await fx.b.admin.rpc("platform_home");
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

  it("counts active users of the last 7 days and returns 30 days", async () => {
    const member = await fx.service
      .from("profiles")
      .select("id")
      .eq("organization_id", orgId)
      .eq("username", "clan")
      .single();
    const uid = member.data!.id;
    const today = localToday();
    const daysAgo = (n: number) =>
      new Date(Date.parse(today) - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ins = await fx.service.from("member_activity_days").insert([
      { organization_id: orgId, user_id: uid, day: today },
      { organization_id: orgId, user_id: uid, day: daysAgo(6) },
      { organization_id: orgId, user_id: uid, day: daysAgo(7) },
    ]);
    expect(ins.error).toBeNull();
    try {
      const now = await home(admin);
      // One more distinct user (today and 6 days ago are inside the 7 days; 7 is not).
      expect(now.usage.active_7d - baseline.usage.active_7d).toBe(1);
      expect(now.usage.by_day).toHaveLength(30);
      expect(now.usage.by_day.at(-1)!.day).toBe(today);
      expect(now.usage.by_day.at(0)!.day).toBe(daysAgo(29));
      const at = (h: Home, day: string) => h.usage.by_day.find((d) => d.day === day)!.users;
      expect(at(now, today) - at(baseline, today)).toBe(1);
      expect(at(now, daysAgo(7)) - at(baseline, daysAgo(7))).toBe(1);
      const days = now.usage.by_day.map((d) => d.day);
      expect(new Set(days).size).toBe(30);
      expect(days).toEqual([...days].sort());
      expect((await home(tech)).usage.by_day).toHaveLength(30);
    } finally {
      await fx.service.from("member_activity_days").delete().eq("organization_id", orgId);
    }
  });

  it("counts open and slow reports and the average resolution", async () => {
    const author = await fx.service
      .from("profiles")
      .select("id")
      .eq("organization_id", orgId)
      .eq("username", "clan")
      .single();
    const uid = author.data!.id;
    const hour = 60 * 60 * 1000;
    const now0 = Date.now();
    const iso = (offsetHours: number) => new Date(now0 + offsetHours * hour).toISOString();
    const make = (
      category: string,
      status: string,
      createdHours: number,
      resolvedHours: number | null,
    ) => ({
      organization_id: orgId,
      created_by: uid,
      category,
      description: "t",
      status,
      idempotency_key: crypto.randomUUID(),
      created_at: iso(createdHours),
      resolved_at: resolvedHours === null ? null : iso(resolvedHours),
    });
    const base = await home(admin);
    // Resolved reports: 1 day and 2 days from creation, both resolved 1 hour ago.
    const inserted = await fx.service
      .from("problem_reports")
      .insert([
        make("slow", "new", -5, null),
        make("broken", "in_progress", -5, null),
        make("slow", "waiting_user", -5, null),
        make("slow", "resolved", -25, -1),
        make("broken", "resolved", -49, -1),
      ])
      .select("id");
    expect(inserted.error).toBeNull();
    const ids = (inserted.data ?? []).map((r) => r.id);
    try {
      const now = await home(admin);
      expect(now.problems.open - base.problems.open).toBe(3);
      expect(now.problems.slow_open - base.problems.slow_open).toBe(2);
      expect(now.todo.problem_reports_open).toBe(now.problems.open);
      expect(now.todo.slow_open).toBe(now.problems.slow_open);
      expect(now.problems.avg_resolution_days).toMatch(/^\d+\.\d$/);
      // Within the first hour of a month the two resolved reports fall in the previous one.
      const resolvedDelta = now.problems.resolved_this_month - base.problems.resolved_this_month;
      expect([0, 2]).toContain(resolvedDelta);
      if (base.problems.resolved_this_month === 0 && resolvedDelta === 2) {
        expect(now.problems.avg_resolution_days).toBe("1.5");
      }
      expect((await home(tech)).problems.open).toBe(now.problems.open);
    } finally {
      await fx.service.from("problem_reports").delete().in("id", ids);
    }
  });
});
