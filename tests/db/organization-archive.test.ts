import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nullableParam, numericParam } from "@/lib/supabase/numeric";
import type { Database } from "@/lib/supabase/types";
import {
  ensureModuleEnabled,
  ensureOrganization,
  ensureUser,
} from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Archive, restore, scheduled deletion (D-049). A temporary firm
// dbt-reg-arch-<random> is created for the run and purged in afterAll.

type Db = SupabaseClient<Database>;

const SLUG = `dbt-reg-arch-${crypto.randomUUID().slice(0, 8)}`;
const NAME = "Arhiva Test d.o.o.";

let fx: Fixture;
let orgId = "";
let admin: Db;
let tech: Db;
let member: Db;
let packageId = "";
const userIds: string[] = [];

const firstOfMonth = (monthsAgo: number, day = 1) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day))
    .toISOString()
    .slice(0, 10);
};

async function periods() {
  const { data, error } = await admin.rpc("platform_organization_billing", {
    p_org_id: orgId,
  });
  expect(error).toBeNull();
  const months = (data as unknown as { months: { period: string }[] }).months;
  return months.map((m) => m.period).sort();
}

async function resetOrg() {
  await fx.service.from("support_access_requests").delete().eq("organization_id", orgId);
  await fx.service.from("organization_archive_periods").delete().eq("organization_id", orgId);
  await fx.service
    .from("organizations")
    .update({ archived_at: null, archived_reason: null, delete_after: null })
    .eq("id", orgId);
}

beforeAll(async () => {
  fx = await setupFixture();
  const zcore = await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" });
  for (const [username, role] of [
    ["db.arch.admin", "platform_admin"],
    ["db.arch.tech", "platform_technician"],
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
  admin = await signIn("db.arch.admin", "zcore");
  tech = await signIn("db.arch.tech", "zcore");

  const org = await ensureOrganization(fx.service, { slug: SLUG, name: NAME });
  orgId = org.id;
  await fx.service.from("organizations").update({ name: NAME }).eq("id", orgId);
  await ensureModuleEnabled(fx.service, org, "kiosk");
  await ensureUser(fx.service, org, {
    username: "clan",
    password: testTenantPassword(),
    fullName: "Clan Arhive",
    role: "admin",
  });
  member = await signIn("clan", SLUG);
  const customer = await fx.service
    .from("customers")
    .insert({ organization_id: orgId, name: "Kupac arhive" });
  expect(customer.error).toBeNull();

  // A package priced from five months ago, assigned to the firm from then.
  const created = await admin.rpc("platform_save_package", {
    p_id: nullableParam<string>(null),
    p_name: `DBA ${crypto.randomUUID().slice(0, 8)}`,
    p_monthly_price: numericParam("100"),
    p_modules: ["production"],
  });
  expect(created.error).toBeNull();
  packageId = created.data!;
  await fx.service.from("billing_package_prices").delete().eq("package_id", packageId);
  const priced = await fx.service.from("billing_package_prices").insert({
    package_id: packageId,
    valid_from: firstOfMonth(6),
    monthly_price: numericParam("100"),
  });
  expect(priced.error).toBeNull();
  const assigned = await fx.service
    .from("organization_packages")
    .insert({ organization_id: orgId, valid_from: firstOfMonth(4), package_id: packageId });
  expect(assigned.error).toBeNull();
});

afterAll(async () => {
  const purged = await fx.service.rpc("purge_test_organization", { p_org_id: orgId });
  expect(purged.error).toBeNull();
  await fx.service.from("organization_packages").delete().eq("package_id", packageId);
  await fx.service.from("billing_package_modules").delete().eq("package_id", packageId);
  await fx.service.from("billing_package_prices").delete().eq("package_id", packageId);
  await fx.service.from("billing_packages").delete().eq("id", packageId);
  for (const id of userIds) {
    await fx.service
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", id);
  }
});

describe("archiving a firm", () => {
  it("archives a firm: its users lose access and the kiosk stops", async () => {
    await resetOrg();
    // A kiosk device of the firm, activated before the archive.
    const created = await member
      .rpc("create_kiosk_activation", {
        p_org_id: orgId,
        p_kiosk_id: null as unknown as string,
        p_name: "DBA ulaz",
      })
      .single();
    expect(created.error).toBeNull();
    const activated = await fx.service
      .rpc("kiosk_activate", { p_org_slug: SLUG, p_code: created.data!.code })
      .single();
    expect(activated.error).toBeNull();
    const device = {
      p_org_slug: SLUG,
      p_kiosk_id: activated.data!.kiosk_id,
      p_secret: activated.data!.secret,
    };
    expect((await fx.service.rpc("kiosk_session", device)).error).toBeNull();
    const before = await member.from("customers").select("id");
    expect(before.data?.length).toBeGreaterThan(0);

    const res = await admin.rpc("platform_archive_organization", {
      p_org_id: orgId,
      p_reason: "  Test arhive  ",
    });
    expect(res.error).toBeNull();

    const after = await member.from("customers").select("id");
    expect(after.data ?? []).toHaveLength(0);
    const session = await fx.service.rpc("kiosk_session", device);
    expect(session.error?.message).toBe("kiosk_unknown");
    const clock = await fx.service.rpc("kiosk_clock", {
      ...device,
      p_badge: "ab" as string,
      p_employee_id: null as unknown as string,
      p_pin: null as unknown as string,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(clock.error?.message).toBe("kiosk_unknown");

    const org = await fx.service
      .from("organizations")
      .select("archived_at, archived_reason")
      .eq("id", orgId)
      .single();
    expect(org.data?.archived_at).not.toBeNull();
    expect(org.data?.archived_reason).toBe("Test arhive");
    const audit = await fx.service
      .from("audit_log")
      .select("action")
      .eq("action", "organization.archived")
      .eq("entity_id", orgId);
    expect(audit.data?.length).toBeGreaterThan(0);

    expect(
      (await admin.rpc("platform_archive_organization", { p_org_id: orgId, p_reason: "x" })).error
        ?.message,
    ).toBe("already_archived");
    const overview = await admin.rpc("platform_billing_overview");
    const row = overview.data?.find((r) => r.organization_id === orgId);
    expect(row?.archived).toBe(true);
    expect(row?.archived_at).not.toBeNull();
    expect(row?.delete_after).toBeNull();
  });

  it("validates the reason", async () => {
    await resetOrg();
    for (const reason of ["", "   ", "x".repeat(301)]) {
      const res = await admin.rpc("platform_archive_organization", {
        p_org_id: orgId,
        p_reason: reason,
      });
      expect(res.error?.code).toBe("22023");
    }
  });

  it("ends an open support session when archiving", async () => {
    await resetOrg();
    const requester = userIds[0]!;
    const inserted = await fx.service
      .from("support_access_requests")
      .insert({
        organization_id: orgId,
        requested_by: requester,
        requester_name: "Zcore",
        reason: "Test",
        status: "active",
        duration_minutes: 60,
        approved_until: new Date(Date.now() + 3600_000).toISOString(),
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    const res = await admin.rpc("platform_archive_organization", {
      p_org_id: orgId,
      p_reason: "Kraj",
    });
    expect(res.error).toBeNull();
    const row = await fx.service
      .from("support_access_requests")
      .select("status, ended_at, ended_by")
      .eq("id", inserted.data!.id)
      .single();
    expect(row.data?.status).toBe("ended");
    expect(row.data?.ended_at).not.toBeNull();
    expect(row.data?.ended_by).toBe(userIds[0]);
  });

  it("does not bill archived months and bills again from the restore month", async () => {
    await resetOrg();
    const all = [4, 3, 2, 1, 0].map((n) => firstOfMonth(n));
    expect(await periods()).toEqual(all);

    // Archived in month -3, restored in month -1: month -2 is not billed.
    const closed = await fx.service.from("organization_archive_periods").insert({
      organization_id: orgId,
      archived_at: `${firstOfMonth(3, 10)}T10:00:00Z`,
      restored_at: `${firstOfMonth(1, 5)}T10:00:00Z`,
    });
    expect(closed.error).toBeNull();
    expect(await periods()).toEqual([all[0], all[1], all[3], all[4]]);

    // Archived and not restored since month -1: this month and the next are not billed.
    await fx.service.from("organization_archive_periods").delete().eq("organization_id", orgId);
    const open = await fx.service.from("organization_archive_periods").insert({
      organization_id: orgId,
      archived_at: `${firstOfMonth(2, 10)}T10:00:00Z`,
    });
    expect(open.error).toBeNull();
    expect(await periods()).toEqual([all[0], all[1], all[2]]);
  });

  it("refuses archive and deletion for the Tehničar", async () => {
    await resetOrg();
    const archive = await tech.rpc("platform_archive_organization", {
      p_org_id: orgId,
      p_reason: "Ne",
    });
    expect(archive.error?.code).toBe("42501");
    await admin.rpc("platform_archive_organization", { p_org_id: orgId, p_reason: "Da" });
    const restore = await tech.rpc("platform_restore_organization", { p_org_id: orgId });
    expect(restore.error?.code).toBe("42501");
    const schedule = await tech.rpc("platform_schedule_organization_deletion", {
      p_org_id: orgId,
      p_confirm_name: NAME,
    });
    expect(schedule.error?.code).toBe("42501");
    const cancel = await tech.rpc("platform_cancel_organization_deletion", { p_org_id: orgId });
    expect(cancel.error?.code).toBe("42501");
    const state = await fx.service
      .from("organizations")
      .select("archived_at, delete_after")
      .eq("id", orgId)
      .single();
    expect(state.data?.archived_at).not.toBeNull();
    expect(state.data?.delete_after).toBeNull();
  });
});

describe("scheduled deletion", () => {
  it("schedules deletion only for an archived firm with the exact name", async () => {
    await resetOrg();
    const active = await admin.rpc("platform_schedule_organization_deletion", {
      p_org_id: orgId,
      p_confirm_name: NAME,
    });
    expect(active.error?.message).toBe("not_archived");
    expect(active.error?.code).toBe("22023");

    await admin.rpc("platform_archive_organization", { p_org_id: orgId, p_reason: "Brisanje" });
    const wrongCase = await admin.rpc("platform_schedule_organization_deletion", {
      p_org_id: orgId,
      p_confirm_name: NAME.toUpperCase(),
    });
    expect(wrongCase.error?.message).toBe("name_mismatch");
    const empty = await admin.rpc("platform_schedule_organization_deletion", {
      p_org_id: orgId,
      p_confirm_name: "  ",
    });
    expect(empty.error?.message).toBe("name_mismatch");

    const ok = await admin.rpc("platform_schedule_organization_deletion", {
      p_org_id: orgId,
      p_confirm_name: `  ${NAME}  `,
    });
    expect(ok.error).toBeNull();
    const diffDays = (new Date(ok.data as string).getTime() - Date.now()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(29.9);
    expect(diffDays).toBeLessThan(30.1);
    const stored = await fx.service
      .from("organizations")
      .select("delete_after")
      .eq("id", orgId)
      .single();
    expect(new Date(stored.data!.delete_after!).getTime()).toBe(
      new Date(ok.data as string).getTime(),
    );

    const again = await admin.rpc("platform_schedule_organization_deletion", {
      p_org_id: orgId,
      p_confirm_name: NAME,
    });
    expect(again.error?.message).toBe("already_scheduled");
  });

  it("refuses restore while deletion is scheduled, allows it after cancelling", async () => {
    await resetOrg();
    await admin.rpc("platform_archive_organization", { p_org_id: orgId, p_reason: "Povrat" });
    const notScheduled = await admin.rpc("platform_cancel_organization_deletion", {
      p_org_id: orgId,
    });
    expect(notScheduled.error?.message).toBe("not_scheduled");
    const scheduled = await admin.rpc("platform_schedule_organization_deletion", {
      p_org_id: orgId,
      p_confirm_name: NAME,
    });
    expect(scheduled.error).toBeNull();

    const refused = await admin.rpc("platform_restore_organization", { p_org_id: orgId });
    expect(refused.error?.message).toBe("deletion_scheduled");
    expect(refused.error?.code).toBe("22023");

    const cancelled = await admin.rpc("platform_cancel_organization_deletion", {
      p_org_id: orgId,
    });
    expect(cancelled.error).toBeNull();
    const restored = await admin.rpc("platform_restore_organization", { p_org_id: orgId });
    expect(restored.error).toBeNull();

    const org = await fx.service
      .from("organizations")
      .select("archived_at, archived_reason, delete_after")
      .eq("id", orgId)
      .single();
    expect(org.data).toEqual({ archived_at: null, archived_reason: null, delete_after: null });
    const period = await fx.service
      .from("organization_archive_periods")
      .select("restored_at")
      .eq("organization_id", orgId);
    expect(period.data).toHaveLength(1);
    expect(period.data![0]!.restored_at).not.toBeNull();
    const back = await member.from("customers").select("id");
    expect(back.data?.length).toBeGreaterThan(0);
    const actions = await fx.service
      .from("audit_log")
      .select("action")
      .eq("entity_id", orgId)
      .like("action", "organization.%");
    const names = new Set((actions.data ?? []).map((a) => a.action));
    for (const a of [
      "organization.archived",
      "organization.restored",
      "organization.deletion_scheduled",
      "organization.deletion_cancelled",
    ]) {
      expect(names.has(a)).toBe(true);
    }
    expect(
      (await admin.rpc("platform_restore_organization", { p_org_id: orgId })).error?.message,
    ).toBe("not_archived");
  });
});

describe("cancelling a deletion", () => {
  it("refuses to cancel once the 30 days have passed (not_cancellable)", async () => {
    await resetOrg();
    await admin.rpc("platform_archive_organization", { p_org_id: orgId, p_reason: "Rok" });
    const scheduled = await admin.rpc("platform_schedule_organization_deletion", {
      p_org_id: orgId,
      p_confirm_name: NAME,
    });
    expect(scheduled.error).toBeNull();
    const detail = await admin.rpc("platform_organization_billing", { p_org_id: orgId });
    const org = (detail.data as unknown as { organization: Record<string, unknown> }).organization;
    expect(org.archived_at).not.toBeNull();
    expect(org.archived_reason).toBe("Rok");
    expect(org.delete_after).not.toBeNull();

    await fx.service
      .from("organizations")
      .update({ delete_after: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", orgId);
    const refused = await admin.rpc("platform_cancel_organization_deletion", { p_org_id: orgId });
    expect(refused.error?.message).toBe("not_cancellable");
    expect(refused.error?.code).toBe("22023");
    await resetOrg();
  });
});

// Permanent deletion (D-049). A second temporary firm dbt-reg-arch-p-<random>,
// so the tests above keep theirs. Only this firm is ever purged here.
describe("permanent deletion", () => {
  const PURGE_SLUG = `dbt-reg-arch-p-${crypto.randomUUID().slice(0, 8)}`;
  const PURGE_NAME = "Brisanje Test d.o.o.";
  let purgeOrgId = "";
  let purgeUserId = "";
  let companyId = "";
  let zcoreId = "";

  beforeAll(async () => {
    const zcore = await fx.service.from("organizations").select("id").eq("slug", "zcore").single();
    zcoreId = zcore.data!.id;
    const org = await ensureOrganization(fx.service, { slug: PURGE_SLUG, name: PURGE_NAME });
    purgeOrgId = org.id;
    await fx.service.from("organizations").update({ name: PURGE_NAME }).eq("id", purgeOrgId);
    purgeUserId = await ensureUser(fx.service, org, {
      username: "clan",
      password: testTenantPassword(),
      fullName: "Clan Brisanja",
      role: "admin",
    });
    const customer = await fx.service
      .from("customers")
      .insert({ organization_id: purgeOrgId, name: "Kupac brisanja" });
    expect(customer.error).toBeNull();
    // The firm's own directory entry, as after a registration.
    const company = await fx.service
      .from("companies")
      .insert({
        name: PURGE_NAME,
        country: "DE",
        tax_id: `DBT${crypto.randomUUID().slice(0, 8)}`.toUpperCase(),
        owner_organization_id: purgeOrgId,
        created_by_organization_id: purgeOrgId,
      })
      .select("id")
      .single();
    expect(company.error).toBeNull();
    companyId = company.data!.id;
    await fx.service.from("organizations").update({ company_id: companyId }).eq("id", purgeOrgId);
    const payment = await fx.service.from("platform_payment_records").insert({
      firm_id: purgeOrgId,
      firm_name: PURGE_NAME,
      firm_slug: PURGE_SLUG,
      period: firstOfMonth(1),
      amount: numericParam("100"),
      paid_on: firstOfMonth(1, 5),
    });
    expect(payment.error).toBeNull();
  });

  afterAll(async () => {
    // Only if a test failed before the purge: the temporary firm still exists.
    const left = await fx.service.rpc("purge_test_organization", { p_org_id: purgeOrgId });
    expect(left.error).toBeNull();
    await fx.service.from("platform_payment_records").delete().eq("firm_id", purgeOrgId);
    if (companyId) await fx.service.from("companies").delete().eq("id", companyId);
  });

  it("refuses purge before the 30 days and purges after", async () => {
    const active = await fx.service.rpc("purge_organization", { p_org_id: purgeOrgId });
    expect(active.error?.code).toBe("42501");

    await admin.rpc("platform_archive_organization", { p_org_id: purgeOrgId, p_reason: "Kraj" });
    const archivedOnly = await fx.service.rpc("purge_organization", { p_org_id: purgeOrgId });
    expect(archivedOnly.error?.code).toBe("42501");
    const scheduled = await admin.rpc("platform_schedule_organization_deletion", {
      p_org_id: purgeOrgId,
      p_confirm_name: PURGE_NAME,
    });
    expect(scheduled.error).toBeNull();
    const early = await fx.service.rpc("purge_organization", { p_org_id: purgeOrgId });
    expect(early.error?.code).toBe("42501");
    // Not for signed-in users, not even the platform admin.
    const asAdmin = await admin.rpc("purge_organization", { p_org_id: purgeOrgId });
    expect(asAdmin.error).not.toBeNull();
    expect(
      (await fx.service.from("organizations").select("id").eq("id", purgeOrgId)).data,
    ).toHaveLength(1);

    const due = await fx.service
      .from("organizations")
      .update({ delete_after: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", purgeOrgId);
    expect(due.error).toBeNull();
    const purged = await fx.service.rpc("purge_organization", { p_org_id: purgeOrgId });
    expect(purged.error).toBeNull();
    expect(purged.data).toBe(true);

    expect((await fx.service.from("organizations").select("id").eq("id", purgeOrgId)).data).toEqual(
      [],
    );
    for (const table of [
      "customers",
      "memberships",
      "profiles",
      "roles",
      "org_modules",
      "organization_archive_periods",
      "audit_log",
    ] as const) {
      const rows = await fx.service
        .from(table)
        .select("organization_id")
        .eq("organization_id", purgeOrgId);
      expect(rows.error).toBeNull();
      expect(rows.data, table).toEqual([]);
    }
    const user = await fx.service.auth.admin.getUserById(purgeUserId);
    expect(user.data.user).toBeNull();

    const payments = await fx.service
      .from("platform_payment_records")
      .select("firm_id")
      .eq("firm_id", purgeOrgId);
    expect(payments.data).toHaveLength(1);
    const company = await fx.service
      .from("companies")
      .select("owner_organization_id, created_by_organization_id")
      .eq("id", companyId)
      .single();
    expect(company.data).toEqual({ owner_organization_id: null, created_by_organization_id: null });

    const audit = await fx.service
      .from("audit_log")
      .select("organization_id, before")
      .eq("action", "organization.purged")
      .eq("entity_id", purgeOrgId);
    expect(audit.data).toHaveLength(1);
    expect(audit.data![0]!.organization_id).toBe(zcoreId);
    expect(audit.data![0]!.before).toMatchObject({
      name: PURGE_NAME,
      slug: PURGE_SLUG,
      member_count: 1,
    });
  });

  it("is safe to run twice", async () => {
    const again = await fx.service.rpc("purge_organization", { p_org_id: purgeOrgId });
    expect(again.error).toBeNull();
    expect(again.data).toBe(false);
  });
});
