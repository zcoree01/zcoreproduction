import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Scheduled support sessions: Zcore proposes a time window from a problem
// report; the firm's admin approves it; entry only from the start.

type Db = SupabaseClient<Database>;

let fx: Fixture;
let admin: Db;
let limited: Db;
const memberIds: string[] = [];
const reportIds: string[] = [];
const LIMITED_ROLE = "dbt_reports_only";

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

async function closeOpenRequests() {
  const res = await fx.service
    .from("support_access_requests")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("organization_id", fx.a.org.id)
    .in("status", ["pending", "approved", "active"]);
  if (res.error) throw res.error;
}

async function newReport(): Promise<string> {
  const { data, error } = await fx.a.operator.rpc("submit_problem_report", {
    p_org: fx.a.org.id,
    p_category: "broken",
    p_description: "Ne radi dugme",
    p_page_path: "/orders",
    p_user_agent: "vitest",
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !data) throw error ?? new Error("no report");
  reportIds.push(data);
  return data;
}

beforeAll(async () => {
  fx = await setupFixture();
  const zcore = await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" });
  const adminId = await ensureUser(fx.service, zcore, {
    username: "db.sched.admin",
    password: testTenantPassword(),
    fullName: "db.sched.admin",
    role: "platform_admin",
  });
  const limitedRole = await fx.service
    .from("roles")
    .upsert(
      { organization_id: zcore.id, key: LIMITED_ROLE, name: "DBT reports only", archived_at: null },
      { onConflict: "organization_id,key" },
    )
    .select("id")
    .single();
  if (limitedRole.error) throw limitedRole.error;
  const permissions = await fx.service.from("role_permissions").upsert(
    ["platform.read", "platform.reports.manage"].map((permission_key) => ({
      organization_id: zcore.id,
      role_id: limitedRole.data.id,
      permission_key,
    })),
    { onConflict: "role_id,permission_key", ignoreDuplicates: true },
  );
  if (permissions.error) throw permissions.error;
  const limitedId = await ensureUser(fx.service, zcore, {
    username: "db.sched.limited",
    password: testTenantPassword(),
    fullName: "db.sched.limited",
    role: "platform_technician",
  });
  const moved = await fx.service
    .from("memberships")
    .update({ role_id: limitedRole.data.id, archived_at: null })
    .eq("user_id", limitedId);
  if (moved.error) throw moved.error;
  await fx.service.from("memberships").update({ archived_at: null }).eq("user_id", adminId);
  memberIds.push(adminId, limitedId);
  admin = await signIn("db.sched.admin", "zcore");
  limited = await signIn("db.sched.limited", "zcore");
  await closeOpenRequests();
});

afterEach(async () => {
  await closeOpenRequests();
});

afterAll(async () => {
  await closeOpenRequests();
  if (reportIds.length > 0) {
    await fx.service
      .from("support_access_requests")
      .update({ problem_report_id: null })
      .in("problem_report_id", reportIds);
    await fx.service.from("problem_report_files").delete().in("report_id", reportIds);
    await fx.service.from("problem_report_messages").delete().in("report_id", reportIds);
    await fx.service.from("problem_reports").delete().in("id", reportIds);
  }
  for (const id of memberIds) {
    await fx.service
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", id);
  }
});

describe("scheduled support sessions", () => {
  it("schedules a session from a report as a pending request with its start", async () => {
    const reportId = await newReport();
    const start = minutes(60);
    const { data, error } = await admin.rpc("platform_schedule_support_session", {
      p_report_id: reportId,
      p_start: start,
      p_minutes: 90,
      p_reason: "Pogledat cemo dugme zajedno",
    });
    expect(error).toBeNull();
    const row = await fx.service
      .from("support_access_requests")
      .select("*")
      .eq("id", data ?? "")
      .single();
    expect(row.data).toMatchObject({
      status: "pending",
      duration_minutes: 90,
      problem_report_id: reportId,
      organization_id: fx.a.org.id,
    });
    expect(new Date(row.data?.scheduled_start ?? "").getTime()).toBe(new Date(start).getTime());

    const report = await fx.service
      .from("problem_reports")
      .select("status")
      .eq("id", reportId)
      .single();
    expect(report.data?.status).toBe("waiting_user");
    const messages = await fx.service
      .from("problem_report_messages")
      .select("from_zcore, body")
      .eq("report_id", reportId);
    expect(messages.data).toEqual([{ from_zcore: true, body: "Pogledat cemo dugme zajedno" }]);

    const detail = await admin.rpc("platform_problem_report", { p_id: reportId });
    const linked = (detail.data as unknown as { access_requests: { id: string }[] })
      .access_requests;
    expect(linked.map((a) => a.id)).toEqual([data]);

    const pending = await fx.a.admin.rpc("pending_support_requests", { p_org_id: fx.a.org.id });
    expect(pending.data?.[0]).toMatchObject({ id: data, problem_report_id: reportId });

    const audit = await fx.service
      .from("audit_log")
      .select("action")
      .eq("organization_id", fx.a.org.id)
      .eq("action", "support.scheduled")
      .limit(1);
    expect(audit.data?.length).toBe(1);
  });

  it("refuses scheduling while the firm has an open support request", async () => {
    const reportId = await newReport();
    const first = await admin.rpc("platform_schedule_support_session", {
      p_report_id: reportId,
      p_start: minutes(30),
      p_minutes: 30,
      p_reason: "Prvi termin",
    });
    expect(first.error).toBeNull();
    const second = await admin.rpc("platform_schedule_support_session", {
      p_report_id: reportId,
      p_start: minutes(120),
      p_minutes: 30,
      p_reason: "Drugi termin",
    });
    expect(second.error?.code).toBe("22023");
    expect(second.error?.message).toContain("support_open");
  });

  it("approval opens the window from the scheduled start for the scheduled duration", async () => {
    const reportId = await newReport();
    const start = minutes(120);
    const scheduled = await admin.rpc("platform_schedule_support_session", {
      p_report_id: reportId,
      p_start: start,
      p_minutes: 60,
      p_reason: "Termin",
    });
    const id = scheduled.data ?? "";
    const decided = await fx.a.admin.rpc("decide_support_request", {
      p_org_id: fx.a.org.id,
      p_request_id: id,
      p_approve: true,
      p_minutes: 15,
    });
    expect(decided.error).toBeNull();
    const row = await fx.service
      .from("support_access_requests")
      .select("status, duration_minutes, approved_until")
      .eq("id", id)
      .single();
    expect(row.data?.status).toBe("approved");
    expect(row.data?.duration_minutes).toBe(60);
    expect(new Date(row.data?.approved_until ?? "").getTime()).toBe(
      new Date(start).getTime() + 60 * 60_000,
    );
  });

  it("does not let Zcore enter before the start, lets it enter after", async () => {
    const reportId = await newReport();
    const scheduled = await admin.rpc("platform_schedule_support_session", {
      p_report_id: reportId,
      p_start: minutes(60),
      p_minutes: 60,
      p_reason: "Termin",
    });
    const id = scheduled.data ?? "";
    const decided = await fx.a.admin.rpc("decide_support_request", {
      p_org_id: fx.a.org.id,
      p_request_id: id,
      p_approve: true,
    });
    expect(decided.error).toBeNull();
    const early = await admin.rpc("platform_begin_support", { p_request_id: id });
    expect(early.error?.code).toBe("22023");
    expect(early.error?.message).toContain("not_started");

    // The window has begun (start moved into the past, end still ahead).
    const begun = await fx.service
      .from("support_access_requests")
      .update({ scheduled_start: minutes(-10), approved_until: minutes(50) })
      .eq("id", id);
    expect(begun.error).toBeNull();
    const entered = await admin.rpc("platform_begin_support", { p_request_id: id });
    expect(entered.error).toBeNull();
    expect(entered.data?.[0]?.slug).toBe(fx.a.org.slug);
  });

  it("expires an unapproved request whose window has passed", async () => {
    const reportId = await newReport();
    const scheduled = await admin.rpc("platform_schedule_support_session", {
      p_report_id: reportId,
      p_start: minutes(30),
      p_minutes: 15,
      p_reason: "Termin",
    });
    const id = scheduled.data ?? "";
    await fx.service
      .from("support_access_requests")
      .update({ scheduled_start: minutes(-120) })
      .eq("id", id);

    const late = await fx.a.admin.rpc("decide_support_request", {
      p_org_id: fx.a.org.id,
      p_request_id: id,
      p_approve: true,
    });
    expect(late.error?.code).toBe("P0002");
    // The refused call rolls back with its error; the listing persists the expiry.
    const listed = await admin.rpc("platform_support_requests");
    expect(listed.error).toBeNull();
    const row = await fx.service
      .from("support_access_requests")
      .select("status")
      .eq("id", id)
      .single();
    expect(row.data?.status).toBe("cancelled");

    // The slot is free again.
    const again = await admin.rpc("platform_request_support", {
      p_org_id: fx.a.org.id,
      p_reason: "Novi zahtjev",
    });
    expect(again.error).toBeNull();
  });

  it("refuses scheduling for the Tehničar without platform.support", async () => {
    const reportId = await newReport();
    const denied = await limited.rpc("platform_schedule_support_session", {
      p_report_id: reportId,
      p_start: minutes(30),
      p_minutes: 30,
      p_reason: "Termin",
    });
    expect(denied.error?.code).toBe("42501");
    const open = await fx.service
      .from("support_access_requests")
      .select("id")
      .eq("organization_id", fx.a.org.id)
      .in("status", ["pending", "approved", "active"]);
    expect(open.data).toEqual([]);
  });
});
